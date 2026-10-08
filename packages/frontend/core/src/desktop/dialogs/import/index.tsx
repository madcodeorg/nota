import { openFilesWith } from '@blocksuite/affine/shared/utils';
import type { Workspace } from '@blocksuite/affine/store';
import {
  DocxTransformer,
  HtmlTransformer,
  MarkdownTransformer,
  NotionHtmlTransformer,
  ZipTransformer,
} from '@blocksuite/affine/widgets/linked-doc';
import {
  ExportToHtmlIcon,
  ExportToMarkdownIcon,
  FileIcon,
  HelpIcon,
  NotionIcon,
  PageIcon,
  SaveIcon,
  ZipIcon,
} from '@blocksuite/icons/rc';
import { Button, IconButton, IconType, Modal } from '@nota/component';
import { getStoreManager } from '@nota/core/blocksuite/manager/store';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { useNavigateHelper } from '@nota/core/components/hooks/use-navigate-helper';
import {
  type DialogComponentProps,
  GlobalDialogService,
  type WORKSPACE_DIALOG_SCHEMA,
} from '@nota/core/modules/dialogs';
import { ExplorerIconService } from '@nota/core/modules/explorer-icon/services/explorer-icon';
import { OrganizeService } from '@nota/core/modules/organize';
import { UrlService } from '@nota/core/modules/url';
import {
  getAFFiNEWorkspaceSchema,
  type WorkspaceMetadata,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { DebugLogger } from '@nota/debug';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import track from '@nota/track';
import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import {
  type ReactElement,
  type SVGAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CSV_MAX_BYTES, decodeCsv, parseCsv, suggestCsvMapping } from './csv';
import { prepareCsvImport, publishCsvImport } from './csv-import';
import { CsvImportPreview } from './csv-preview';
import { importFiles, stageContentImport } from './staged-import';
import * as style from './styles.css';

const logger = new DebugLogger('import');

type NotionPageIcon = {
  type: 'emoji' | 'image';
  content: string; // emoji unicode or image URL/data
};

type FolderHierarchy = {
  name: string;
  path: string;
  children: Map<string, FolderHierarchy>;
  pageId?: string;
  parentPath?: string;
  icon?: NotionPageIcon;
};

// Helper function to create folder structure using OrganizeService
function createFolderStructure(
  organizeService: OrganizeService,
  hierarchy: FolderHierarchy,
  parentFolderId: string | null = null,
  explorerIconService?: ExplorerIconService
): {
  folderId: string | null;
  docLinks: Array<{ folderId: string; docId: string }>;
} {
  const docLinks: Array<{ folderId: string; docId: string }> = [];
  const rootFolder = organizeService.folderTree.rootFolder;

  function processHierarchyNode(
    node: FolderHierarchy,
    currentParentId: string | null
  ): string | null {
    let currentFolderId = currentParentId;

    // If this node represents a folder (has children but no pageId), create it
    if (node.children.size > 0 && !node.pageId && node.name) {
      const parent = currentParentId
        ? organizeService.folderTree.folderNode$(currentParentId).value
        : rootFolder;

      if (parent) {
        const index = parent.indexAt('after');
        currentFolderId = parent.createFolder(node.name, index);
      }
    }

    // Process all children
    for (const child of node.children.values()) {
      if (child.pageId) {
        // This is a document, link it to the current folder
        if (currentFolderId) {
          docLinks.push({ folderId: currentFolderId, docId: child.pageId });
        }

        // Set icon for the document if available
        if (child.icon && explorerIconService) {
          logger.debug('=== Setting icon for document ===');
          logger.debug('Document ID:', child.pageId);
          logger.debug('Icon data:', child.icon);

          try {
            let iconData;
            if (child.icon.type === 'emoji') {
              iconData = {
                type: IconType.Emoji as const,
                unicode: child.icon.content,
              };
              logger.debug('Created emoji icon data:', iconData);
            } else if (child.icon.type === 'image') {
              // For image icons, we'd need to handle blob conversion
              // For now, let's skip image icons or convert them to default
              // This could be enhanced later to download and convert images to blobs
              logger.debug(
                'Skipping image icon (not implemented):',
                child.icon.content
              );
              iconData = undefined;
            }

            if (iconData) {
              logger.debug('Calling explorerIconService.setIcon with:', {
                where: 'doc',
                id: child.pageId,
                icon: iconData,
              });
              explorerIconService.setIcon({
                where: 'doc',
                id: child.pageId,
                icon: iconData,
              });
              logger.debug('Icon set successfully for document:', child.pageId);
            } else {
              logger.debug('No valid icon data to set');
            }
          } catch (error) {
            logger.error(
              'Error setting icon for document:',
              child.pageId,
              error
            );
            logger.warn(
              'Failed to set icon for document:',
              child.pageId,
              error
            );
          }
        } else {
          if (!child.icon) {
            logger.debug('No icon found for document:', child.pageId);
          }
          if (!explorerIconService) {
            logger.debug(
              'ExplorerIconService not available for document:',
              child.pageId
            );
          }
        }
      } else if (child.children.size > 0) {
        // This is a subfolder, process it recursively
        processHierarchyNode(child, currentFolderId);
      }
    }

    return currentFolderId;
  }

  const rootFolderId = processHierarchyNode(hierarchy, parentFolderId);
  return { folderId: rootFolderId, docLinks };
}

type ImportType =
  | 'csv'
  | 'markdown'
  | 'markdownZip'
  | 'notion'
  | 'snapshot'
  | 'html'
  | 'docx'
  | 'dotaffinefile';
type AcceptType = 'Markdown' | 'Zip' | 'Html' | 'Docx' | 'Skip'; // Skip is used for dotaffinefile
type Status = 'idle' | 'csv' | 'importing' | 'success' | 'error';
type ImportResult = {
  report?: string[];
  docIds: string[];
  entryId?: string;
  isWorkspaceFile?: boolean;
  rootFolderId?: string;
};

type ImportConfig = {
  fileOptions: { acceptType: AcceptType; multiple: boolean };
  importFunction: (
    docCollection: Workspace,
    files: File[],
    handleImportAffineFile: () => Promise<WorkspaceMetadata | undefined>,
    organizeService?: OrganizeService,
    explorerIconService?: ExplorerIconService,
    signal?: AbortSignal
  ) => Promise<ImportResult>;
};

const importOptions = [
  {
    key: 'markdown',
    label: 'com.affine.import.markdown-files',
    prefixIcon: (
      <ExportToMarkdownIcon
        color={cssVarV2('icon/primary')}
        width={20}
        height={20}
      />
    ),
    testId: 'editor-option-menu-import-markdown-files',
    type: 'markdown' as ImportType,
  },
  {
    key: 'markdownZip',
    label: 'com.affine.import.markdown-with-media-files',
    prefixIcon: (
      <ZipIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.affine.import.markdown-with-media-files.tooltip',
    testId: 'editor-option-menu-import-markdown-with-media',
    type: 'markdownZip' as ImportType,
  },
  {
    key: 'html',
    label: 'com.affine.import.html-files',
    prefixIcon: (
      <ExportToHtmlIcon
        color={cssVarV2('icon/primary')}
        width={20}
        height={20}
      />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.affine.import.html-files.tooltip',
    testId: 'editor-option-menu-import-html',
    type: 'html' as ImportType,
  },
  {
    key: 'notion',
    label: 'com.affine.import.notion',
    prefixIcon: <NotionIcon color={cssVar('black')} width={20} height={20} />,
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.affine.import.notion.tooltip',
    testId: 'editor-option-menu-import-notion',
    type: 'notion' as ImportType,
  },
  {
    key: 'docx',
    label: 'com.affine.import.docx',
    prefixIcon: <FileIcon color={cssVar('black')} width={20} height={20} />,
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.affine.import.docx.tooltip',
    testId: 'editor-option-menu-import-docx',
    type: 'docx' as ImportType,
  },
  {
    key: 'snapshot',
    label: 'com.affine.import.snapshot',
    prefixIcon: (
      <PageIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.affine.import.snapshot.tooltip',
    testId: 'editor-option-menu-import-snapshot',
    type: 'snapshot' as ImportType,
  },
  BUILD_CONFIG.isElectron
    ? {
        key: 'dotaffinefile',
        label: 'com.affine.import.dotaffinefile',
        prefixIcon: (
          <SaveIcon color={cssVarV2('icon/primary')} width={20} height={20} />
        ),
        suffixIcon: (
          <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
        ),
        suffixTooltip: 'com.affine.import.dotaffinefile.tooltip',
        testId: 'editor-option-menu-import-dotaffinefile',
        type: 'dotaffinefile' as ImportType,
      }
    : null,
].filter(v => v !== null);

const importConfigs: Record<Exclude<ImportType, 'csv'>, ImportConfig> = {
  markdown: {
    fileOptions: { acceptType: 'Markdown', multiple: true },
    importFunction: async (
      docCollection,
      files,
      _handleImportAffineFile,
      _organizeService,
      _explorerIconService
    ) => {
      const docIds = await importFiles(files, async file => {
        const text = await file.text();
        const fileName = file.name.split('.').slice(0, -1).join('.');
        return MarkdownTransformer.importMarkdownToDoc({
          collection: docCollection,
          schema: getAFFiNEWorkspaceSchema(),
          markdown: text,
          fileName,
          extensions: getStoreManager().config.init().value.get('store'),
        });
      });
      return {
        docIds,
      };
    },
  },
  markdownZip: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportAffineFile,
      _organizeService,
      _explorerIconService
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single zip file for markdownZip import');
      }
      const docIds = await MarkdownTransformer.importMarkdownZip({
        collection: docCollection,
        schema: getAFFiNEWorkspaceSchema(),
        imported: file,
        extensions: getStoreManager().config.init().value.get('store'),
      });
      return {
        docIds,
      };
    },
  },
  html: {
    fileOptions: { acceptType: 'Html', multiple: true },
    importFunction: async (
      docCollection,
      files,
      _handleImportAffineFile,
      _organizeService,
      _explorerIconService
    ) => {
      const docIds = await importFiles(files, async file => {
        const text = await file.text();
        const fileName = file.name.split('.').slice(0, -1).join('.');
        return HtmlTransformer.importHTMLToDoc({
          collection: docCollection,
          schema: getAFFiNEWorkspaceSchema(),
          extensions: getStoreManager().config.init().value.get('store'),
          html: text,
          fileName,
        });
      });
      return {
        docIds,
      };
    },
  },
  notion: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportAffineFile,
      organizeService,
      explorerIconService,
      signal
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single zip file for notion import');
      }
      const report: string[] = [];
      const { entryId, pageIds, isWorkspaceFile, folderHierarchy } =
        await NotionHtmlTransformer.importNotionZip({
          collection: docCollection,
          schema: getAFFiNEWorkspaceSchema(),
          imported: file,
          signal,
          extensions: getStoreManager().config.init().value.get('store'),
          importCsv: async (staging, file, docId, title) => {
            if (file.size > CSV_MAX_BYTES)
              throw new Error('CSV imports are limited to 20 MB.');
            const preview = parseCsv(
              decodeCsv(new Uint8Array(await file.arrayBuffer()))
            );
            const job = prepareCsvImport(
              staging,
              preview,
              suggestCsvMapping(preview),
              title,
              docId
            );
            publishCsvImport(staging, job);
            const doc = staging.getDoc(docId);
            if (!doc)
              throw new Error('The imported database could not be prepared.');
            report.push(
              `${title}: imported ${job.rowCount} database rows.`,
              ...job.warnings
            );
            return doc.getStore();
          },
        });

      let rootFolderId: string | undefined;

      // Create folder structure if hierarchy exists and OrganizeService is available
      if (
        folderHierarchy &&
        organizeService &&
        folderHierarchy.children.size > 0
      ) {
        try {
          const { folderId, docLinks } = createFolderStructure(
            organizeService,
            folderHierarchy,
            null,
            explorerIconService
          );
          rootFolderId = folderId || undefined;

          // Create links for all documents to their respective folders
          for (const { folderId, docId } of docLinks) {
            const folder =
              organizeService.folderTree.folderNode$(folderId).value;
            if (folder) {
              const index = folder.indexAt('after');
              folder.createLink('doc', docId, index);
            }
          }
        } catch (error) {
          logger.warn('Failed to create folder structure:', error);
          // Continue with import even if folder creation fails
        }
      }

      return {
        docIds: pageIds,
        entryId,
        isWorkspaceFile,
        rootFolderId,
        report: report.length
          ? [
              ...report,
              'Notion CSV values are mapped to supported Nota columns. Source relation, formula and view definitions are not included in ordinary CSV exports; any supplied values remain readable.',
            ]
          : undefined,
      };
    },
  },
  docx: {
    fileOptions: { acceptType: 'Docx', multiple: false },
    importFunction: async (docCollection, file) => {
      const files = Array.isArray(file) ? file : [file];
      const docIds = await importFiles(files, file =>
        DocxTransformer.importDocx({
          collection: docCollection,
          schema: getAFFiNEWorkspaceSchema(),
          imported: file,
          extensions: getStoreManager().config.init().value.get('store'),
        })
      );
      return { docIds };
    },
  },
  snapshot: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportAffineFile,
      _organizeService,
      _explorerIconService,
      signal
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single zip file for snapshot import');
      }
      const docIds = (
        await ZipTransformer.importDocs(
          docCollection,
          getAFFiNEWorkspaceSchema(),
          file,
          signal
        )
      )
        .filter(doc => doc !== undefined)
        .map(doc => doc.id);

      return {
        docIds,
      };
    },
  },
  dotaffinefile: {
    fileOptions: { acceptType: 'Skip', multiple: false },
    importFunction: async (
      _,
      __,
      handleImportAffineFile,
      _organizeService,
      _explorerIconService
    ) => {
      await handleImportAffineFile();
      return {
        docIds: [],
        entryId: undefined,
        isWorkspaceFile: true,
      };
    },
  },
};

