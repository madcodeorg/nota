import { Subject } from 'rxjs';

export const globalStateUpdates$ = new Subject<Record<string, any>>();
export const globalCacheUpdates$ = new Subject<Record<string, any>>();

const globalStateRevisions = new Map<string, number>();
const globalCacheRevisions = new Map<string, number>();

function nextRevision(revisions: Map<string, number>, key: string) {
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  return revision;
}

export function publishGlobalStateUpdateFromMain(
  key: string,
  value: unknown,
  sourceId?: string
) {
  const revision = nextRevision(globalStateRevisions, key);
  globalStateUpdates$.next({
    [key]: { r: revision, s: sourceId, v: value },
  });
}

export function publishGlobalCacheUpdateFromMain(
  key: string,
  value: unknown,
  sourceId?: string
) {
  const revision = nextRevision(globalCacheRevisions, key);
  globalCacheUpdates$.next({
    [key]: { r: revision, s: sourceId, v: value },
  });
}

export function clearGlobalStateBroadcastRevisions() {
  globalStateRevisions.clear();
}

export function clearGlobalCacheBroadcastRevisions() {
  globalCacheRevisions.clear();
}
