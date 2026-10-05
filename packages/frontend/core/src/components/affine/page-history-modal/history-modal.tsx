import type { DocMode } from '@blocksuite/affine/model';
import type { Store, Workspace } from '@blocksuite/affine/store';
import { ToggleRightIcon } from '@blocksuite/icons/rc';
import { Avatar, Loading, Scrollable } from '@nota/component';
import { EditorLoading } from '@nota/component/page-detail-skeleton';
import { Button } from '@nota/component/ui/button';
import { Modal, useConfirmModal } from '@nota/component/ui/modal';
import { DocDisplayMetaService } from '@nota/core/modules/doc-display-meta';
import { EditorService } from '@nota/core/modules/editor';
import {
  isServerBackedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { i18nTime, useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { DialogContentProps } from '@radix-ui/react-dialog';
import { useAtom } from 'jotai';
import type { PropsWithChildren } from 'react';
import {
  Fragment,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { encodeStateAsUpdate } from 'yjs';

import { BlockSuiteEditor } from '../../../blocksuite/block-suite-editor';
import { PureEditorModeSwitch } from '../../../blocksuite/block-suite-mode-switch';
import { pageHistoryModalAtom } from '../../atoms/page-history';
import { useGuard } from '../../guard';
import { AffineErrorBoundary } from '../affine-error-boundary';
import {
  historyListGroupByDay,
  useDocSnapshotList,
  useRestorePage,
  useSnapshotPage,
} from './data';
import { EmptyHistoryShape } from './empty-history-shape';
import { LocalPageHistoryModal } from './local-history';
import * as styles from './styles.css';

export interface PageHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docCollection: Workspace;
  pageId: string;
}

const contentOptions: DialogContentProps = {
  ['data-testid' as string]: 'page-history-modal',
  onPointerDownOutside: e => {
    e.preventDefault();
  },
  style: {
    padding: 0,
    maxWidth: 944,
    backgroundColor: 'var(--affine-background-primary-color)',
    overflow: 'hidden',
  },
};

const ModalContainer = ({
  onOpenChange,
  open,
  children,
}: PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) => {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width="calc(100% - 64px)"
      height="80%"
      withoutCloseButton
      contentOptions={contentOptions}
    >
      {children}
    </Modal>
  );
};

interface HistoryEditorPreviewProps {
  ts?: string;
  historyList: HistoryList;
  snapshotPage?: Store;
  mode: DocMode;
  onModeChange: (mode: DocMode) => void;
  title: string;
}

const HistoryEditorPreview = ({
  ts,
  historyList,
  snapshotPage,
  onModeChange,
  mode,
  title,
}: HistoryEditorPreviewProps) => {
  const onModeChangeWithTrack = useCallback(
    (mode: DocMode) => {
      track.$.docHistory.$.switchPageMode({ mode });
      onModeChange(mode);
    },
    [onModeChange]
  );

  const content = useMemo(() => {
    return (
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <PureEditorModeSwitch mode={mode} setMode={onModeChangeWithTrack} />
          <div className={styles.previewHeaderTitle}>{title}</div>
          <div className={styles.previewHeaderTimestamp}>
            {ts
              ? i18nTime(ts, {
                  absolute: { accuracy: 'minute', noDate: true },
                })
              : null}
          </div>
        </div>

        {snapshotPage ? (
          <AffineErrorBoundary>
            <Scrollable.Root>
              <Scrollable.Viewport className="affine-page-viewport">
                <BlockSuiteEditor
                  className={styles.editor}
                  mode={mode}
                  page={snapshotPage}
                  readonly={true}
                />
              </Scrollable.Viewport>
              <Scrollable.Scrollbar />
            </Scrollable.Root>
          </AffineErrorBoundary>
        ) : (
          <div className={styles.loadingContainer}>
            <Loading size={24} />
          </div>
        )}
      </div>
    );
  }, [mode, onModeChangeWithTrack, snapshotPage, title, ts]);

  return (
    <div className={styles.previewWrapper}>
      {historyList.map((_item, i) => {
        const historyIndex = historyList.findIndex(h => h.timestamp === ts);
        const distance = i - historyIndex;
        const flag =
          distance > 20
            ? '> 20'
            : distance < -20
              ? '< -20'
              : distance.toString();
        return (
          <div data-distance={flag} key={i} className={styles.previewContainer}>
            {historyIndex === i ? content : null}
          </div>
        );
      })}
    </div>
  );
};
type HistoryList = ReturnType<typeof useDocSnapshotList>[0];

const PageHistoryList = ({
  historyList,
  onLoadMore,
  loadingMore,
  activeVersion,
  onVersionChange,
}: {
  activeVersion?: string;
  onVersionChange: (version: string) => void;
  historyList: HistoryList;
  onLoadMore: (() => void) | false;
  loadingMore: boolean;
}) => {
  const t = useI18n();
  const historyListByDay = useMemo(() => {
    return historyListGroupByDay(historyList);
  }, [historyList]);

  const [collapsedMap, setCollapsedMap] = useState<Record<number, boolean>>({});

  useLayoutEffect(() => {
    if (historyList.length > 0 && !activeVersion) {
      onVersionChange(historyList[0].timestamp);
    }
  }, [activeVersion, historyList, onVersionChange]);

  return (
    <div className={styles.historyList}>
      <div className={styles.historyListHeader}>
        {t['com.affine.history.version-history']()}
      </div>
      <Scrollable.Root className={styles.historyListScrollable}>
        <Scrollable.Viewport className={styles.historyListScrollableInner}>
          {historyListByDay.map(([day, list], i) => {
            const collapsed = collapsedMap[i];
            const isLastGroup = i === historyListByDay.length - 1;
            return (
              <Collapsible.Root
                open={!collapsed}
                key={day}
                className={styles.historyItemGroup}
              >
                <Collapsible.Trigger
                  role="button"
                  onClick={() =>
                    setCollapsedMap(prev => ({ ...prev, [i]: !collapsed }))
                  }
                  className={styles.historyItemGroupTitle}
                >
                  <div
                    data-testid="page-list-group-header-collapsed-button"
                    className={styles.collapsedIconContainer}
                  >
                    <ToggleRightIcon
                      className={styles.collapsedIcon}
                      data-collapsed={!!collapsed}
                    />
                  </div>
                  {day}
                </Collapsible.Trigger>
                <Collapsible.Content className={styles.historyItemGroupContent}>
                  {list.map((history, idx) => {
                    const isLastItem = idx === list.length - 1;
                    return (
                      <Fragment key={history.timestamp}>
                        <div
                          className={styles.historyItem}
                          data-testid="version-history-item"
                          onClick={e => {
                            e.stopPropagation();
                            onVersionChange(history.timestamp);
                          }}
                          data-active={activeVersion === history.timestamp}
                        >
                          <span className={styles.historyItemTimestamp}>
                            {i18nTime(history.timestamp, {
                              absolute: { noDate: true, accuracy: 'minute' },
                            })}
                            {activeVersion === history.timestamp ? (
                              <>
                                <span>·</span>
                                <div className={styles.historyItemCurrent}>
                                  {t['current']()}
                                </div>
                              </>
                            ) : null}
                          </span>
                          <div className={styles.historyItemNameWrapper}>
                            <Avatar
                              className={styles.historyItemAvatar}
                              url={history.editor?.avatarUrl ?? ''}
                              name={history.editor?.name ?? ''}
                              size={22}
                            />
                            <span className={styles.historyItemName}>
                              {history.editor?.name ?? t['unnamed']()}
                            </span>
                          </div>
                        </div>
                        {isLastGroup && isLastItem && onLoadMore ? (
                          <Button
                            variant="plain"
                            loading={loadingMore}
                            disabled={loadingMore}
                            className={styles.historyItemLoadMore}
                            onClick={onLoadMore}
                          >
                            {t[
                              'com.affine.history.confirm-restore-modal.load-more'
                            ]()}
                          </Button>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Collapsible.Content>
              </Collapsible.Root>
            );
          })}
        </Scrollable.Viewport>
        <Scrollable.Scrollbar />
      </Scrollable.Root>
    </div>
  );
};

const EmptyHistoryPrompt = () => {
  const t = useI18n();

  return (
    <div
      className={styles.emptyHistoryPrompt}
      data-testid="empty-history-prompt"
    >
      <EmptyHistoryShape />
      <div className={styles.emptyHistoryPromptTitle}>
        {t['com.affine.history.empty-prompt.title']()}
      </div>
      <div className={styles.emptyHistoryPromptDescription}>
        {t['com.affine.history.empty-prompt.description']()}
      </div>
    </div>
  );
};

const PageHistoryManager = ({
  docCollection,
  pageId,
  onClose,
}: {
  docCollection: Workspace;
  pageId: string;
  onClose: () => void;
}) => {
  const workspaceId = docCollection.id;
  const [activeVersion, setActiveVersion] = useState<string>();

  const pageDocId = useMemo(() => {
    return docCollection.getDoc(pageId)?.spaceDoc.guid ?? pageId;
  }, [pageId, docCollection]);
  const { openConfirmModal } = useConfirmModal();

  const snapshotPage = useSnapshotPage(docCollection, pageDocId, activeVersion);

  const t = useI18n();

  const { onRestore, isMutating } = useRestorePage(docCollection, pageId);

  const handleRestore = useMemo(
    () => async () => {
      if (!activeVersion || !snapshotPage) {
        return;
      }
      const snapshot = encodeStateAsUpdate(snapshotPage.spaceDoc);
      await onRestore(activeVersion, new Uint8Array(snapshot));
      // close the modal after restore
      onClose();
    },
    [activeVersion, onClose, onRestore, snapshotPage]
  );

  const editor = useService(EditorService).editor;
  const [mode, setMode] = useState<DocMode>(editor.mode$.value);

  const docDisplayMetaService = useService(DocDisplayMetaService);
  const i18n = useI18n();

  const title = useLiveData(docDisplayMetaService.title$(pageId));
  const canEdit = useGuard('Doc_Update', pageDocId);

  const onConfirmRestore = useCallback(() => {
    openConfirmModal({
      title: t['com.affine.history.restore-current-version'](),
      description: t['com.affine.history.confirm-restore-modal.hint'](),
      cancelText: t['Cancel'](),
      contentOptions: {
        ['data-testid' as string]: 'confirm-restore-history-modal',
        style: { padding: '20px 26px' },
      },
      confirmText: t['com.affine.history.confirm-restore-modal.restore'](),
      confirmButtonOptions: {
        variant: 'primary',
        ['data-testid' as string]: 'confirm-restore-history-button',
      },
      onConfirm: handleRestore,
    });
  }, [handleRestore, openConfirmModal, t]);

  const [historyList, loadMore, loadingMore] = useDocSnapshotList(
    workspaceId,
    pageDocId
  );

  return (
    <div className={styles.root}>
      <div className={styles.modalContent} data-empty={!activeVersion}>
        <HistoryEditorPreview
          ts={activeVersion}
          historyList={historyList}
          snapshotPage={snapshotPage}
          mode={mode}
          onModeChange={setMode}
          title={i18n.t(title)}
        />

        <PageHistoryList
          historyList={historyList}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
          activeVersion={activeVersion}
          onVersionChange={setActiveVersion}
        />
      </div>

      {!activeVersion ? (
        <div className={styles.modalContent}>
          <EmptyHistoryPrompt />
        </div>
      ) : null}

      <div className={styles.historyFooter}>
        <Button onClick={onClose}>
          {t['com.affine.history.back-to-page']()}
        </Button>
        <div className={styles.spacer} />
        <Button
          variant="primary"
          onClick={onConfirmRestore}
          disabled={isMutating || !activeVersion || !canEdit}
        >
          {t['com.affine.history.restore-current-version']()}
        </Button>
      </div>
    </div>
  );
};

export const PageHistoryModal = ({
  onOpenChange,
  open,
  pageId,
  docCollection: workspace,
}: PageHistoryModalProps) => {
  const onClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <ModalContainer onOpenChange={onOpenChange} open={open}>
      <Suspense fallback={<EditorLoading />}>
        <PageHistoryManager
          onClose={onClose}
          pageId={pageId}
          docCollection={workspace}
        />
      </Suspense>
    </ModalContainer>
  );
};

export const GlobalPageHistoryModal = () => {
  const [{ open, pageId }, setState] = useAtom(pageHistoryModalAtom);
  const workspace = useService(WorkspaceService).workspace;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      track.$.docHistory.$[open ? 'open' : 'close']();
      setState(prev => ({
        ...prev,
        open,
      }));
    },
    [setState]
  );

  const HistoryModal = isServerBackedWorkspaceFlavour(workspace.flavour)
    ? PageHistoryModal
    : LocalPageHistoryModal;

  return (
    <HistoryModal
      open={open}
      onOpenChange={handleOpenChange}
      pageId={pageId}
      docCollection={workspace.docCollection}
    />
  );
};
