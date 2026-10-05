// Each SSE connection sends a status snapshot followed by its final segments.
// Skip exact snapshot replays before they enqueue transcript state updates.
export function createMeetingTranscriptReplayFilter<
  T extends { id: string },
>() {
  const snapshot = new Map<string, T>();

  return {
    reset(segments: readonly T[]) {
      snapshot.clear();
      for (const segment of segments) {
        snapshot.set(segment.id, segment);
      }
    },
    isReplay(segment: T) {
      const previous = snapshot.get(segment.id);
      snapshot.delete(segment.id);
      if (!previous) return false;

      // Transcript payloads have scalar fields. Compare all fields so same-ID
      // text, timing, source, or metadata revisions still reach the renderer.
      const keys = Object.keys(segment) as (keyof T)[];
      return (
        keys.length === Object.keys(previous).length &&
        keys.every(key => Object.is(segment[key], previous[key]))
      );
    },
  };
}
