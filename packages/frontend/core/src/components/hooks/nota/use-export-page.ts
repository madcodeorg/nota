import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { ExportManager } from '@blocksuite/affine/blocks/surface';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import { printToPdf } from '@blocksuite/affine/shared/utils';
import type { BlockStdScope } from '@blocksuite/affine/std';
import { type Store } from '@blocksuite/affine/store';
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
import { exportDatabaseCsv } from './export-database-csv';
import { exportReadablePages, waitForExport } from './export-readable-pages';

export { exportReadablePages } from './export-readable-pages';

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

export async function exportToHtml(
  doc: Store,
  std?: BlockStdScope,
  signal?: AbortSignal
) {
  await exportReadablePages([doc], 'html', signal, std);
}

export async function exportToMarkdown(
  doc: Store,
  std?: BlockStdScope,
  signal?: AbortSignal
) {
  await exportReadablePages([doc], 'markdown', signal, std);
}

export async function exportToCsv(
  page: Store,
  signal?: AbortSignal
): Promise<void> {
  const targets: { ready: Promise<void>; release(): void }[] = [];
  try {
    signal?.throwIfAborted();
    for (const { model } of page.getBlocksByFlavour('affine:database')) {
      targets.push(
        new DatabaseBlockDataSource(
          model as DatabaseBlockModel
        ).acquireRelationTargets()
      );
    }
    await waitForExport(
      Promise.all(targets.map(target => target.ready)),
      signal
    );
    signal?.throwIfAborted();
    await downloadCsv(page, signal);
  } finally {
    targets.forEach(target => target.release());
  }
}

async function downloadCsv(page: Store, signal?: AbortSignal): Promise<void> {
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
      signal?.throwIfAborted();
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
    const blob = await zip.generate();
    signal?.throwIfAborted();
    download(blob, `${page.meta?.title || 'Databases'}.csv.zip`);
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
  type: 'csv' | 'html' | 'markdown' | 'snapshot',
  signal?: AbortSignal
): Promise<void> {
  switch (type) {
    case 'csv':
      return exportToCsv(page, signal);
    case 'html':
      return exportToHtml(page, undefined, signal);
    case 'markdown':
      return exportToMarkdown(page, undefined, signal);
    case 'snapshot':
      return ZipTransformer.exportDocs(
        page.workspace,
        getAFFiNEWorkspaceSchema(),
        [page],
        signal
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
