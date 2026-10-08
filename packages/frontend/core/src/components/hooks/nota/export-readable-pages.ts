import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import {
  AdapterTextUtils,
  docLinkBaseURLMiddleware,
  HtmlAdapter,
  MarkdownAdapter,
  titleMiddleware,
} from '@blocksuite/affine/shared/adapters';
import type { BlockStdScope } from '@blocksuite/affine/std';
import {
  type BlockSnapshot,
  type DocSnapshot,
  getAssetName,
  type Store,
  Transformer,
} from '@blocksuite/affine/store';
import {
  download,
  snapshotBlobIds,
  Zip,
} from '@blocksuite/affine/widgets/linked-doc';
import { getAFFiNEWorkspaceSchema } from '@nota/core/modules/workspace/global-schema';

import {
  readableDatabaseValuesMiddleware,
  serializeDatabaseCsv,
} from './export-database-csv';

export type ReadableExportFormat = 'markdown' | 'html';

function safeName(value: string) {
  return (
    Array.from(value.normalize('NFC').replace(/[\\/:*?"<>|#%]/g, '_'))
      .slice(0, 120)
      .map(char =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char
      )
      .join('')
      .trim()
      .replace(/[. ]+$/, '') || 'Untitled'
  );
}
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function relativePath(path: string) {
  return encodeURIComponent(path).replace(
    /[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function remoteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}
function text(value: string, url?: string) {
  return {
    '$blocksuite:internal:text$': true,
    delta: [{ insert: value, ...(url ? { attributes: { link: url } } : {}) }],
  };
}
function paragraph(block: BlockSnapshot, label: string, url: string) {
  block.flavour = 'affine:paragraph';
  block.props = { type: 'text', text: text(label, url) };
  block.children = [];
}
function walk(block: BlockSnapshot, visit: (block: BlockSnapshot) => void) {
  visit(block);
  block.children.forEach(child => walk(child, visit));
}

export async function waitForExport<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Modify only detached snapshots. Existing adapters render the ordinary links. */
function prepareReadableSnapshot(
  snapshot: DocSnapshot,
  job: Transformer,
  pagePaths: Map<string, string>,
  files: Map<string, File>,
  report: Set<string>
) {
  const baseUrl = job.adapterConfigs.get('docLinkBaseUrl') ?? '';
  const title = (id: string) =>
    job.adapterConfigs.get(`title:${id}`) || 'Linked page';
  const pageUrl = (
    id: string,
    params: Record<string, string | string[]> = {}
  ) => {
    const path = pagePaths.get(id);
    if (path) {
      if (Object.values(params).some(Boolean))
        report.add(
          'Page links open the exported document. Block and canvas navigation are not available in readable files.'
        );
      return `./${relativePath(path)}`;
    }
    report.add(
      `Linked page "${title(id)}" (${id}) is outside this export; its Nota workspace link was retained.`
    );
    return AdapterTextUtils.generateDocUrl(baseUrl, id, params);
  };
  const fileUrl = (id: string) => {
    if (remoteUrl(id)) return id;
    const file = files.get(id);
    if (!file)
      throw new Error(
        'A required local file is missing from the prepared export.'
      );
    return `assets/${relativePath(file.name)}`;
  };
  const rewriteText = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record['$blocksuite:internal:text$'] && Array.isArray(record.delta)) {
      for (const delta of record.delta) {
        const attributes = delta.attributes;
        const reference = attributes?.reference;
        if (reference?.pageId) {
          delta.insert = reference.title || title(String(reference.pageId));
          attributes.link = pageUrl(
            String(reference.pageId),
            reference.params ?? {}
          );
          delete attributes.reference;
        } else if (
          typeof attributes?.link === 'string' &&
          baseUrl &&
          attributes.link.startsWith(`${baseUrl}/`)
        ) {
          const url = attributes.link.slice(baseUrl.length + 1);
          const [id, search = ''] = url.split('?');
          attributes.link = pageUrl(
            id,
            Object.fromEntries(new URLSearchParams(search))
          );
        }
      }
      return;
    }
    Object.values(record).forEach(rewriteText);
  };
  walk(snapshot.blocks, block => {
    rewriteText(block.props);
    if (
      ['affine:embed-linked-doc', 'affine:embed-synced-doc'].includes(
        block.flavour
      )
    ) {
      const id = String(block.props.pageId ?? '');
      if (id)
        paragraph(
          block,
          String(block.props.title || title(id)),
          pageUrl(id, block.props.params as Record<string, string | string[]>)
        );
    } else if (block.flavour === 'affine:attachment') {
      const id = String(block.props.sourceId ?? '');
      if (id)
        paragraph(
          block,
          String(block.props.name || files.get(id)?.name || 'Attached file'),
          fileUrl(id)
        );
    } else if (
      block.flavour === 'affine:image' &&
      remoteUrl(String(block.props.sourceId ?? ''))
    ) {
      const url = String(block.props.sourceId);
      paragraph(block, String(block.props.caption || 'External image'), url);
      report.add(
        'External image references are kept as links; remote media was not downloaded.'
      );
    } else if (block.flavour === 'affine:database') {
      const columns = block.props.columns as { id: string; type: string }[];
      const cells = block.props.cells as Record<
        string,
        Record<string, { value: unknown }>
      >;
      for (const column of columns.filter(
        column => column.type === 'attachment'
      )) {
        for (const row of Object.values(cells)) {
          const cell = row[column.id];
          if (!cell?.value || typeof cell.value !== 'object') continue;
          const delta = Object.entries(cell.value).flatMap(
            ([key, value], index) => {
              const file = value as { id?: string; name?: string } | null;
              const id = file?.id || key;
              return [
                ...(index ? [{ insert: ', ' }] : []),
                {
                  insert: file?.name || files.get(id)?.name || 'Attached file',
                  attributes: { link: fileUrl(id) },
                },
              ];
            }
          );
          cell.value = { '$blocksuite:internal:text$': true, delta };
        }
      }
      report.add(
        'Database views, filters, sorting and grouping are represented by readable table values; the export includes all stored rows. Use a Nota snapshot to preserve interactive behavior.'
      );
    } else if (
      block.flavour === 'affine:surface' &&
      Object.keys((block.props.elements ?? {}) as object).length
    ) {
      report.add(
        'Canvas drawings and layout are not rendered. Canonical local image files are included in the assets folder. Use a Nota snapshot to preserve the canvas.'
      );
    }
  });
}

/** One complete readable archive for exactly the requested pages. */
export async function exportReadablePages(
  pages: readonly Store[],
  format: ReadableExportFormat,
  signal?: AbortSignal,
  std?: BlockStdScope
): Promise<void> {
  signal?.throwIfAborted();
  const selected = [
    ...new Map(pages.map(page => [page.id, page])).values(),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!selected.length) throw new Error('Choose at least one page to export.');
  const workspace = selected[0].workspace;
  if (selected.some(page => page.workspace !== workspace))
    throw new Error('Readable exports must use pages from one workspace.');
  const extension = format === 'html' ? '.html' : '.md';
  const paths = new Map(
    selected.map((page, index) => [
      page.id,
      `${index + 1}-${safeName(page.meta?.title || 'Untitled')}${extension}`,
    ])
  );
  const prepared: { page: Store; job: Transformer; snapshot: DocSnapshot }[] =
    [];
  const targets: { ready: Promise<void>; release(): void }[] = [];
  const reports = new Set<string>();
  try {
    for (const page of selected) {
      signal?.throwIfAborted();
      for (const { model } of page.getBlocksByFlavour('affine:database')) {
        const source = new DatabaseBlockDataSource(model as DatabaseBlockModel);
        const lease = source.acquireRelationTargets();
        targets.push(lease);
        await waitForExport(lease.ready, signal);
      }
      const job = new Transformer({
        schema: getAFFiNEWorkspaceSchema(),
        blobCRUD: workspace.blobSync,
        docCRUD: {
          create: () => {
            throw new Error('Readable export cannot create documents.');
          },
          get: id => workspace.getDoc(id)?.getStore({ id }) ?? null,
          delete: () => {
            throw new Error('Readable export cannot delete documents.');
          },
        },
        middlewares: [
          docLinkBaseURLMiddleware(workspace.id),
          titleMiddleware(workspace.meta.docMetas),
          readableDatabaseValuesMiddleware(page),
        ],
      });
      const snapshot = job.docToSnapshot(page);
      if (!snapshot) {
        job[Symbol.dispose]();
        throw new Error('A selected page could not be exported.');
      }
      prepared.push({ page, job, snapshot });
      walk(snapshot.blocks, block => {
        if (block.flavour === 'affine:database')
          serializeDatabaseCsv(block).warnings.forEach(warning =>
            reports.add(warning)
          );
      });
    }
    const fileIds = [
      ...new Set(
        prepared.flatMap(({ snapshot }) => [...snapshotBlobIds(snapshot)])
      ),
    ]
      .filter(id => !remoteUrl(id))
      .sort();
    const files = new Map<string, File>();
    const firstJob = prepared[0].job;
    for (const [index, id] of fileIds.entries()) {
      signal?.throwIfAborted();
      await waitForExport(firstJob.assetsManager.readFromBlob(id), signal);
      const blob = firstJob.assets.get(id);
      if (!blob)
        throw new Error(
          'A required local attachment or image could not be exported. Make it available locally and retry.'
        );
      files.set(
        id,
        new File(
          [blob],
          `${index + 1}-${safeName(getAssetName(firstJob.assets, id))}`,
          { type: blob.type }
        )
      );
    }
    const zip = new Zip();
    for (const { page, job, snapshot } of prepared) {
      signal?.throwIfAborted();
      for (const [id, file] of files) job.assets.set(id, file);
      prepareReadableSnapshot(snapshot, job, paths, files, reports);
      const provider = std?.store.provider ?? page.provider;
      const adapter =
        format === 'html'
          ? new HtmlAdapter(job, provider)
          : new MarkdownAdapter(job, provider);
      const result = await waitForExport(
        adapter.fromDocSnapshot({ snapshot, assets: job.assetsManager }),
        signal
      );
      if (!result.file)
        throw new Error('A selected page produced no readable content.');
      if (result.assetsIds.some(id => !files.has(id)))
        throw new Error(
          'A required local file is missing from the prepared export.'
        );
      await zip.file(
        paths.get(page.id) ?? 'Untitled',
        format === 'html'
          ? result.file.replace('<head>', '<head><meta charset="utf-8">')
          : result.file
      );
    }
    for (const file of files.values()) {
      signal?.throwIfAborted();
      await zip.folder('assets').file(file.name, file);
    }
    const contents = [...paths]
      .map(
        ([id, path]) =>
          `${workspace.meta.getDocMeta(id)?.title || 'Untitled'}: ${path}`
      )
      .join('\n');
    const assets = [...files.values()]
      .map(file => `assets/${file.name}`)
      .join('\n');
    await zip.file(
      'Export report.txt',
      [
        'Readable Nota export',
        contents,
        assets ? `Included local files:\n${assets}` : '',
        ...reports,
      ]
        .filter(Boolean)
        .join('\n\n')
    );
    const indexLinks = [...paths].map(([id, path]) => ({
      title: workspace.meta.getDocMeta(id)?.title || 'Untitled',
      url: `./${relativePath(path)}`,
    }));
    await zip.file(
      format === 'html' ? 'index.html' : 'index.md',
      format === 'html'
        ? `<!doctype html><html><head><meta charset="utf-8"><title>Nota export</title></head><body><h1>Nota export</h1><ul>${indexLinks.map(link => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.title)}</a></li>`).join('')}</ul></body></html>`
        : `# Nota export\n\n${indexLinks.map(link => `- [${link.title.replace(/\s+/g, ' ').replace(/[\\\x60*_{}[\]()#+.!<>|]/g, '\\$&')}](${link.url})`).join('\n')}\n`
    );
    signal?.throwIfAborted();
    const blob = await zip.generate();
    signal?.throwIfAborted();
    download(blob, `Nota-${format}.zip`);
  } finally {
    prepared.forEach(({ job }) => job[Symbol.dispose]());
    targets.forEach(lease => lease.release());
  }
}
