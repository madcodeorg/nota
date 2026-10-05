import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { Button } from '@nota/component/ui/button';
import { Modal } from '@nota/component/ui/modal';
import { exportPageData } from '@nota/core/components/hooks/nota/use-export-page';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import {
  type DialogComponentProps,
  type WORKSPACE_DIALOG_SCHEMA,
  WorkspaceDialogService,
} from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { getAFFiNEWorkspaceSchema } from '@nota/core/modules/workspace/global-schema';
import { useService } from '@nota/infra';
import { useEffect, useRef, useState } from 'react';

import * as styles from './styles.css';

type Format = 'snapshot' | 'markdown' | 'html' | 'csv';

export const DataToolsDialog = ({
  close,
  docIds: initialDocIds,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['data-tools']>) => {
  const workspace = useService(WorkspaceService).workspace;
  const docsService = useService(DocsService);
  const dialogs = useService(WorkspaceDialogService);
  const [scope, setScope] = useState<'workspace' | 'pages'>(
    initialDocIds?.length ? 'pages' : 'workspace'
  );
  const [docIds, setDocIds] = useState(initialDocIds ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);
  const local = isUserOwnedWorkspaceFlavour(workspace.flavour);
  useEffect(() => () => controller.current?.abort(), []);

  const dismiss = () => {
    controller.current?.abort();
    close();
  };
  const exportContent = useAsyncCallback(
    async (format: Format) => {
      if (busy || !local) return;
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      setError(undefined);
      setMessage(undefined);
      const opened: ReturnType<DocsService['open']>[] = [];
      try {
        const ids =
          scope === 'workspace'
            ? workspace.docCollection.meta.docMetas
                .filter(meta => !meta.trash)
                .map(meta => meta.id)
            : docIds;
        if (!ids.length) throw new Error('Choose at least one page to export.');
        for (const id of ids) {
          request.signal.throwIfAborted();
          const entry = docsService.open(id);
          opened.push(entry);
          await workspace.engine.doc.waitForDocLoaded(id, request.signal);
        }
        await workspace.engine.doc.waitForUpdated(undefined, request.signal);
        request.signal.throwIfAborted();
        const pages = opened.map(entry => entry.doc.blockSuiteDoc);
        if (format === 'snapshot') {
          await ZipTransformer.exportDocs(
            workspace.docCollection,
            getAFFiNEWorkspaceSchema(),
            pages
          );
        } else {
          for (const page of pages) {
            request.signal.throwIfAborted();
            await exportPageData(page, format);
          }
        }
        if (!request.signal.aborted)
          setMessage(
            `Exported ${pages.length} page${pages.length === 1 ? '' : 's'}.`
          );
      } catch (error) {
        if (!request.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Could not export content.'
          );
      } finally {
        opened.forEach(entry => entry.release());
        if (!request.signal.aborted) setBusy(false);
      }
    },
    [busy, local, workspace, scope, docIds, docsService]
  );

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) dismiss();
      }}
      title="Import, export and recovery"
      width={620}
    >
      <p>
        Bring content into Nota, export readable copies, or keep a complete
        recovery backup.
      </p>
      <div className={styles.actions}>
        <Button
          disabled={busy}
          onClick={() =>
            dialogs.open('import', undefined, result => {
              if (result) close(result);
            })
          }
        >
          Import notes or a database
        </Button>
        {BUILD_CONFIG.isElectron && workspace.flavour === 'local' ? (
          <Button
            disabled={busy}
            onClick={() => {
              close();
              dialogs.open('setting', { activeTab: 'workspace:storage' });
            }}
          >
            Backup and restore
          </Button>
        ) : null}
      </div>
      {local ? (
        <>
          <label className={styles.scope}>
            Export scope
            <select
              aria-label="Export scope"
              disabled={busy}
              value={scope}
              onChange={event =>
                setScope(event.target.value as 'workspace' | 'pages')
              }
            >
              <option value="workspace">Workspace pages</option>
              <option value="pages">Selected pages and databases</option>
            </select>
          </label>
          {scope === 'pages' ? (
            <Button
              disabled={busy}
              onClick={() =>
                dialogs.open('doc-selector', { init: docIds }, selected => {
                  if (selected) setDocIds(selected);
                })
              }
            >
              Choose pages ({docIds.length})
            </Button>
          ) : null}
          <p>
            Workspace export includes active pages. Recovery backups also
            include trash and saved history.
          </p>
          <table className={styles.formats}>
            <thead>
              <tr>
                <th>Format</th>
                <th>Includes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Nota snapshot</th>
                <td>
                  Editable content, property definitions, relations, views and
                  available files.
                </td>
              </tr>
              <tr>
                <th>Markdown / HTML</th>
                <td>
                  Readable notes and table values. Interactive views and
                  formulas become readable output.
                </td>
              </tr>
              <tr>
                <th>CSV database</th>
                <td>
                  Database rows and readable values. Property definitions and
                  attached files need a Nota snapshot.
                </td>
              </tr>
            </tbody>
          </table>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => exportContent('snapshot')}>
              Nota snapshot
            </Button>
            <Button
              disabled={busy || scope === 'workspace'}
              onClick={() => exportContent('markdown')}
            >
              Markdown
            </Button>
            <Button
              disabled={busy || scope === 'workspace'}
              onClick={() => exportContent('html')}
            >
              HTML
            </Button>
            <Button
              disabled={busy || scope === 'workspace'}
              onClick={() => exportContent('csv')}
            >
              CSV databases
            </Button>
          </div>
          <p>
            Readable exports use one download per selected page. CSV exports all
            databases on each selected page.
          </p>
        </>
      ) : null}
      {busy ? <p role="status">Preparing the export…</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
  );
};
