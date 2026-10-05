import { ExportManager } from '@blocksuite/affine/blocks/surface';
import {
  docLinkBaseURLMiddleware,
  embedSyncedDocMiddleware,
  HtmlAdapter,
  HtmlAdapterFactoryIdentifier,
  MarkdownAdapter,
  MarkdownAdapterFactoryIdentifier,
  titleMiddleware,
} from '@blocksuite/affine/shared/adapters';
import { printToPdf } from '@blocksuite/affine/shared/utils';
import type { BlockStdScope } from '@blocksuite/affine/std';
import { type Store, Transformer } from '@blocksuite/affine/store';
import {
  createAssetsArchive,
  download,
  PdfTransformer,
  ZipTransformer,
} from '@blocksuite/affine/widgets/linked-doc';
import { notify } from '@nota/component';
import {
  pushGlobalLoadingEventAtom,
  resolveGlobalLoadingEventAtom,
} from '@nota/component/global-loading';
import type { AffineEditorContainer } from '@nota/core/blocksuite/block-suite-editor/blocksuite-editor';
import { EditorService } from '@nota/core/modules/editor';
import { getAFFiNEWorkspaceSchema } from '@nota/core/modules/workspace/global-schema';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import { useSetAtom } from 'jotai';
import { nanoid } from 'nanoid';

import { useAsyncCallback } from '../nota-async-hooks';
import {
  exportDatabaseCsv,
  readableDatabaseValuesMiddleware,
} from './export-database-csv';

type ExportType =
  | 'csv'
  | 'pdf'
  | 'html'
  | 'png'
  | 'markdown'
  | 'snapshot'
  | 'pdf-export';

interface ExportHandlerOptions {
  page: Store;
  editorContainer: AffineEditorContainer;
  type: ExportType;
}

interface AdapterResult {
  file: string;
  assetsIds: string[];
}

type AdapterFactoryIdentifier =
  | typeof HtmlAdapterFactoryIdentifier
  | typeof MarkdownAdapterFactoryIdentifier;

interface AdapterConfig {
  identifier: AdapterFactoryIdentifier;
  fileExtension: string; // file extension need to be lower case with dot prefix, e.g. '.md', '.txt', '.html'
  contentType: string;
  indexFileName: string;
}

async function exportDoc(
  doc: Store,
  std: BlockStdScope | undefined,
  config: AdapterConfig
) {
  const transformer = new Transformer({
    schema: getAFFiNEWorkspaceSchema(),
    blobCRUD: doc.workspace.blobSync,
    docCRUD: {
      create: (id: string) => doc.workspace.createDoc(id).getStore({ id }),
      get: (id: string) => doc.workspace.getDoc(id)?.getStore({ id }) ?? null,
      delete: (id: string) => doc.workspace.removeDoc(id),
    },
    middlewares: [
      docLinkBaseURLMiddleware(doc.workspace.id),
      titleMiddleware(doc.workspace.meta.docMetas),
      embedSyncedDocMiddleware('content'),
      readableDatabaseValuesMiddleware(doc),
    ],
  });

  const adapter = std
    ? std.store.provider.get(config.identifier).get(transformer)
    : config.identifier === HtmlAdapterFactoryIdentifier
      ? new HtmlAdapter(transformer, doc.provider)
      : new MarkdownAdapter(transformer, doc.provider);
  const result = (await adapter.fromDoc(doc)) as AdapterResult;

  if (!result || (!result.file && !result.assetsIds.length)) {
    throw new Error('The page could not be exported.');
  }

  const docTitle = doc.meta?.title || 'Untitled';
  const contentBlob = new Blob([result.file], { type: config.contentType });
  const report = [
    ...new Set(exportDatabaseCsv(doc).flatMap(database => database.warnings)),
  ];

  let downloadBlob: Blob;
  let name: string;

  if (result.assetsIds.length > 0 || report.length > 0) {
    if (!transformer.assets) {
      throw new Error('No assets found');
    }
    if (result.assetsIds.some(id => !transformer.assets.has(id)))
      throw new Error(
        'A required attachment could not be exported. Make it available locally and retry.'
      );
    const zip = await createAssetsArchive(transformer.assets, result.assetsIds);
    await zip.file(config.indexFileName, contentBlob);
    if (report.length)
      await zip.file(
        'Export report.txt',
        new Blob([report.join('\n\n')], { type: 'text/plain;charset=utf-8' })
      );
    downloadBlob = await zip.generate();
    name = `${docTitle}.zip`;
  } else {
    downloadBlob = contentBlob;
    name = `${docTitle}${config.fileExtension}`;
  }

  download(downloadBlob, name);
}

export async function exportToHtml(doc: Store, std?: BlockStdScope) {
  await exportDoc(doc, std, {
    identifier: HtmlAdapterFactoryIdentifier,
    fileExtension: '.html',
    contentType: 'text/html',
    indexFileName: 'index.html',
  });
}

