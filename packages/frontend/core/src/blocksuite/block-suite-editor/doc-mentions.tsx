import { REFERENCE_NODE } from '@blocksuite/affine/shared/consts';
import { Button, notify } from '@nota/component';
import { DocService, DocsService } from '@nota/core/modules/doc';
import { DocLinksService } from '@nota/core/modules/doc-link';
import { DocsSearchService } from '@nota/core/modules/docs-search';
import { type Workspace, WorkspaceService } from '@nota/core/modules/workspace';
import {
  findMention,
  isMentionableTitle,
  mentionSnippet,
} from '@nota/core/utils/mentions';
import { useLiveData, useService } from '@nota/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { debounceTime, firstValueFrom } from 'rxjs';

import { NotaPageReference } from '../../components/affine/reference-link';
import * as styles from './bi-directional-link-panel.css';

const MAX_MENTIONS = 20;
const MAX_RELATED = 5;

type Mention = { docId: string; blockId: string; content: string };
type Related = { docId: string; snippet: string };

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function allValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function linkMention(
  workspace: Workspace,
  mention: Mention,
  targetDocId: string,
  title: string
) {
  const doc = workspace.docCollection.getDoc(mention.docId);
  if (!doc) return false;
  doc.load();
  await workspace.engine.doc.waitForDocLoaded(mention.docId);
  const store = doc.getStore();
  const text = store.getModelById(mention.blockId)?.text;
  if (store.readonly || !text) return false;
  const match = findMention(text.toString(), title);
  if (!match) return false;
  text.replace(match.index, match.length, REFERENCE_NODE, {
    reference: { type: 'LinkedPage', pageId: targetDocId },
  });
  return true;
}

export const UnlinkedMentions = () => {
  const workspace = useService(WorkspaceService).workspace;
  const docsService = useService(DocsService);
  const doc = useService(DocService).doc;
  const title = useLiveData(doc.title$) ?? '';
  const [mentions, setMentions] = useState<Mention[]>([]);

  useEffect(() => {
    if (!isMentionableTitle(title)) {
      setMentions([]);
      return;
    }
    const subscription = workspace.engine.indexer
      .search$(
        'block',
        { type: 'match', field: 'content', match: title },
        {
          fields: ['docId', 'blockId', 'content', 'refDocId'],
          pagination: { limit: 100 },
        }
      )
      .pipe(debounceTime(300))
      .subscribe(({ nodes }) => {
        const result: Mention[] = [];
        for (const node of nodes) {
          const docId = firstValue(node.fields.docId);
          const blockId = firstValue(node.fields.blockId);
          const content = firstValue(node.fields.content) ?? '';
          if (!docId || !blockId || docId === doc.id) continue;
          if (allValues(node.fields.refDocId).includes(doc.id)) continue;
          const record = docsService.list.doc$(docId).value;
          if (!record || record.trash$.value) continue;
          if (!findMention(content, title)) continue;
          result.push({ docId, blockId, content });
          if (result.length >= MAX_MENTIONS) break;
        }
        setMentions(result);
      });
    return () => subscription.unsubscribe();
  }, [doc.id, docsService, title, workspace]);

  const onLink = useCallback(
    (mention: Mention) => {
      linkMention(workspace, mention, doc.id, title)
        .then(linked => {
          if (!linked) {
            notify.error({ title: 'Could not link this mention' });
            return;
          }
          setMentions(prev => prev.filter(item => item !== mention));
        })
        .catch(error => {
          console.error(error);
          notify.error({ title: 'Could not link this mention' });
        });
    },
    [doc.id, title, workspace]
  );

  if (!mentions.length) return null;

  return (
    <div className={styles.linksContainer} data-testid="unlinked-mentions">
      <div className={styles.linksTitles}>
        Unlinked mentions · {mentions.length}
      </div>
      {mentions.map(mention => {
        const match = findMention(mention.content, title);
        const snippet = match ? mentionSnippet(mention.content, match) : null;
        return (
          <div
            className={styles.mentionRow}
            key={`${mention.docId}:${mention.blockId}`}
          >
            <div className={styles.mentionBody}>
              <div className={styles.link}>
                <NotaPageReference
                  pageId={mention.docId}
                  params={new URLSearchParams({ blockIds: mention.blockId })}
                />
              </div>
              {snippet ? (
                <div className={styles.mentionSnippet}>
                  {snippet.before}
                  <mark className={styles.mentionMatch}>{snippet.match}</mark>
                  {snippet.after}
                </div>
              ) : null}
            </div>
            <Button size="default" onClick={() => onLink(mention)}>
              Link
            </Button>
          </div>
        );
      })}
    </div>
  );
};