const ImportOptionItem = ({
  label,
  prefixIcon,
  suffixIcon,
  suffixTooltip,
  type,
  onImport,
  ...props
}: {
  label: string;
  prefixIcon: ReactElement<SVGAttributes<SVGElement>>;
  suffixIcon?: ReactElement<SVGAttributes<SVGElement>>;
  suffixTooltip?: string;
  type: ImportType;
  onImport: (type: ImportType) => void;
}) => {
  const t = useI18n();
  return (
    <button
      type="button"
      className={style.importItem}
      onClick={() => onImport(type)}
      {...props}
    >
      {prefixIcon}
      <div className={style.importItemLabel}>{t[label]()}</div>
      {suffixIcon && (
        <IconButton
          className={style.importItemSuffix}
          icon={suffixIcon}
          tooltip={suffixTooltip ? t[suffixTooltip]() : undefined}
        />
      )}
    </button>
  );
};

const ImportOptions = ({
  onImport,
}: {
  onImport: (type: ImportType) => void;
}) => {
  const t = useI18n();

  return (
    <>
      <div className={style.importModalTitle}>{t['Import']()}</div>
      <div className={style.importModalContent}>
        <button
          type="button"
          className={style.importItem}
          onClick={() => onImport('csv')}
          data-testid="editor-option-menu-import-csv"
        >
          <FileIcon width={20} height={20} />
          <div className={style.importItemLabel}>CSV database</div>
        </button>
        {importOptions.map(
          ({
            key,
            label,
            prefixIcon,
            suffixIcon,
            suffixTooltip,
            testId,
            type,
          }) => (
            <ImportOptionItem
              key={key}
              prefixIcon={prefixIcon}
              suffixIcon={suffixIcon}
              suffixTooltip={suffixTooltip}
              label={label}
              type={type}
              onImport={onImport}
              data-testid={testId}
            />
          )
        )}
      </div>
      <div className={style.importModalTip}>
        {t['com.affine.import.modal.tip']()}{' '}
        <a
          className={style.link}
          href={BUILD_CONFIG.discordUrl}
          target="_blank"
          rel="noreferrer"
        >
          Discord
        </a>
        .
      </div>
    </>
  );
};

