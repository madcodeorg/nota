export type MeetingProviderSelectionInput = {
  readiness?: {
    status:
      | 'available'
      | 'failed'
      | 'missing_model'
      | 'missing_runtime'
      | 'planned'
      | 'unsupported';
  };
  unavailableReason?: string;
};

export function meetingProviderSelectionState(
  provider: MeetingProviderSelectionInput
) {
  if (provider.readiness?.status === 'unsupported') {
    return {
      reason:
        provider.unavailableReason ??
        'This provider is not supported on this device and cannot be selected.',
      selectable: false,
    };
  }
  if (provider.readiness?.status === 'planned') {
    return {
      reason: 'This provider is still planned and cannot be selected yet.',
      selectable: false,
    };
  }
  return { reason: null, selectable: true };
}

export function meetingLanguageSelection(
  providerId: string,
  model?: {
    languageDetection?: 'automatic' | 'fixed' | 'selectable';
    languages?: string[];
  }
) {
  const languages = [...new Set(model?.languages ?? [])].filter(
    language => language && language !== 'multilingual' && language !== 'auto'
  );
  const preferred =
    providerId === 'nemotron-sherpa' ||
    /^whisper-(tiny|base|small|medium|large-v3)-cpp$/.test(providerId) ||
    (providerId === 'apple-speechanalyzer' && languages.length > 0);
  const mode =
    providerId === 'auto'
      ? 'follow-model'
      : preferred
        ? 'preferred'
        : providerId === 'apple-speechanalyzer'
          ? 'system'
          : model?.languageDetection === 'fixed'
            ? 'fixed'
            : model?.languageDetection === 'automatic'
              ? 'automatic'
              : 'unknown';
  return { mode, languages };
}

export function meetingDownloadFeedback(
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
