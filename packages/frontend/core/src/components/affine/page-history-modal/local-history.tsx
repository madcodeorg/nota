import type { DocMode, RootBlockModel } from '@blocksuite/affine/model';
import type { Store } from '@blocksuite/affine/store';
import { Button } from '@nota/component/ui/button';
import { Modal, useConfirmModal } from '@nota/component/ui/modal';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import type { ListedHistory } from '@nota/nbstore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyUpdate } from 'yjs';

import { BlockSuiteEditor } from '../../../blocksuite/block-suite-editor';
import { PureEditorModeSwitch } from '../../../blocksuite/block-suite-mode-switch';
import { useGuard } from '../../guard';
import type { PageHistoryModalProps } from './history-modal';
import * as styles from './local-history.css';
import { createLocalHistoryPreview } from './local-history-preview';

export const LocalPageHistoryModal = ({
  open,
  onOpenChange,
  pageId,
}: PageHistoryModalProps) => {
  const workspace = useService(WorkspaceService).workspace;
  const canRestore = useGuard('Doc_Update', pageId);
  const { openConfirmModal } = useConfirmModal();
  const [histories, setHistories] = useState<ListedHistory[]>([]);
  const [selected, setSelected] = useState<Date>();
  const [preview, setPreview] = useState<Store>();
  const [previewedAt, setPreviewedAt] = useState<number>();
  const [mode, setMode] = useState<DocMode>('page');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const expectedCurrent = useRef<Uint8Array | undefined>(undefined);
  const request = useRef(0);
  const storage = workspace.engine.doc.storage;
  const liveDoc = workspace.docCollection.getDoc(pageId);
  const docId = liveDoc?.spaceDoc.guid ?? pageId;

  const refresh = useCallback(async () => {
    const generation = ++request.current;
    setBusy(true);
    setError(undefined);
    try {
      if (
        !storage.listHistories ||
        !storage.createCheckpoint ||
        !(await storage.isHistorySupported?.())
      ) {
        throw new Error('Local page history is unavailable in this build.');
      }
      await workspace.engine.doc.waitForUpdated(docId);
      const current = await storage.createCheckpoint(docId);
      const versions = await storage.listHistories(docId, { limit: 50 });
      if (request.current !== generation) return;
      expectedCurrent.current = current?.bin;
      setHistories(versions);
      setSelected(versions[0]?.timestamp);
    } catch (error) {
      if (request.current === generation) {
        setError(
          error instanceof Error ? error.message : 'Could not load history.'
        );
      }
    } finally {
      if (request.current === generation) setBusy(false);
    }
  }, [docId, storage, workspace]);
  const saveVersion = useAsyncCallback(refresh, [refresh]);

  useEffect(() => {
    if (!open) return;
    setHistories([]);
    setSelected(undefined);
    expectedCurrent.current = undefined;
    saveVersion();
    const requestRef = request;
    return () => {
      ++requestRef.current;
    };
  }, [open, saveVersion]);

  useEffect(() => {
    setPreview(undefined);
    setPreviewedAt(undefined);
    if (!open || !selected || !storage.getHistory) return;
    let active = true;
    let dispose: (() => void) | undefined;
    void storage
      .getHistory(docId, selected)
      .then(snapshot => {
        if (!active) return;
        if (!snapshot)
          throw new Error('This saved version is no longer available.');
        const detached = createLocalHistoryPreview(
          workspace.docCollection,
          pageId,
          snapshot.bin
        );
        dispose = detached.dispose;
        setPreview(detached.store);
        setPreviewedAt(selected.getTime());
      })
      .catch(error => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'Could not preview this version.'
          );
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, [docId, open, pageId, selected, storage, workspace]);

  const restore = async () => {
    if (!selected || !liveDoc || !expectedCurrent.current || !canRestore)
      return;
    setBusy(true);
    setError(undefined);
    try {
      if (!storage.rollbackDoc)
        throw new Error('Local restore is unavailable in this build.');
      await workspace.engine.doc.waitForUpdated(docId);
      await storage.rollbackDoc(
        docId,
        selected,
        undefined,
        expectedCurrent.current
      );
      const restored = await storage.getDoc(docId);
      if (!restored) throw new Error('Could not read the restored page.');
      applyUpdate(liveDoc.spaceDoc, restored.bin);
      const title = (liveDoc.getStore().root as RootBlockModel | null)?.props
        .title;
      if (title)
        workspace.docCollection.meta.setDocMeta(pageId, {
          title: title.toString(),
        });
      await workspace.engine.doc.waitForUpdated();
      onOpenChange(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not restore this version.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Page history on this device"
      width="min(960px, calc(100vw - 32px))"
      height="80vh"
      contentOptions={{
        ['data-testid' as string]: 'local-page-history-modal',
        style: { display: 'flex', flexDirection: 'column' },
      }}
    >
      <p>
        Saved versions stay on this device and work offline. Restoring also
        saves the current version.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.content}>
        <div className={styles.list} aria-label="Saved page versions">
          {histories.map(version => (
            <button
              type="button"
              className={styles.version}
              aria-pressed={selected?.getTime() === version.timestamp.getTime()}
              key={version.timestamp.toISOString()}
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setSelected(version.timestamp);
              }}
            >
              {version.timestamp.toLocaleString()}
            </button>
          ))}
          {!histories.length ? (
            <p>{busy ? 'Loading versions…' : 'No saved versions yet.'}</p>
          ) : null}
        </div>
        <div className={styles.preview}>
          <PureEditorModeSwitch mode={mode} setMode={setMode} />
          {preview ? (
            <BlockSuiteEditor page={preview} mode={mode} readonly />
          ) : null}
        </div>
      </div>
      <div className={styles.actions}>
        <Button disabled={busy} onClick={saveVersion}>
          Save a version
        </Button>
        <Button
          variant="primary"
          disabled={
            busy ||
            !preview ||
            previewedAt !== selected?.getTime() ||
            !canRestore ||
            !!error
          }
          loading={busy}
          onClick={() =>
            openConfirmModal({
              title: 'Restore this saved version?',
              description:
                'Your current page will be saved in history before the restore. If the page has changed since opening history, refresh the versions first.',
              confirmText: 'Restore version',
              onConfirm: restore,
            })
          }
        >
          Restore version
        </Button>
      </div>
    </Modal>
  );
};
