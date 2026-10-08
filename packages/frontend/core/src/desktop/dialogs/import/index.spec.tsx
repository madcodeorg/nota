/* eslint-disable rxjs/finnish */
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  jump: vi.fn(),
}));
vi.mock('@blocksuite/affine/shared/utils', () => ({ openFilesWith: vi.fn() }));
vi.mock('@blocksuite/affine/widgets/linked-doc', () => ({
  DocxTransformer: {},
  HtmlTransformer: {},
  MarkdownTransformer: {},
  NotionHtmlTransformer: {},
  ZipTransformer: {},
}));
vi.mock('@blocksuite/icons/rc', () => ({
  ExportToHtmlIcon: () => null,
  ExportToMarkdownIcon: () => null,
  FileIcon: () => null,
  HelpIcon: () => null,
  NotionIcon: () => null,
  PageIcon: () => null,
  SaveIcon: () => null,
  ZipIcon: () => null,
}));
vi.mock('@nota/component', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  IconButton: () => null,
  IconType: { Emoji: 'emoji' },
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@nota/core/blocksuite/manager/store', () => ({
  getStoreManager: vi.fn(),
}));
vi.mock('@nota/core/components/hooks/nota-async-hooks', () => ({
  useAsyncCallback: (callback: unknown) => callback,
}));
vi.mock('@nota/core/components/hooks/use-navigate-helper', () => ({
  useNavigateHelper: () => ({ jumpToPage: mocks.jump }),
}));
vi.mock('@nota/core/modules/dialogs', () => ({
  GlobalDialogService: class GlobalDialogService {},
}));
vi.mock('@nota/core/modules/explorer-icon/services/explorer-icon', () => ({
  ExplorerIconService: class ExplorerIconService {},
}));
vi.mock('@nota/core/modules/organize', () => ({
  OrganizeService: class OrganizeService {},
}));
vi.mock('@nota/core/modules/url', () => ({ UrlService: class UrlService {} }));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
  getAFFiNEWorkspaceSchema: vi.fn(),
}));
vi.mock('@nota/infra', () => ({
  useService: (service: { name: string }) =>
    service.name === 'WorkspaceService'
      ? { workspace: { docCollection: {} } }
      : service.name === 'GlobalDialogService'
        ? { open: mocks.open }
        : {},
}));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => key }),
}));
vi.mock('@nota/debug', () => ({
  DebugLogger: class DebugLogger {
    error = vi.fn();
  },
}));
vi.mock('@nota/track', () => ({
  default: {
    $: {
      navigationPanel: { workspaceList: { createWorkspace: vi.fn() } },
      importModal: { $: { import: vi.fn(), createDoc: vi.fn() } },
    },
  },
}));
vi.mock('./csv-import', () => ({
  prepareCsvImport: vi.fn(),
  publishCsvImport: vi.fn(),
}));
vi.mock('./csv-preview', () => ({ CsvImportPreview: () => null }));
vi.mock('./staged-import', () => ({
  importFiles: vi.fn(),
  stageContentImport: vi.fn(),
}));
vi.mock('./styles.css', () => ({
  closeButton: 'closeButton',
  importItem: 'importItem',
  importItemLabel: 'importItemLabel',
  importItemSuffix: 'importItemSuffix',
  importModalButtonContainer: 'importModalButtonContainer',
  importModalContainer: 'importModalContainer',
  importModalContent: 'importModalContent',
  importModalTip: 'importModalTip',
  importModalTitle: 'importModalTitle',
  importStatusContent: 'importStatusContent',
  link: 'link',
}));

describe('native workspace import handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jump.mockReset();
    vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, isElectron: true });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('reports backup completion before destination navigation can unmount the source dialog', async () => {
    const { ImportDialog } = await import('./index');
    mocks.open.mockImplementation((_type, _props, callback) => {
      callback({ workspace: { id: 'restored-workspace', flavour: 'local' } });
    });
    const close = vi.fn(() => view.unmount());
    const view = render(<ImportDialog close={close} />);
    fireEvent.click(
      screen.getByTestId('editor-option-menu-import-dotaffinefile')
    );
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('restored-workspace', 'all')
    );
    expect(close).toHaveBeenCalledExactlyOnceWith({
      docIds: [],
      isWorkspaceFile: true,
    });
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.jump.mock.invocationCallOrder[0]
    );
    expect(mocks.open).toHaveBeenCalledWith(
      'import-workspace',
      undefined,
      expect.any(Function)
    );
  });

  test('a cancelled backup import never reports success or navigates', async () => {
    const { ImportDialog } = await import('./index');
    mocks.open.mockImplementation((_type, _props, callback) =>
      callback(undefined)
    );
    const close = vi.fn();
    render(<ImportDialog close={close} />);
    fireEvent.click(
      screen.getByTestId('editor-option-menu-import-dotaffinefile')
    );
    expect(await screen.findByText('No workspace imported')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(mocks.jump).not.toHaveBeenCalled();
  });
});
