export type LocalTextModelSelectionInput = {
  deviceFit?: 'blocked' | 'fits' | 'low_disk' | 'low_ram' | 'planned';
  deviceFitReason?: string;
  downloadStatus?:
    | 'blocked'
    | 'downloaded'
    | 'downloading'
    | 'error'
    | 'missing_url'
    | 'not_started'
    | 'planned'
    | 'queued';
  progress?: number;
  releaseState?: 'blocked' | 'planned' | 'ready';
  runtimeProbe?: {
    canLoad: boolean;
    message: string;
    runtimeAvailable: boolean;
    status:
      | 'available'
      | 'failed'
      | 'missing_model'
      | 'missing_runtime'
      | 'planned'
      | 'unsupported';
  };
};

export type LocalTextModelSelectionState = {
  label: string;
  reason: string | null;
  selectable: boolean;
};

export function isReleasedLocalModel(model: LocalTextModelSelectionInput) {
  return (
    model.releaseState !== 'planned' &&
    model.releaseState !== 'blocked' &&
    model.downloadStatus !== 'planned' &&
    model.downloadStatus !== 'missing_url'
  );
}

export function canDownloadLocalModel(model: LocalTextModelSelectionInput) {
  return (
    isReleasedLocalModel(model) &&
    model.deviceFit !== 'blocked' &&
    model.deviceFit !== 'low_disk' &&
    model.deviceFit !== 'low_ram' &&
    model.deviceFit !== 'planned' &&
    (model.downloadStatus === 'not_started' ||
      model.downloadStatus === 'error' ||
      (model.downloadStatus === 'downloaded' &&
        model.runtimeProbe?.status === 'missing_model'))
  );
}

export function localModelDownloadFeedback(
  httpStatus: number,
  body: {
    download?: { status?: string; message?: string | null };
    error?: string;
  } | null
) {
  const status = body?.download?.status;
  const accepted =
    (httpStatus >= 200 && httpStatus < 300) || httpStatus === 409;
  if (accepted && status === 'downloaded') {
    return { accepted: true, message: 'Model already downloaded' };
  }
  if (accepted && (status === 'queued' || status === 'downloading')) {
    return {
      accepted: true,
      message:
        status === 'queued' ? 'Model download queued' : 'Model downloading',
    };
  }
  return {
    accepted: false,
    message:
      body?.download?.message ??
      body?.error ??
      `Model download could not start (HTTP ${httpStatus}).`,
  };
}

function downloadProgressLabel(progress?: number) {
  return typeof progress === 'number' && Number.isFinite(progress)
    ? ` ${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`
    : '';
}

export function localModelStatusLabel(
  model: LocalTextModelSelectionInput,
  _selected: boolean
) {
  if (
    model.downloadStatus === 'downloading' ||
    model.downloadStatus === 'queued'
  ) {
    return `Downloading${downloadProgressLabel(model.progress)}`;
  }
  if (
    model.releaseState === 'blocked' ||
    model.deviceFit === 'blocked' ||
    model.downloadStatus === 'blocked'
  ) {
    return 'Blocked';
  }
  if (model.releaseState === 'planned' || model.deviceFit === 'planned') {
    return 'Planned';
  }
  if (model.deviceFit === 'low_ram') return 'Low RAM';
  if (model.deviceFit === 'low_disk') return 'Low disk';
  if (model.downloadStatus === 'missing_url') return 'Unavailable';
  if (model.downloadStatus === 'error') return 'Download failed';
  if (model.downloadStatus !== 'downloaded') {
    return 'Download required';
  }
  const probe = model.runtimeProbe;
  if (!probe) return 'Downloaded - Not checked';
  if (probe.status === 'missing_model') return 'Model missing';
  if (probe.status === 'missing_runtime') return 'Runtime unavailable';
  if (probe.status === 'failed') return 'Load failed';
  if (probe.status === 'unsupported') return 'Unsupported';
  if (probe.status === 'planned') return 'Planned';
  return probe.runtimeAvailable && probe.canLoad
    ? 'Check passed'
    : 'Unavailable';
}

export function localTextModelSelectionState(
  model: LocalTextModelSelectionInput
): LocalTextModelSelectionState {
  if (model.releaseState === 'blocked' || model.deviceFit === 'blocked') {
    return {
      label: 'Blocked',
      reason: model.deviceFitReason ?? 'This model is not available yet.',
      selectable: false,
    };
  }
  if (model.downloadStatus === 'blocked') {
    return {
      label: 'Blocked',
      reason: 'This model download is blocked on the current device.',
      selectable: false,
    };
  }
  if (model.releaseState === 'planned' || model.deviceFit === 'planned') {
    return {
      label: 'Planned',
      reason: model.deviceFitReason ?? 'This model is planned but not ready.',
      selectable: false,
    };
  }
  if (model.deviceFit === 'low_ram') {
    return {
      label: 'Low RAM',
      reason:
        model.deviceFitReason ??
        'This model needs more available memory on this device.',
      selectable: false,
    };
  }
  if (model.deviceFit === 'low_disk') {
    return {
      label: 'Low disk',
      reason:
        model.deviceFitReason ??
        'Free more disk space before downloading this model.',
      selectable: false,
    };
  }
  if (
    model.downloadStatus === 'downloading' ||
    model.downloadStatus === 'queued'
  ) {
    return {
      label: `Downloading${downloadProgressLabel(model.progress)}`,
      reason: 'Finish the download before selecting this model.',
      selectable: false,
    };
  }
  if (model.downloadStatus !== 'downloaded') {
    if (model.downloadStatus === 'missing_url') {
      return {
        label: 'Unavailable',
        reason: 'This model does not have a working download source yet.',
        selectable: false,
      };
    }
    return {
      label: 'Download required',
      reason: 'Download this model before selecting it for Nota AI.',
      selectable: false,
    };
  }

  const probe = model.runtimeProbe;
  if (
    probe &&
    (probe.status !== 'available' || !probe.runtimeAvailable || !probe.canLoad)
  ) {
    return {
      label: 'Unavailable',
      reason: probe.message || 'The local ONNX runtime cannot load this model.',
      selectable: false,
    };
  }

  return { label: 'Ready', reason: null, selectable: true };
}
