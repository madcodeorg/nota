import { Entity } from '@nota/infra';
import type {
  StoreClient,
  WorkerInitOptions,
} from '@nota/nbstore/worker/client';

import type { FeatureFlagService } from '../../feature-flag';
import { GoogleAuthService } from '../../google-auth';
import type { NbstoreService } from '../../storage';
import {
  getGoogleDriveWorkspaceOwner,
  isGoogleDriveWorkspaceSyncPaused,
} from '../../workspace-engine/impls/google-drive';
import { WorkspaceEngineBeforeStart } from '../events';
import { isServerBackedWorkspaceFlavour } from '../metadata';
import type { WorkspaceService } from '../services/workspace';

export class WorkspaceEngine extends Entity<{
  isSharedMode?: boolean;
  engineWorkerInitOptions: WorkerInitOptions;
}> {
  client?: StoreClient;
  started = false;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly nbstoreService: NbstoreService,
    private readonly featureFlagService: FeatureFlagService
  ) {
    super();
  }

  get doc() {
    if (!this.client) {
      throw new Error('Engine is not initialized');
    }
    return this.client.docFrontend;
  }

  get blob() {
    if (!this.client) {
      throw new Error('Engine is not initialized');
    }
    return this.client.blobFrontend;
  }

  get indexer() {
    if (!this.client) {
      throw new Error('Engine is not initialized');
    }
    return this.client.indexerFrontend;
  }

  get awareness() {
    if (!this.client) {
      throw new Error('Engine is not initialized');
    }
    return this.client.awarenessFrontend;
  }

  private bindGoogleDriveSession(store: StoreClient) {
    const session = this.framework.get(GoogleAuthService).session;
    const workspaceId = this.workspaceService.workspace.id;

    let disposed = false;
    let generation = 0;
    const publish = async (forceRefresh = false) => {
      const current = ++generation;
      const owner = getGoogleDriveWorkspaceOwner(workspaceId);
      const user = session.userInfo$.value;
      const allowed =
        user?.sub === owner && !isGoogleDriveWorkspaceSyncPaused(workspaceId);
      // Clear old worker credentials before asynchronous refresh/account replacement.
      if (!allowed) {
        await store.setGoogleDriveTokens(null);
        return;
      }
      const accessToken = await session.getAccessToken(forceRefresh);
      if (disposed || current !== generation) return;
      const tokens = session.getTokensSnapshot();
      const currentUser = session.userInfo$.value;
      await store.setGoogleDriveTokens(
        accessToken && tokens && currentUser?.sub === owner
          ? {
              accessToken,
              expiresAt: tokens.expiresAt,
              accountId: owner,
            }
          : null,
        owner
      );
    };
    const update = () =>
      void publish().catch(error =>
        console.error('Unable to refresh Drive sync credentials', error)
      );
    const subscriptions = [
      session.status$.subscribe(update),
      session.userInfo$.subscribe(update),
    ];
    let lastRefresh = 0;
    subscriptions.push(
      store.googleDriveAuthRequired$().subscribe(() => {
        if (Date.now() - lastRefresh < 30000) return;
        lastRefresh = Date.now();
        void publish(true).catch(error =>
          console.error('Unable to refresh Drive sync authorization', error)
        );
      })
    );
    const timer = setInterval(update, 30000);
    const channel = new BroadcastChannel('nota-google-drive-workspace-changed');
    channel.addEventListener('message', update);
    this.disposables.push(() => {
      disposed = true;
      generation++;
      clearInterval(timer);
      channel.close();
      subscriptions.forEach(subscription => subscription.unsubscribe());
    });
  }

  start() {
    if (this.started) {
      throw new Error('Engine is already started');
    }
    this.started = true;

    const { store, dispose } = this.nbstoreService.openStore(
      (this.props.isSharedMode ? 'shared:' : '') +
        `workspace:${this.workspaceService.workspace.flavour}:${this.workspaceService.workspace.id}`,
      this.props.engineWorkerInitOptions
    );
    if (
      this.featureFlagService.flags.enable_battery_save_mode.value &&
      isServerBackedWorkspaceFlavour(this.workspaceService.workspace.flavour)
    ) {
      store.enableBatterySaveMode().catch(err => {
        console.error('error enabling battery save mode', err);
      });
    }
    this.client = store;
    if (this.workspaceService.workspace.flavour === 'google-drive')
      this.bindGoogleDriveSession(store);
    this.disposables.push(dispose);
    this.eventBus.emit(WorkspaceEngineBeforeStart, this);

    const rootDoc = this.workspaceService.workspace.docCollection.doc;
    // priority load root doc
    this.doc.addPriority(rootDoc.guid, 100);
    this.indexer.addPriority(rootDoc.guid, 100);
    this.doc.start();
    this.disposables.push(() => this.doc.stop());

    // fully migrate blobs from v1 to v2, its won't do anything if v1 storage is not exist
    store.blobFrontend.fullDownload('v1').catch(() => {
      // should never reach here
    });
  }
}
