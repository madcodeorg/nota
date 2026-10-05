export async function finalizeConfirmedMeetingCapture(input: {
  finishMicSpool: () => Promise<unknown>;
  persistRecordingMetadata: () => Promise<unknown>;
  releaseNativeRecording: () => Promise<unknown>;
}) {
  // The backend meeting is already confirmed stopped by the caller. Keep the
  // local recovery artifacts until its durable recording metadata is also
  // confirmed, then remove them from least to most broadly recoverable.
  await input.persistRecordingMetadata();
  await input.finishMicSpool();
  await input.releaseNativeRecording();
}
