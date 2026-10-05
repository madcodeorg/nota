export const RAW_AUDIO_READ_CHUNK_BYTES = 1024 * 1024;

export function rawAudioReadWindow(input: {
  channels: number;
  cursor: number;
  fileSize: number;
}) {
  if (!Number.isInteger(input.channels) || input.channels < 1) {
    throw new Error('Raw audio channel count must be a positive integer.');
  }
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) {
    throw new Error('Raw audio cursor must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize < 0) {
    throw new Error('Raw audio file size must be a non-negative safe integer.');
  }

  const frameBytes = Float32Array.BYTES_PER_ELEMENT * input.channels;
  if (input.cursor % frameBytes !== 0) {
    throw new Error('Raw audio cursor must start on a complete PCM frame.');
  }

  const availableBytes = Math.max(0, input.fileSize - input.cursor);
  const completeAvailableBytes =
    Math.floor(availableBytes / frameBytes) * frameBytes;
  const alignedChunkBytes =
    Math.floor(RAW_AUDIO_READ_CHUNK_BYTES / frameBytes) * frameBytes;

  return {
    length: Math.min(completeAvailableBytes, alignedChunkBytes),
    start: input.cursor,
  };
}
