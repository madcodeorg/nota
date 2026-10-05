import { describe, expect, test } from 'vitest';

import {
  canDownloadLocalModel,
  isReleasedLocalModel,
  localModelDownloadFeedback,
  localModelStatusLabel,
  type LocalTextModelSelectionInput,
  localTextModelSelectionState,
} from './local-model-selection';

const healthyProbe = {
  canLoad: true,
  message: 'Ready',
  runtimeAvailable: true,
  status: 'available',
} satisfies NonNullable<LocalTextModelSelectionInput['runtimeProbe']>;

describe('local ONNX text model selection', () => {
  test('requires a completed download before a model can be selected', () => {
    expect(
      localTextModelSelectionState({
        deviceFit: 'fits',
        downloadStatus: 'not_started',
        releaseState: 'ready',
      })
    ).toEqual({
      label: 'Download required',
      reason: 'Download this model before selecting it for Nota AI.',
      selectable: false,
    });
  });

  test('disables a downloaded model after a failed runtime check', () => {
    expect(
      localTextModelSelectionState({
        deviceFit: 'fits',
        downloadStatus: 'downloaded',
        releaseState: 'ready',
        runtimeProbe: {
          canLoad: false,
          message: 'ONNX Runtime is unavailable.',
          runtimeAvailable: false,
          status: 'missing_runtime',
        },
      })
    ).toEqual({
      label: 'Unavailable',
      reason: 'ONNX Runtime is unavailable.',
      selectable: false,
    });
  });

  test('explains models that cannot currently be downloaded', () => {
    expect(
      localTextModelSelectionState({
        deviceFit: 'fits',
        downloadStatus: 'missing_url',
        releaseState: 'ready',
      })
    ).toEqual({
      label: 'Unavailable',
      reason: 'This model does not have a working download source yet.',
      selectable: false,
    });
  });

  test('allows downloaded models when the runtime is healthy or not yet probed', () => {
    expect(
      localTextModelSelectionState({
        deviceFit: 'fits',
        downloadStatus: 'downloaded',
        releaseState: 'ready',
      }).selectable
    ).toBe(true);
    expect(
      localTextModelSelectionState({
        deviceFit: 'fits',
        downloadStatus: 'downloaded',
        releaseState: 'ready',
        runtimeProbe: {
          canLoad: true,
          message: 'Ready',
          runtimeAvailable: true,
          status: 'available',
        },
      }).selectable
    ).toBe(true);
  });

  test('does not present a selected but missing model as ready', () => {
    expect(
      localModelStatusLabel(
        {
          deviceFit: 'fits',
          downloadStatus: 'not_started',
          releaseState: 'ready',
        },
        true
      )
    ).toBe('Download required');
  });

  test('keeps active download progress visible for a configured model', () => {
    expect(
      localModelStatusLabel(
        {
          downloadStatus: 'downloading',
          progress: 0.42,
          releaseState: 'ready',
        },
        true
      )
    ).toBe('Downloading 42%');
  });
});

