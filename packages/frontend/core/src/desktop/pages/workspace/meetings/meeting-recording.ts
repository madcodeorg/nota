export function isRawMeetingRecording(filepath: string) {
  return /\.raw$/i.test(filepath.trim());
}

export function isPortableMeetingRecordingBlock(flavour?: string | null) {
  return flavour === 'affine:attachment';
}

export function meetingRawRecordingPlaceholderBlockId(
  recordingBlockId: string
) {
  return `${recordingBlockId}-local-recovery`;
}

export function isActiveNativeMeetingRecording(
  recording: { status: string } | null | undefined
): recording is { status: 'paused' | 'recording' } {
  return recording?.status === 'recording' || recording?.status === 'paused';
}

export async function ensurePortableMeetingRecording(input: {
  encode: (recording: {
    id: number;
    numberOfChannels: number;
    sampleRate: number;
  }) => Promise<Uint8Array>;
  persistEncoded: (recordingId: number, buffer: Uint8Array) => Promise<unknown>;
  readCurrent: () => Promise<{
    filepath?: string;
    id: number;
  } | null>;
  recording: {
    filepath?: string | null;
    id: number;
    numberOfChannels?: number | null;
    sampleRate?: number | null;
  } | null;
}) {
  const filepath = input.recording?.filepath?.trim();
  if (!filepath || !input.recording) {
    return filepath || null;
  }
  if (!isRawMeetingRecording(filepath)) {
    return filepath;
  }

  // A previous finalization attempt may have published the portable file and
  // then failed while exporting the microphone track or patching metadata.
  // Reuse that durable output before trying to read the now-removed raw file.
  const alreadyPublished = await input.readCurrent();
  const alreadyPublishedPath = alreadyPublished?.filepath?.trim();
  if (
    alreadyPublished?.id === input.recording.id &&
    alreadyPublishedPath &&
    !isRawMeetingRecording(alreadyPublishedPath)
  ) {
    return alreadyPublishedPath;
  }

  const sampleRate = input.recording.sampleRate;
  const numberOfChannels = input.recording.numberOfChannels;
  if (
    !Number.isFinite(sampleRate) ||
    Number(sampleRate) <= 0 ||
    !Number.isSafeInteger(numberOfChannels) ||
    Number(numberOfChannels) <= 0
  ) {
    throw new Error(
      'The raw meeting recording is missing its audio format and cannot be attached safely.'
    );
  }

  const encoded = await input.encode({
    id: input.recording.id,
    numberOfChannels: Number(numberOfChannels),
    sampleRate: Number(sampleRate),
  });
  if (!encoded.byteLength) {
    throw new Error(
      'The portable meeting recording encoder returned no audio.'
    );
  }
  await input.persistEncoded(input.recording.id, encoded);

  const current = await input.readCurrent();
  const portablePath = current?.filepath?.trim();
  if (
    current?.id !== input.recording.id ||
    !portablePath ||
    isRawMeetingRecording(portablePath)
  ) {
    throw new Error(
      'Nota encoded the meeting, but the desktop recording did not publish its portable file.'
    );
  }
  return portablePath;
}

export function meetingRecordingPathOnlyMarkdown(_filepath: string) {
  return [
    '## Recording',
    '',
    "This recovery recording predates Nota's portable workspace attachment flow. It remains in Nota's local recordings folder until it can be re-encoded.",
  ].join('\n');
}
