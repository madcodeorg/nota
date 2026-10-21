import type { Workspace as DocCollection } from '@blocksuite/affine/store';
import { notify, usePromptModal } from '@nota/component';
import { WorkbenchService } from '@nota/core/modules/workbench';
import {
  getAFFiNEWorkspaceSchema,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import { useCallback } from 'react';

import { extractArticle } from './extract-article';

export async function saveWebPage(collection: DocCollection, rawUrl: string) {
  const input = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl.trim())
    ? rawUrl.trim()
    : `https://${rawUrl.trim()}`;
  let response: Response;
  try {
    response = await fetch(new URL('/v1/web/page', location.href).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input }),
    });
  } catch {
    throw new Error('The local Nota backend is not running.');
  }
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    html?: string;
    url?: string;
  } | null;
  if (!response.ok || !data?.html || !data.url) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  const article = extractArticle(data.html, data.url);
  // Loaded on demand so the sidebar does not pull the editor store into its bundle.
  const [{ HtmlTransformer }, { getStoreManager }] = await Promise.all([
    import('@blocksuite/affine/widgets/linked-doc'),
    import('@nota/core/blocksuite/manager/store'),
  ]);
  const docId = await HtmlTransformer.importHTMLToDoc({
    collection,
    schema: getAFFiNEWorkspaceSchema(),
    extensions: getStoreManager().config.init().value.get('store'),
    html: article.html,
    fileName: article.title,
  });
  if (!docId) throw new Error('The page had no content to save.');
  return docId;
}

export function useSaveWebPage() {
  const { openPromptModal } = usePromptModal();
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;

  return useCallback(() => {
    openPromptModal({
      title: 'Save web page',
      description:
        'Nota downloads the page on this device and saves its readable content as a new note.',
      label: 'Page URL',
      inputOptions: { placeholder: 'https://example.com/article' },
      confirmText: 'Save',
      cancelText: 'Cancel',
      autoFocusConfirm: false,
      onConfirm: async url => {
        try {
          const docId = await saveWebPage(workspace.docCollection, url);
          workbench.openDoc(docId, { at: 'active' });
        } catch (error) {
          notify.error({
            title: 'Could not save the page',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
  }, [openPromptModal, workbench, workspace]);
}
