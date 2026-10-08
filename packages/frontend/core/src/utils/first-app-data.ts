// the following import is used to ensure the block suite editor effects are run
import '../blocksuite/block-suite-editor';

import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { DebugLogger } from '@nota/debug';
import { DEFAULT_WORKSPACE_NAME } from '@nota/env/constant';
import onboardingUrl from '@nota/templates/onboarding.zip';

import { DocsService } from '../modules/doc';
import { OrganizeService } from '../modules/organize';
import {
  getAFFiNEWorkspaceSchema,
  type WorkspacesService,
} from '../modules/workspace';

export async function buildShowcaseWorkspace(
  workspacesService: WorkspacesService,
  flavour: string,
  workspaceName: string
) {
  const meta = await workspacesService.create(flavour, async docCollection => {
    docCollection.meta.initialize();
    docCollection.doc.getMap('meta').set('name', workspaceName);
    const blob = await (await fetch(onboardingUrl)).blob();

    await ZipTransformer.importDocs(
      docCollection,
      getAFFiNEWorkspaceSchema(),
      blob
    );
  });

  const { workspace, dispose } = workspacesService.open({ metadata: meta });

  await workspace.engine.doc.waitForDocReady(workspace.id);

  const docsService = workspace.scope.get(DocsService);

  // should jump to "Getting Started"
  const defaultDoc = docsService.list.docs$.value.find(p =>
    p.title$.value.startsWith('Getting Started')
  );
  const folderTutorialDoc = docsService.list.docs$.value.find(p =>
    p.title$.value.startsWith('How to use folder and Tags')
  );

  // create default organize
  if (folderTutorialDoc) {
    const organizeService = workspace.scope.get(OrganizeService);
    const folderId = organizeService.folderTree.rootFolder.createFolder(
      'First Folder',
      organizeService.folderTree.rootFolder.indexAt('after')
    );
    const firstFolderNode =
      organizeService.folderTree.folderNode$(folderId).value;
    firstFolderNode?.createLink(
      'doc',
      folderTutorialDoc.id,
      firstFolderNode.indexAt('after')
    );
  }

  dispose();

  return { meta, defaultDocId: defaultDoc?.id };
}

const logger = new DebugLogger('createFirstAppData');
let firstWorkspaceCreated = false;

export function isFirstAppOpen() {
  if (firstWorkspaceCreated) return false;
  try {
    return localStorage.getItem('is-first-open') === null;
  } catch {
    return true;
  }
}

const firstWorkspaceCreations = new WeakMap<
  WorkspacesService,
  Promise<{
    meta: Awaited<ReturnType<WorkspacesService['create']>>;
    defaultPageId: string | undefined;
  }>
>();

export async function createFirstAppData(workspacesService: WorkspacesService) {
  const pending = firstWorkspaceCreations.get(workspacesService);
  if (pending) return pending;
  if (!isFirstAppOpen()) {
    return;
  }
  const creation = (async () => {
    const { meta, defaultDocId } = await buildShowcaseWorkspace(
      workspacesService,
      'local',
      DEFAULT_WORKSPACE_NAME
    );
    firstWorkspaceCreated = true;
    try {
      localStorage.setItem('is-first-open', 'false');
    } catch {
      // Workspace data is already saved; an optional preference cannot undo it.
    }
    logger.info('create first workspace', defaultDocId);
    return { meta, defaultPageId: defaultDocId };
  })();
  firstWorkspaceCreations.set(workspacesService, creation);
  try {
    return await creation;
  } finally {
    firstWorkspaceCreations.delete(workspacesService);
  }
}
