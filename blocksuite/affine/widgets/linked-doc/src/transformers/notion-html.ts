import {
  defaultImageProxyMiddleware,
  getImageFullPath,
  NotionHtmlAdapter,
} from '@blocksuite/affine-shared/adapters';
import { Container } from '@blocksuite/global/di';
import { sha } from '@blocksuite/global/utils';
import {
  type BlockSnapshot,
  type ExtensionType,
  extMimeMap,
  type Schema,
  type Store,
  Transformer,
  type Workspace,
} from '@blocksuite/store';

import { Unzip } from './utils.js';
import { publishStagedWorkspace } from './zip.js';

type ImportNotionZipOptions = {
  collection: Workspace;
  schema: Schema;
  imported: Blob;
  extensions: ExtensionType[];
  signal?: AbortSignal;
  importCsv?: (
    collection: Workspace,
    file: Blob,
    docId: string,
    title: string
  ) => Promise<Store>;
};

type PageIcon = {
  type: 'emoji' | 'image';
  content: string; // emoji unicode or image URL/data
};

type FolderHierarchy = {
  name: string;
  path: string;
  children: Map<string, FolderHierarchy>;
  pageId?: string;
  parentPath?: string;
  icon?: PageIcon;
};

type ImportNotionZipResult = {
  entryId: string | undefined;
  pageIds: string[];
  isWorkspaceFile: boolean;
  hasMarkdown: boolean;
  folderHierarchy?: FolderHierarchy;
};

function getProvider(extensions: ExtensionType[]) {
  const container = new Container();
  extensions.forEach(ext => {
    ext.setup(container);
  });
  return container.provider();
}

function parseFolderPath(filePath: string): {
  folderParts: string[];
  fileName: string;
} {
  const parts = filePath.split('/');
  const fileName = parts.pop() || '';
  return { folderParts: parts.filter(part => part.length > 0), fileName };
}

function extractPageIcon(doc: Document): PageIcon | undefined {
  // Look for Notion page icon in the HTML
  // Notion export format: <div class="page-header-icon undefined"><span class="icon">✅</span></div>

  // Look for the exact Notion export structure: .page-header-icon .icon
  const notionIconSpan = doc.querySelector('.page-header-icon .icon');
  if (notionIconSpan && notionIconSpan.textContent) {
    const iconContent = notionIconSpan.textContent.trim();
    if (/\p{Emoji}/u.test(iconContent)) {
      return {
        type: 'emoji',
        content: iconContent,
      };
    }
  }

  // Fallback: try to find emoji icons with older selectors
  const emojiIcon = doc.querySelector('.page-header-icon .notion-emoji');
  if (emojiIcon && emojiIcon.textContent) {
    return {
      type: 'emoji',
      content: emojiIcon.textContent.trim(),
    };
  }

  // Try alternative emoji selectors
  const altEmojiIcon = doc.querySelector('[role="img"][aria-label]');
  if (
    altEmojiIcon &&
    altEmojiIcon.textContent &&
    /\p{Emoji}/u.test(altEmojiIcon.textContent)
  ) {
    return {
      type: 'emoji',
      content: altEmojiIcon.textContent.trim(),
    };
  }

  // Look for image icons in the page header
  const imageIcon = doc.querySelector('.page-header-icon img');
  if (imageIcon) {
    const src = imageIcon.getAttribute('src');
    if (src) {
      return {
        type: 'image',
        content: src,
      };
    }
  }

  // Fallback: Look for any span with emoji class "icon" in page header area
  const iconSpans = doc.querySelectorAll('span.icon');
  for (const span of iconSpans) {
    if (span.textContent && /\p{Emoji}/u.test(span.textContent.trim())) {
      const parent = span.parentElement;
      // Check if this is in a page header context
      if (
        parent &&
        (parent.classList.contains('page-header-icon') ||
          parent.closest('.page-header-icon'))
      ) {
        return {
          type: 'emoji',
          content: span.textContent.trim(),
        };
      }
    }
  }

  // Fallback: Try to find icons in the page title area that might contain emoji
  const pageTitle = doc.querySelector('.page-title, h1');
  if (pageTitle && pageTitle.textContent) {
    const text = pageTitle.textContent.trim();
    // Check if the title starts with an emoji
    const emojiMatch = text.match(/^(\p{Emoji}+)/u);
    if (emojiMatch) {
      return {
        type: 'emoji',
        content: emojiMatch[1],
      };
    }
  }

  return undefined;
}