describe('local model status labels', () => {
  test.each([true, false])(
    'distinguishes downloaded from check passed with selected=%s',
    selected => {
      const model = {
        deviceFit: 'fits',
        downloadStatus: 'downloaded',
        releaseState: 'ready',
      } satisfies LocalTextModelSelectionInput;

      expect(localModelStatusLabel(model, selected)).toBe(
        'Downloaded - Not checked'
      );
      expect(
        localModelStatusLabel(
          { ...model, runtimeProbe: healthyProbe },
          selected
        )
      ).toBe('Check passed');
      expect(localTextModelSelectionState(model)).toEqual({
        label: 'Ready',
        reason: null,
        selectable: true,
      });
    }
  );

  test.each([
    ['failed', 'Load failed'],
    ['missing_model', 'Model missing'],
    ['missing_runtime', 'Runtime unavailable'],
    ['unsupported', 'Unsupported'],
    ['planned', 'Planned'],
  ] as const)('reports a %s probe even when selected', (status, label) => {
    const model = {
      downloadStatus: 'downloaded',
      runtimeProbe: { ...healthyProbe, message: 'Cannot load model', status },
    } satisfies LocalTextModelSelectionInput;

    expect(localModelStatusLabel(model, true)).toBe(label);
    expect(localModelStatusLabel(model, false)).toBe(label);
    expect(localTextModelSelectionState(model)).toEqual({
      label: 'Unavailable',
      reason: 'Cannot load model',
      selectable: false,
    });
  });

  test.each([
    { canLoad: false, runtimeAvailable: true },
    { canLoad: true, runtimeAvailable: false },
    { canLoad: false, runtimeAvailable: false },
  ])('requires both healthy runtime flags: %j', flags => {
    const model = {
      downloadStatus: 'downloaded',
      runtimeProbe: { ...healthyProbe, ...flags },
    } satisfies LocalTextModelSelectionInput;

    expect(localModelStatusLabel(model, true)).toBe('Unavailable');
    expect(localTextModelSelectionState(model).selectable).toBe(false);
  });

  test.each([
    { model: { releaseState: 'blocked' }, label: 'Blocked' },
    { model: { releaseState: 'planned' }, label: 'Planned' },
    { model: { deviceFit: 'blocked' }, label: 'Blocked' },
    { model: { deviceFit: 'planned' }, label: 'Planned' },
    { model: { deviceFit: 'low_ram' }, label: 'Low RAM' },
    { model: { deviceFit: 'low_disk' }, label: 'Low disk' },
    { model: { downloadStatus: 'blocked' }, label: 'Blocked' },
    { model: { downloadStatus: 'missing_url' }, label: 'Unavailable' },
  ] satisfies {
    model: LocalTextModelSelectionInput;
    label: string;
  }[])('preserves $label restrictions for $model', ({ model, label }) => {
    const installed = {
      downloadStatus: 'downloaded',
      runtimeProbe: healthyProbe,
      ...model,
    } satisfies LocalTextModelSelectionInput;

    expect(localModelStatusLabel(installed, true)).toBe(label);
    expect(localTextModelSelectionState(installed).selectable).toBe(false);
  });
});

describe.each(['downloading', 'queued'] as const)(
  'local model %s progress',
  downloadStatus => {
    test.each([
      { progress: undefined, label: 'Downloading' },
      { progress: NaN, label: 'Downloading' },
      { progress: Infinity, label: 'Downloading' },
      { progress: -Infinity, label: 'Downloading' },
      { progress: -0.25, label: 'Downloading 0%' },
      { progress: 0, label: 'Downloading 0%' },
      { progress: 0.426, label: 'Downloading 43%' },
      { progress: 1, label: 'Downloading 100%' },
      { progress: 1.5, label: 'Downloading 100%' },
    ])('formats $progress as $label', ({ progress, label }) => {
      const model = { downloadStatus, progress };

      expect(localModelStatusLabel(model, true)).toBe(label);
      expect(localTextModelSelectionState(model)).toEqual({
        label,
        reason: 'Finish the download before selecting this model.',
        selectable: false,
      });
    });
  }
);

describe('local model release visibility', () => {
  test.each([
    { releaseState: 'planned' },
    { releaseState: 'blocked' },
    { downloadStatus: 'planned' },
    { downloadStatus: 'missing_url' },
  ] satisfies LocalTextModelSelectionInput[])('hides unreleased %j', model => {
    expect(isReleasedLocalModel(model)).toBe(false);
  });

  test.each(['blocked', 'low_disk', 'low_ram', 'planned'] as const)(
    'keeps released models with %s device fit visible for explanation',
    deviceFit => {
      expect(
        isReleasedLocalModel({
          releaseState: 'ready',
          downloadStatus: 'blocked',
          deviceFit,
        })
      ).toBe(true);
    }
  );

  test('does not require optional release metadata', () => {
    expect(isReleasedLocalModel({})).toBe(true);
  });
});

