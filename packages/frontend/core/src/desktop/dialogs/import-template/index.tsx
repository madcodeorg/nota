import type { DocMode } from '@blocksuite/affine/model';
import { AllDocsIcon } from '@blocksuite/icons/rc';
import { Button, Modal } from '@nota/component';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { useNavigateHelper } from '@nota/core/components/hooks/use-navigate-helper';
import { useWorkspaceName } from '@nota/core/components/hooks/use-workspace-info';
import { WorkspaceSelector } from '@nota/core/components/workspace-selector';
import { AuthService } from '@nota/core/modules/cloud';
import {
  type DialogComponentProps,
  type GLOBAL_DIALOG_SCHEMA,
} from '@nota/core/modules/dialogs';
import {
  ImportTemplateService,
  TemplateDownloaderService,
} from '@nota/core/modules/import-template';
import {
  type WorkspaceMetadata,
  WorkspacesService,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { cssVar } from '@toeverything/theme';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './dialog.css';

const Dialog = ({
  templateName,
  templateMode,
  snapshotUrl,
  onClose,
}: {
  templateName: string;
  templateMode: DocMode;
  snapshotUrl: string;
  onClose?: () => void;
}) => {
  const t = useI18n();
  const session = useService(AuthService).session;
  const notLogin = useLiveData(session.status$) === 'unauthenticated';
  const isSessionRevalidating = useLiveData(session.isRevalidating$);

  const [importing, setImporting] = useState(false);
  const [importingError, setImportingError] = useState<any>(null);
  const workspacesService = useService(WorkspacesService);
  const templateDownloaderService = useService(TemplateDownloaderService);
  const importTemplateService = useService(ImportTemplateService);
  const templateDownloader = templateDownloaderService.downloader;
  const isDownloading = useLiveData(templateDownloader.isDownloading$);
  const downloadError = useLiveData(templateDownloader.error$);
  const workspaces = useLiveData(workspacesService.list.workspaces$);
  const [rawSelectedWorkspace, setSelectedWorkspace] =
    useState<WorkspaceMetadata | null>(null);
  const selectedWorkspace =
    rawSelectedWorkspace ??
    workspaces.find(w => w.flavour !== 'local') ??
    workspaces.at(0);
  const selectedWorkspaceName = useWorkspaceName(selectedWorkspace);
  const { openPage, jumpToSignIn } = useNavigateHelper();

  const noWorkspace = workspaces.length === 0;

  useEffect(() => {
    workspacesService.list.revalidate();
  }, [workspacesService]);

  useEffect(() => {
    session.revalidate();
  }, [session]);

  useEffect(() => {
    if (!isSessionRevalidating && notLogin) {
      jumpToSignIn(
        '/template/import?' +
          '&name=' +
          templateName +
          '&mode=' +
          templateMode +
          '&snapshotUrl=' +
          snapshotUrl
      );
      onClose?.();
    }
  }, [
    isSessionRevalidating,
    jumpToSignIn,
    notLogin,
    onClose,
    snapshotUrl,
    templateName,
    templateMode,
  ]);

  useEffect(() => {
    templateDownloader.download({ snapshotUrl });
  }, [snapshotUrl, templateDownloader]);

  const handleSelectedWorkspace = useCallback(
    (workspaceMetadata: WorkspaceMetadata) => {
      return setSelectedWorkspace(workspaceMetadata);
    },
    []
  );

  const handleCreatedWorkspace = useCallback(
    (payload: { metadata: WorkspaceMetadata; defaultDocId?: string }) => {
      return setSelectedWorkspace(payload.metadata);
    },
    []
  );

  const handleImportToSelectedWorkspace = useAsyncCallback(async () => {
    if (templateDownloader.data$.value && selectedWorkspace) {
      setImporting(true);
      try {
        const docId = await importTemplateService.importToWorkspace(
          selectedWorkspace,
          templateDownloader.data$.value,
          templateMode
        );
        openPage(selectedWorkspace.id, docId);
        onClose?.();
      } catch (err) {
        setImportingError(err);
      } finally {
        setImporting(false);
      }
    }
  }, [
    importTemplateService,
    onClose,
    openPage,
    selectedWorkspace,
    templateDownloader.data$.value,
    templateMode,
  ]);

  const handleImportToNewWorkspace = useAsyncCallback(async () => {
    if (!templateDownloader.data$.value) {
      return;
    }
    setImporting(true);
    try {
      const { workspaceId, docId } =
        await importTemplateService.importToNewWorkspace(
          // TODO: support selfhosted
          'nota-cloud',
          'Workspace',
          templateDownloader.data$.value
        );
      openPage(workspaceId, docId);
      onClose?.();
    } catch (err) {
      setImportingError(err);
    } finally {
      setImporting(false);
    }
  }, [
    importTemplateService,
    onClose,
    openPage,
    templateDownloader.data$.value,
  ]);

  const disabled = isDownloading || importing || notLogin;

  return (
    <>
      <div className={styles.dialogContainer}>
        <AllDocsIcon className={styles.mainIcon} />
        <h6 className={styles.mainTitle}>
          {t['com.affine.import-template.dialog.createDocWithTemplate']({
            templateName,
          })}
        </h6>
        {noWorkspace ? (
          <p className={styles.desc}>A new workspace will be created.</p>
        ) : (
          <>
            <p className={styles.desc}>Choose a workspace.</p>
            <WorkspaceSelector
              workspaceMetadata={selectedWorkspace}
              onSelectWorkspace={handleSelectedWorkspace}
              onCreatedWorkspace={handleCreatedWorkspace}
              className={styles.workspaceSelector}
              showArrowDownIcon
              disable={disabled}
              menuContentOptions={{
                side: 'top',
                style: {
                  maxHeight: 'min(600px, calc(50vh + 50px))',
                  width: 352,
                  maxWidth: 'calc(100vw - 20px)',
                },
              }}
            />
          </>
        )}
      </div>
      {importingError && (
        <span style={{ color: cssVar('warningColor') }}>
          {t['com.affine.import-template.dialog.errorImport']()}
        </span>
      )}
      {downloadError ? (
        <span style={{ color: cssVar('warningColor') }}>
          {t['com.affine.import-template.dialog.errorLoad']()}
        </span>
      ) : selectedWorkspace ? (
        <Button
          className={styles.mainButton}
          variant={disabled ? 'secondary' : 'primary'}
          loading={disabled}
          disabled={disabled}
          onClick={handleImportToSelectedWorkspace}
          data-testid="import-template-to-workspace-btn"
        >
          {selectedWorkspaceName &&
            t['com.affine.import-template.dialog.createDocToWorkspace']({
              workspace: selectedWorkspaceName,
            })}
        </Button>
      ) : (
        <Button
          className={styles.mainButton}
          variant="primary"
          loading={disabled}
          disabled={disabled}
          onClick={handleImportToNewWorkspace}
        >
          {t['com.affine.import-template.dialog.createDocToNewWorkspace']()}
        </Button>
      )}
    </>
  );
};

export const ImportTemplateDialog = ({
  close,
  snapshotUrl,
  templateName,
  templateMode,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['import-template']>) => {
  return (
    <Modal
      open
      modal={true}
      persistent
      withoutCloseButton
      contentOptions={{
        className: styles.modal,
      }}
      onOpenChange={() => close()}
    >
      <Dialog
        templateName={templateName}
        templateMode={templateMode}
        snapshotUrl={snapshotUrl}
        onClose={() => close()}
      />
    </Modal>
  );
};