function buildFolderHierarchy(
  pagePaths: Array<{ path: string; pageId: string; icon?: PageIcon }>
): FolderHierarchy {
  const root: FolderHierarchy = {
    name: '',
    path: '',
    children: new Map(),
  };

  for (const { path, pageId, icon } of pagePaths) {
    const { folderParts, fileName } = parseFolderPath(path);
    let current = root;
    let currentPath = '';

    // Navigate/create folder structure
    for (const folderName of folderParts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

      if (!current.children.has(folderName)) {
        current.children.set(folderName, {
          name: folderName,
          path: currentPath,
          parentPath: parentPath || undefined,
          children: new Map(),
        });
      }
      current = current.children.get(folderName)!;
    }

    // If this is a page file, associate it with the current folder
    if (/\.(html|csv)$/i.test(fileName) && fileName !== 'index.html') {
      const pageName = fileName.replace(/\.(html|csv)$/i, '');
      // A database export can include an HTML page and a CSV with the same
      // basename. Keep both identities in the folder metadata.
      const existing = current.children.get(pageName);
      const key =
        existing?.pageId && existing.pageId !== pageId ? fileName : pageName;
      if (!current.children.has(key)) {
        current.children.set(key, {
          name: key,
          path: path,
          parentPath: current.path || undefined,
          children: new Map(),
          pageId: pageId,
          icon: icon,
        });
      } else {
        // Update existing entry with pageId and icon
        const existingPage = current.children.get(key)!;
        existingPage.pageId = pageId;
        if (icon) {
          existingPage.icon = icon;
        }
      }
    }
  }

  return root;
}

/**
 * Imports a Notion zip file into the BlockSuite collection.
 *
 * @param options - The options for importing.
 * @param options.collection - The BlockSuite document collection.
 * @param options.schema - The schema of the BlockSuite document collection.
 * @param options.imported - The imported zip file as a Blob.
 *
 * @returns A promise that resolves to an object containing:
 *          - entryId: The ID of the entry page (if any).
 *          - pageIds: An array of imported page IDs.
 *          - isWorkspaceFile: Whether the imported file is a workspace file.
 *          - hasMarkdown: Whether the zip contains markdown files.
 *          - folderHierarchy: The parsed folder hierarchy from the Notion export.
 */