async function searchRelated(
  workspaceId: string,
  query: string
): Promise<Related[]> {
  const response = await fetch(
    new URL('/v1/workspace/search', location.href).toString(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, workspaceId, limit: 15 }),
    }
  );
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  const data = (await response.json()) as {
    results?: { docId: string; snippet?: string; source?: string }[];
  };
  return (data.results ?? [])
    .filter(result => result.source === 'doc' || result.source === undefined)
    .map(result => ({ docId: result.docId, snippet: result.snippet ?? '' }));
}

export const RelatedNotes = () => {
  const workspace = useService(WorkspaceService).workspace;
  const docsService = useService(DocsService);
  const docsSearch = useService(DocsSearchService);
  const docLinks = useService(DocLinksService);
  const doc = useService(DocService).doc;
  const title = useLiveData(doc.title$) ?? '';
  const backlinks = useLiveData(docLinks.backlinks.backlinks$);
  const links = useLiveData(docLinks.links.links$);
  const [related, setRelated] = useState<Related[]>([]);

  // A string key keeps the search from re-running when the link lists
  // re-emit with the same docs.
  const linkedKey = useMemo(
    () =>
      Array.from(
        new Set([
          doc.id,
          ...(backlinks ?? []).map(link => link.docId),
          ...links.map(link => link.docId),
        ])
      )
        .sort()
        .join('\n'),
    [backlinks, doc.id, links]
  );

  useEffect(() => {
    if (!isMentionableTitle(title)) {
      setRelated([]);
      return;
    }
    let disposed = false;
    const linkedIds = new Set(linkedKey.split('\n'));
    const load = async () => {
      const summary =
        (await firstValueFrom(docsSearch.watchDocSummary(doc.id))) ?? '';
      const query = `${title}\n${summary}`.slice(0, 500);
      let results: Related[];
      try {
        results = await searchRelated(workspace.id, query);
      } catch {
        // The local AI backend is optional; fall back to the keyword index.
        const hits = await firstValueFrom(docsSearch.search$(title, 'local'));
        results = hits.map(hit => ({
          docId: hit.docId,
          snippet: hit.blockContent ?? '',
        }));
      }
      if (disposed) return;
      const seen = new Set<string>();
      setRelated(
        results
          .filter(result => {
            if (linkedIds.has(result.docId) || seen.has(result.docId)) {
              return false;
            }
            const record = docsService.list.doc$(result.docId).value;
            if (!record || record.trash$.value) return false;
            seen.add(result.docId);
            return true;
          })
          .slice(0, MAX_RELATED)
      );
    };
    const timer = setTimeout(() => {
      load().catch(error => {
        if (!disposed) console.error('Failed to load related notes', error);
      });
    }, 500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [doc.id, docsSearch, docsService, linkedKey, title, workspace.id]);

  if (!related.length) return null;

  return (
    <div className={styles.linksContainer} data-testid="related-notes">
      <div className={styles.linksTitles}>Related notes · {related.length}</div>
      {related.map(item => (
        <div className={styles.mentionRow} key={item.docId}>
          <div className={styles.mentionBody}>
            <div className={styles.link}>
              <NotaPageReference pageId={item.docId} />
            </div>
            {item.snippet ? (
              <div className={styles.mentionSnippet}>{item.snippet}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};
