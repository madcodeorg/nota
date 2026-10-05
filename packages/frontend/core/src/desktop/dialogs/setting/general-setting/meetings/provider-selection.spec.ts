import { describe, expect, test } from 'vitest';

import {
  meetingDownloadFeedback,
  meetingProviderSelectionState,
} from './provider-selection';

describe('meeting transcription provider selection', () => {
  test.each(['planned', 'unsupported'] as const)(
    'disables %s providers with a visible reason',
    status => {
      const state = meetingProviderSelectionState({ readiness: { status } });

      expect(state.selectable).toBe(false);
      expect(state.reason).toContain('cannot be selected');
    }
  );

  test('keeps a missing-model provider selectable so it can be downloaded', () => {
    expect(
      meetingProviderSelectionState({
        readiness: { status: 'missing_model' },
      })
    ).toEqual({ reason: null, selectable: true });
  });
});

describe('meeting model download feedback', () => {
  test.each(['blocked', 'planned', 'missing_url', 'error'])(
    'reports a rejected %s download with the backend reason',
    status => {
      expect(
        meetingDownloadFeedback(409, {
          download: { status, message: 'Cannot download this model' },
        })
      ).toEqual({
        accepted: false,
        message: 'Cannot download this model',
      });
    }
  );

  test.each(['queued', 'downloading', 'downloaded'])(
    'accepts an active or completed %s job',
    status => {
      expect(
        meetingDownloadFeedback(202, { download: { status } }).accepted
      ).toBe(true);
    }
  );

  test('does not report success for malformed or failed responses', () => {
    expect(meetingDownloadFeedback(200, null).accepted).toBe(false);
    expect(
      meetingDownloadFeedback(500, { download: { status: 'queued' } }).accepted
    ).toBe(false);
  });
});