async function importNotionZip({
  collection,
  schema,
  imported,
  extensions,
  importCsv,
  signal,
}: ImportNotionZipOptions): Promise<ImportNotionZipResult> {
  let isWorkspaceFile = false;
  let hasMarkdown = false;
  const files = new Map<string, Blob>();
  let entryCount = 0;
  let expandedSize = 0;
  // Notion exports can wrap pages in nested ZIPs. Discover every page before
  // importing any content so links to later HTML pages and CSV databases work.
  const readArchive = async (blob: Blob, prefix = '', depth = 0) => {
    signal?.throwIfAborted();
    if (depth > 8)
      throw new Error('The Notion archive contains too many nested ZIP files.');
    const unzip = new Unzip();
    await unzip.load(blob);
    for (const entry of unzip) {
      signal?.throwIfAborted();
      entryCount++;
      expandedSize += entry.content.size;
      if (entryCount > 20000 || expandedSize > 1024 * 1024 * 1024)
        throw new Error(
          'The combined Notion archive exceeds the import limit.'
        );
      if (entry.path.endsWith('/')) continue;
      const path = `${prefix}${entry.path}`
        .replace(/\\/g, '/')
        .split('/')
        .filter(segment => segment && segment !== '.')
        .join('/');
      if (/\.zip$/i.test(path)) {
        const folder = path.slice(0, path.lastIndexOf('/') + 1);
        await readArchive(entry.content, folder, depth + 1);
      } else {
        if (files.has(path))
          throw new Error('The Notion archive repeats a file path.');
        files.set(path, entry.content);
      }
    }
  };
  await readArchive(imported);
  signal?.throwIfAborted();
  const pageMap = new Map<string, string>();
  for (const path of files.keys()) {
    const { fileName } = parseFolderPath(path);
    if (/\.md$/i.test(fileName)) hasMarkdown = true;
    if (fileName.toLowerCase() === 'index.html') {
      isWorkspaceFile = true;
      continue;
    }
    if (/\.csv$/i.test(fileName) && !importCsv)
      throw new Error(
        'This Notion export contains CSV databases, but CSV import is unavailable. No pages were imported.'
      );
    if (/\.(html|csv)$/i.test(fileName))
      pageMap.set(path, collection.idGenerator());
  }
  if (hasMarkdown)
    throw new Error(
      'This Notion export contains Markdown pages. Export as HTML with CSV databases, or use Markdown ZIP import. No pages were imported.'
    );
  if (!pageMap.size) {
    throw new Error('No Notion HTML pages or CSV databases were found.');
  }
  const staging = collection.createStagingWorkspace?.();
  if (!staging)
    throw new Error('This workspace cannot stage a Notion import safely.');
  const job = new Transformer({
    schema,
    blobCRUD: staging.blobSync,
    docCRUD: {
      create: id => staging.createDoc(id).getStore({ id }),
      get: id => staging.getDoc(id)?.getStore({ id }) ?? null,
      delete: id => staging.removeDoc(id),
    },
    middlewares: [defaultImageProxyMiddleware],
  });
  const pagePathsWithIds: Array<{
    path: string;
    pageId: string;
    icon?: PageIcon;
  }> = [];
  try {
    const assetPaths = job.assetsManager.getPathBlobIdMap();
    for (const [path, blob] of files) {
      signal?.throwIfAborted();
      if (/\.(html|csv|md)$/i.test(path)) continue;
      const key = await sha(await blob.arrayBuffer());
      const { fileName } = parseFolderPath(path);
      const mime = extMimeMap.get(path.split('.').at(-1) ?? '') ?? '';
      job.assets.set(key, new File([blob], fileName, { type: mime }));
      assetPaths.set(path, key);
      await job.assetsManager.writeToBlob(key);
    }
    const htmlAdapter = new NotionHtmlAdapter(job, getProvider(extensions));
    const localPath = (path: string, reference: string) => {
      if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference))
        return undefined;
      const raw = reference.split(/[?#]/)[0]!;
      const resolved = getImageFullPath(path, raw);
      return files.has(resolved) ? resolved : decodeURIComponent(raw);
    };
    for (const [path, id] of pageMap) {
      signal?.throwIfAborted();
      const file = files.get(path)!;
      const { fileName } = parseFolderPath(path);
      const title = fileName.replace(/\.(html|csv)$/i, '');
      if (/\.csv$/i.test(path)) {
        const page = await importCsv!(staging, file, id, title);
        if (page.id !== id || !staging.getDoc(id)?.getStore({ id }).root)
          throw new Error(
            'A Notion CSV database could not be imported safely.'
          );
        pagePathsWithIds.push({ path, pageId: id });
        continue;
      }
      const html = new DOMParser().parseFromString(
        await file.text(),
        'text/html'
      );
      const icon = extractPageIcon(html);
      // Canonical paths prevent identically named pages/assets in different
      // folders from being linked to whichever entry happened to import last.
      for (const link of html.querySelectorAll('a[href]')) {
        const resolved = localPath(path, link.getAttribute('href')!);
        if (resolved && (pageMap.has(resolved) || assetPaths.has(resolved)))
          link.setAttribute('href', encodeURIComponent(resolved));
      }
      for (const element of html.querySelectorAll(
        'img[src], figure .source a[href]'
      )) {
        const attribute = element.tagName === 'IMG' ? 'src' : 'href';
        const resolved = localPath(path, element.getAttribute(attribute)!);
        if (!resolved) continue;
        if (!assetPaths.has(resolved))
          throw new Error(
            `A required Notion attachment is missing: ${resolved}. No pages were imported.`
          );
        element.setAttribute(attribute, encodeURIComponent(resolved));
      }
      const snapshot = await htmlAdapter.toDocSnapshot({
        file: html.documentElement.outerHTML,
        pageId: id,
        pageMap,
        assets: job.assetsManager,
      });
      const page = await job.snapshotToDoc(snapshot);
      if (!page?.root)
        throw new Error(
          'A Notion page could not be restored. No pages were imported.'
        );
      const checkBlocks = (block: BlockSnapshot) => {
        if (!page.hasBlock(block.id))
          throw new Error(
            'A Notion block could not be restored. No pages were imported.'
          );
        block.children.forEach(checkBlocks);
      };
      checkBlocks(snapshot.blocks);
      staging.meta.setDocMeta(id, { title: snapshot.meta.title || title });
      pagePathsWithIds.push({ path, pageId: id, icon });
    }
    signal?.throwIfAborted();
    const published = await publishStagedWorkspace(
      collection,
      staging,
      [...pageMap.values()],
      signal
    );
    const pageIds = published.map(page => page.id);
    const entryId =
      [...pageMap].find(([path]) => !path.includes('/'))?.[1] ?? pageIds[0];
    return {
      entryId,
      pageIds,
      isWorkspaceFile,
      hasMarkdown,
      folderHierarchy: buildFolderHierarchy(pagePathsWithIds),
    };
  } finally {
    job[Symbol.dispose]();
    staging.dispose();
    staging.doc.destroy();
  }
}

export const NotionHtmlTransformer = {
  importNotionZip,
};