export async function exportToMarkdown(doc: Store, std?: BlockStdScope) {
  await exportDoc(doc, std, {
    identifier: MarkdownAdapterFactoryIdentifier,
    fileExtension: '.md',
    contentType: 'text/plain',
    indexFileName: 'index.md',
  });
}

export async function exportToCsv(page: Store): Promise<void> {
  const databases = exportDatabaseCsv(page);
  if (!databases.length)
    throw new Error('This page has no databases to export.');
  const report = [...new Set(databases.flatMap(database => database.warnings))];
  if (databases.length === 1 && !report.length) {
    download(
      new Blob([databases[0].csv], { type: 'text/csv;charset=utf-8' }),
      `${databases[0].title}.csv`
    );
  } else {
    const zip = await createAssetsArchive(new Map(), []);
    for (const [index, database] of databases.entries()) {
      const safeName = database.title
        .replace(/[\\/]/g, '_')
        .split('')
        .map(char => (char.charCodeAt(0) < 32 ? '_' : char))
        .join('');
      await zip.file(
        `${index + 1}-${safeName}.csv`,
        new Blob([database.csv], { type: 'text/csv;charset=utf-8' })
      );
    }
    await zip.file(
      'Export report.txt',
      new Blob(
        [
          [
            'CSV contains readable cell values. Use Nota snapshot export to preserve property definitions, relations, attached files and views.',
            ...report,
          ].join('\n\n'),
        ],
        { type: 'text/plain;charset=utf-8' }
      )
    );
    download(
      await zip.generate(),
      `${page.meta?.title || 'Databases'}.csv.zip`
    );
  }
  if (report.length)
    notify.warning({
      title: 'CSV export includes a conversion report',
      message: report.join('\n'),
    });
  return;
}

export async function exportPageData(
  page: Store,
  type: 'csv' | 'html' | 'markdown' | 'snapshot'
): Promise<void> {
  switch (type) {
    case 'csv':
      return exportToCsv(page);
    case 'html':
      return exportToHtml(page);
    case 'markdown':
      return exportToMarkdown(page);
    case 'snapshot':
      return ZipTransformer.exportDocs(
        page.workspace,
        getAFFiNEWorkspaceSchema(),
        [page]
      );
  }
}

async function exportHandler({
  page,
  type,
  editorContainer,
}: ExportHandlerOptions) {
  const editorRoot = document.querySelector('editor-host');
  track.$.sharePanel.$.export({
    type,
  });
  switch (type) {
    case 'csv':
      await exportToCsv(page);
      return;
    case 'html':
      await exportToHtml(page, editorRoot?.std);
      return;
    case 'markdown':
      await exportToMarkdown(page, editorRoot?.std);
      return;
    case 'snapshot':
      await ZipTransformer.exportDocs(
        page.workspace,
        getAFFiNEWorkspaceSchema(),
        [page]
      );
      return;
    case 'pdf':
      await printToPdf(editorContainer);
      return;
    case 'png': {
      await editorRoot?.std.get(ExportManager).exportPng();
      return;
    }
    case 'pdf-export': {
      await PdfTransformer.exportDoc(page);
      return;
    }
  }
}

export const useExportPage = () => {
  const editor = useService(EditorService).editor;
  const editorContainer = useLiveData(editor.editorContainer$);
  const blocksuiteDoc = editor.doc.blockSuiteDoc;
  const pushGlobalLoadingEvent = useSetAtom(pushGlobalLoadingEventAtom);
  const resolveGlobalLoadingEvent = useSetAtom(resolveGlobalLoadingEventAtom);
  const t = useI18n();

  const onClickHandler = useAsyncCallback(
    async (type: ExportType) => {
      if (editorContainer === null) return;

      // editor container is wrapped by a proxy, we need to get the origin
      const originEditorContainer = (editorContainer as any)
        .origin as AffineEditorContainer;

      const globalLoadingID = nanoid();
      pushGlobalLoadingEvent({
        key: globalLoadingID,
      });
      try {
        await exportHandler({
          page: blocksuiteDoc,
          type,
          editorContainer: originEditorContainer,
        });
        notify.success({
          title: t['com.affine.export.success.title'](),
          message: t['com.affine.export.success.message'](),
        });
      } catch (err) {
        console.error(err);
        notify.error({
          title: t['com.affine.export.error.title'](),
          message: t['com.affine.export.error.message'](),
        });
      } finally {
        resolveGlobalLoadingEvent(globalLoadingID);
      }
    },
    [
      blocksuiteDoc,
      editorContainer,
      pushGlobalLoadingEvent,
      resolveGlobalLoadingEvent,
      t,
    ]
  );

  return onClickHandler;
};