const ImportingStatus = ({ onCancel }: { onCancel: () => void }) => {
  const t = useI18n();
  return (
    <>
      <div className={style.importModalTitle}>
        {t['com.affine.import.status.importing.title']()}
      </div>
      <p className={style.importStatusContent}>
        {t['com.affine.import.status.importing.message']()}
      </p>
      <div className={style.importModalButtonContainer}>
        <Button onClick={onCancel}>Cancel import</Button>
      </div>
    </>
  );
};

const SuccessStatus = ({
  onComplete,
  report,
}: {
  onComplete: () => void;
  report?: string[];
}) => {
  const t = useI18n();
  return (
    <>
      <div className={style.importModalTitle}>
        {t['com.affine.import.status.success.title']()}
      </div>
      {report?.map(message => (
        <p className={style.importModalTip} key={message}>
          {message}
        </p>
      ))}
      <p className={style.importStatusContent}>
        {t['com.affine.import.status.success.message']()}{' '}
        <a
          className={style.link}
          href={BUILD_CONFIG.discordUrl}
          target="_blank"
          rel="noreferrer"
        >
          Discord
        </a>
        .
      </p>
      <div className={style.importModalButtonContainer}>
        <Button onClick={onComplete} variant="primary">
          {t['Complete']()}
        </Button>
      </div>
    </>
  );
};

