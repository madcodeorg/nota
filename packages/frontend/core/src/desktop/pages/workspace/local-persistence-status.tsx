import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { notify } from '@nota/component';
import { Button } from '@nota/component/ui/button';
import {
  getAFFiNEWorkspaceSchema,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { LiveData, useLiveData, useService } from '@nota/infra';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './local-persistence-status.css';

export const LocalPersistenceStatus = () => {
  const workspace = useService(WorkspaceService).workspace;
  const state$ = useMemo(
    () => LiveData.from(workspace.engine.doc.state$, undefined),
    [workspace]
  );
  const state = useLiveData(state$);
  const [exporting, setExporting] = useState(false);
  const error = state?.persistenceErrorMessage;

  useEffect(() => {
    if (!error) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [error]);

  if (!error && !state?.persistenceRetrying) return null;

  const retry = async () => {
    try {
      await workspace.engine.doc.retryPersistence();
    } catch (error) {
      notify.error({
        title: 'Changes are still not saved',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const exportOpenPages = async () => {
    setExporting(true);
    try {
      const pages = Array.from(workspace.docCollection.docs.values())
        .map(doc => doc.getStore())
        .filter(store => store.root);
      if (!pages.length) throw new Error('No open page content is available.');
      await ZipTransformer.exportDocs(
        workspace.docCollection,
        getAFFiNEWorkspaceSchema(),
        pages
      );
    } catch (error) {
      notify.error({
        title: 'Could not export open pages',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.banner} role="alert" data-testid="local-save-error">
      <div>
        <strong>
          {state?.persistenceRetrying
            ? 'Recovering local saves…'
            : 'Your latest changes are not saved on this device'}
        </strong>
        <p className={styles.description}>
          Keep Nota open while you retry. You can export the pages currently
          loaded in this workspace to preserve their latest content.
        </p>
        {error ? <p className={styles.detail}>{error}</p> : null}
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={state?.persistenceRetrying}
          loading={state?.persistenceRetrying}
          onClick={() => {
            retry().catch(console.error);
          }}
        >
          Retry saving
        </Button>
        <Button
          disabled={exporting}
          loading={exporting}
          onClick={() => {
            exportOpenPages().catch(console.error);
          }}
        >
          Export open pages
        </Button>
      </div>
    </div>
  );
};