describe('local model download eligibility', () => {
  test.each(['not_started', 'error'] as const)(
    'allows released %s downloads',
    downloadStatus => {
      expect(
        canDownloadLocalModel({
          releaseState: 'ready',
          deviceFit: 'fits',
          downloadStatus,
        })
      ).toBe(true);
      expect(canDownloadLocalModel({ downloadStatus })).toBe(true);
    }
  );

  test.each([
    { releaseState: 'planned' },
    { releaseState: 'blocked' },
    { deviceFit: 'blocked' },
    { deviceFit: 'low_disk' },
    { deviceFit: 'low_ram' },
    { deviceFit: 'planned' },
  ] satisfies LocalTextModelSelectionInput[])(
    'blocks new, retry and repair downloads for %j',
    restriction => {
      for (const downloadStatus of [
        'not_started',
        'error',
        'downloaded',
      ] as const) {
        expect(
          canDownloadLocalModel({
            downloadStatus,
            runtimeProbe: { ...healthyProbe, status: 'missing_model' },
            ...restriction,
          })
        ).toBe(false);
      }
    }
  );

  test.each([
    undefined,
    'blocked',
    'planned',
    'missing_url',
    'queued',
    'downloading',
    'downloaded',
  ] as const)('does not start a %s download', downloadStatus => {
    expect(
      canDownloadLocalModel({
        releaseState: 'ready',
        deviceFit: 'fits',
        downloadStatus,
      })
    ).toBe(false);
  });

  test.each([
    'available',
    'failed',
    'missing_model',
    'missing_runtime',
    'planned',
    'unsupported',
  ] as const)('only repairs downloaded files for missing_model: %s', status => {
    expect(
      canDownloadLocalModel({
        releaseState: 'ready',
        deviceFit: 'fits',
        downloadStatus: 'downloaded',
        runtimeProbe: { ...healthyProbe, status },
      })
    ).toBe(status === 'missing_model');
  });
});

describe('local model download feedback', () => {
  test.each([200, 202, 299, 409])(
    'accepts only active or completed jobs for HTTP %s',
    httpStatus => {
      for (const [status, message] of [
        ['queued', 'Model download queued'],
        ['downloading', 'Model downloading'],
        ['downloaded', 'Model already downloaded'],
      ]) {
        expect(
          localModelDownloadFeedback(httpStatus, { download: { status } })
        ).toEqual({ accepted: true, message });
      }
      for (const status of [
        undefined,
        'blocked',
        'planned',
        'missing_url',
        'error',
        'not_started',
        'unknown',
      ]) {
        expect(
          localModelDownloadFeedback(httpStatus, {
            download: { status, message: 'Cannot download this model' },
            error: 'Less specific error',
          })
        ).toEqual({ accepted: false, message: 'Cannot download this model' });
      }
    }
  );

  test.each([199, 300, 400, 404, 500])(
    'rejects HTTP %s even with an active or completed status',
    httpStatus => {
      for (const status of ['queued', 'downloading', 'downloaded']) {
        expect(
          localModelDownloadFeedback(httpStatus, {
            download: { status },
            error: 'Backend rejected request',
          })
        ).toEqual({ accepted: false, message: 'Backend rejected request' });
      }
    }
  );

  test.each([null, {}, { download: {} }, { download: { message: null } }])(
    'falls back to the HTTP status for malformed or empty response %j',
    body => {
      expect(localModelDownloadFeedback(200, body)).toEqual({
        accepted: false,
        message: 'Model download could not start (HTTP 200).',
      });
    }
  );

  test('uses the backend error when the download message is null', () => {
    expect(
      localModelDownloadFeedback(409, {
        download: { status: 'blocked', message: null },
        error: 'Insufficient disk space',
      })
    ).toEqual({ accepted: false, message: 'Insufficient disk space' });
  });

  test('preserves an empty backend message like the meeting helper', () => {
    expect(
      localModelDownloadFeedback(409, {
        download: { status: 'blocked', message: '' },
        error: 'Less specific error',
      })
    ).toEqual({ accepted: false, message: '' });
  });
});
