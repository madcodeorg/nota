// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { openConfirmModal } = vi.hoisted(() => ({ openConfirmModal: vi.fn() }));
vi.mock('@nota/component', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
  Switch: () => null,
  useConfirmModal: () => ({ openConfirmModal }),
}));
vi.mock('@nota/component/setting-components', () => ({
  SettingRow: () => null,
}));

import { usePostMeetingPassPrompt } from './post-meeting-pass';

const fetchMock = vi.fn<typeof fetch>();

function settings(postPassEnabled: boolean) {
  return new Response(
    JSON.stringify({
      meetings: {
        localModels: [
          {
            id: 'whisper-large-v3-turbo-q5-cpp',
            downloadStatus: 'not_started',
            sizeMb: 548,
          },
        ],
        postPassEnabled,
      },
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  openConfirmModal.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('after-meeting transcript prompt', () => {
  test('asks once per stopped meeting and stops after three prompts', async () => {
    fetchMock.mockImplementation(async () => settings(false));
    const { rerender } = renderHook(
      ({ stopped }) => usePostMeetingPassPrompt(stopped),
      { initialProps: { stopped: false } }
    );
    for (let meeting = 0; meeting < 4; meeting++) {
      rerender({ stopped: true });
      await vi.waitFor(() =>
        expect(openConfirmModal.mock.calls.length).toBe(
          Math.min(meeting + 1, 3)
        )
      );
      rerender({ stopped: false });
    }
    expect(openConfirmModal).toHaveBeenCalledTimes(3);
    expect(openConfirmModal.mock.calls[0][0].children).toContain('548 MB');
  });

  test('does not ask when the setting is already on', async () => {
    fetchMock.mockImplementation(async () => settings(true));
    const { rerender } = renderHook(
      ({ stopped }) => usePostMeetingPassPrompt(stopped),
      { initialProps: { stopped: false } }
    );
    rerender({ stopped: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(openConfirmModal).not.toHaveBeenCalled();
    expect(localStorage.getItem('nota:post-meeting-pass-prompts')).toBeNull();
  });

  test('turning it on saves the setting and starts the model download', async () => {
    fetchMock.mockImplementation(async () => settings(false));
    const { rerender } = renderHook(
      ({ stopped }) => usePostMeetingPassPrompt(stopped),
      { initialProps: { stopped: false } }
    );
    rerender({ stopped: true });
    await vi.waitFor(() => expect(openConfirmModal).toHaveBeenCalled());
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => settings(false));
    await openConfirmModal.mock.calls[0][0].onConfirm();
    const posts = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url, init]) => [url, init?.body]);
    expect(posts).toEqual([
      ['/api/ai/settings', JSON.stringify({ meetingPostPassEnabled: true })],
      ['/v1/stt/models/whisper-large-v3-turbo-q5-cpp/download', '{}'],
    ]);
  });
});