const ErrorStatus = ({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) => {
  const t = useI18n();
  const urlService = useService(UrlService);
  return (
    <>
      <div className={style.importModalTitle}>
        {t['com.affine.import.status.failed.title']()}
      </div>
      <p className={style.importStatusContent}>
        {error || 'Unknown error occurred'}
      </p>
      <div className={style.importModalButtonContainer}>
        <Button
          onClick={() => {
            urlService.openPopupWindow(BUILD_CONFIG.discordUrl);
          }}
          variant="secondary"
        >
          {t['Feedback']()}
        </Button>
        <Button onClick={onRetry} variant="primary">
          {t['Retry']()}
        </Button>
      </div>
    </>
  );
};

export const ImportDialog = ({
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['import']>) => {
  const t = useI18n();
  const [status, setStatus] = useState<Status>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [csvFile, setCsvFile] = useState<{
    bytes: Uint8Array;
    name: string;
  } | null>(null);
  const [importReport, setImportReport] = useState<string[]>([]);
  const importController = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => importController.current?.abort(), []);
  const workspace = useService(WorkspaceService).workspace;
  const docCollection = workspace.docCollection;
  const organizeService = useService(OrganizeService);
  const explorerIconService = useService(ExplorerIconService);

  const globalDialogService = useService(GlobalDialogService);

  const { jumpToPage } = useNavigateHelper();
  const handleCreatedWorkspace = useCallback(
    (payload: { metadata: WorkspaceMetadata; defaultDocId?: string }) => {
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          if (payload.defaultDocId) {
            jumpToPage(payload.metadata.id, payload.defaultDocId);
          } else {
            jumpToPage(payload.metadata.id, 'all');
          }
          return new Promise(resolve =>
            setTimeout(resolve, 150)
          ); /* start transition after 150ms */
        });
      } else {
        if (payload.defaultDocId) {
          jumpToPage(payload.metadata.id, payload.defaultDocId);
        } else {
          jumpToPage(payload.metadata.id, 'all');
        }
      }
    },
    [jumpToPage]
  );

  const handleImportAffineFile = useMemo(() => {
    return async () => {
      track.$.navigationPanel.workspaceList.createWorkspace({
        control: 'import',
      });

      return new Promise<WorkspaceMetadata | undefined>((resolve, reject) => {
        globalDialogService.open('import-workspace', undefined, payload => {
          if (payload) {
            // Notify the source workspace before navigation unmounts its
            // dialog, so onboarding can resume after this successful import.
            close({ docIds: [], isWorkspaceFile: true });
            handleCreatedWorkspace({ metadata: payload.workspace });
            resolve(payload.workspace);
          } else {
            reject(new Error('No workspace imported'));
          }
        });
      });
    };
  }, [close, globalDialogService, handleCreatedWorkspace]);

  const handleImport = useAsyncCallback(
    async (type: ImportType) => {
      importController.current?.abort();
      const request = new AbortController();
      importController.current = request;
      setImportError(null);
      setImportReport([]);
      try {
        if (type === 'csv') {
          const files = await openFilesWith('Csv', false);
          request.signal.throwIfAborted();
          if (!files?.length) return;
          const file = files[0];
          if (file.size > CSV_MAX_BYTES)
            throw new Error('CSV imports are limited to 20 MB.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          request.signal.throwIfAborted();
          setCsvFile({
            bytes,
            name: file.name,
          });
          setStatus('csv');
          return;
        }
        const importConfig = importConfigs[type];
        const { acceptType, multiple } = importConfig.fileOptions;

        const files =
          acceptType === 'Skip'
            ? []
            : await openFilesWith(acceptType, multiple);
        request.signal.throwIfAborted();

        if (!files || (files.length === 0 && acceptType !== 'Skip')) {
          throw new Error(
            t['com.affine.import.status.failed.message.no-file-selected']()
          );
        }

        if (acceptType !== 'Skip') {
          setStatus('importing');
          track.$.importModal.$.import({
            type,
            status: 'importing',
          });
        }

        const prepare = (collection: Workspace) =>
          importConfig.importFunction(
            collection,
            files,
            handleImportAffineFile,
            organizeService,
            explorerIconService,
            request.signal
          );
        const { docIds, entryId, isWorkspaceFile, rootFolderId, report } =
          type === 'snapshot' || type === 'notion' || type === 'dotaffinefile'
            ? await prepare(docCollection)
            : await stageContentImport(docCollection, prepare, request.signal);
        request.signal.throwIfAborted();

        setImportResult({ docIds, entryId, isWorkspaceFile, rootFolderId });
        setImportReport([
          `Imported ${docIds.length} page${docIds.length === 1 ? '' : 's'}.`,
          ...(report ?? []),
        ]);
        setStatus('success');
        track.$.importModal.$.import({
          type,
          status: 'success',
          result: {
            docCount: docIds.length,
          },
        });
        track.$.importModal.$.createDoc({
          control: 'import',
        });
      } catch (error) {
        if (request.signal.aborted) return;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        setImportError(errorMessage);
        setStatus('error');
        track.$.importModal.$.import({
          type,
          status: 'failed',
          error: errorMessage || undefined,
        });
        logger.error('Failed to import', error);
      } finally {
        if (importController.current === request)
          importController.current = undefined;
      }
    },
    [
      docCollection,
      explorerIconService,
      handleImportAffineFile,
      organizeService,
      t,
    ]
  );

  const handleComplete = useCallback(() => {
    close(importResult || undefined);
  }, [importResult, close]);

  const handleRetry = () => {
    setStatus('idle');
  };

  const statusComponents = {
    idle: <ImportOptions onImport={handleImport} />,
    csv: csvFile && (
      <CsvImportPreview
        bytes={csvFile.bytes}
        fileName={csvFile.name}
        workspace={docCollection}
        onCancel={() => setStatus('idle')}
        onImported={job => {
          setImportResult({ docIds: [job.docId], entryId: job.docId });
          setImportReport([
            `Imported ${job.rowCount} rows into ${job.title}.`,
            ...job.warnings,
          ]);
          setStatus('success');
          track.$.importModal.$.import({
            type: 'csv',
            status: 'success',
            result: { docCount: 1 },
          });
        }}
      />
    ),
    importing: (
      <ImportingStatus
        onCancel={() => {
          importController.current?.abort();
          setStatus('idle');
        }}
      />
    ),
    success: (
      <SuccessStatus onComplete={handleComplete} report={importReport} />
    ),
    error: <ErrorStatus error={importError} onRetry={handleRetry} />,
  };

  return (
    <Modal
      open
      onOpenChange={(open: boolean) => {
        if (!open) {
          importController.current?.abort();
          close(importResult || undefined);
        }
      }}
      width={status === 'csv' ? 760 : 480}
      contentOptions={{
        ['data-testid' as string]: 'import-modal',
        style: {
          maxHeight: '85vh',
          maxWidth: '70vw',
          minHeight: '126px',
          padding: 0,
          overflow: status === 'csv' ? 'auto' : 'hidden',
          display: 'flex',
          background: cssVarV2('layer/background/primary'),
        },
      }}
      closeButtonOptions={{
        className: style.closeButton,
      }}
      withoutCloseButton={status === 'importing'}
      persistent={status === 'importing'}
    >
      <div className={style.importModalContainer} data-testid="import-dialog">
        {statusComponents[status]}
      </div>
    </Modal>
  );
};
