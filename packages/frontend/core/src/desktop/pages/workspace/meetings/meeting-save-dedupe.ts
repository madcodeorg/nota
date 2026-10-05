const inFlightMeetingSaves = new Map<string, Promise<unknown>>();

/** Shares one mutation promise between the Meetings route and workspace worker. */
export function runMeetingSaveOnce<T>(
  key: string,
  execute: () => Promise<T>
): Promise<T> {
  const existing = inFlightMeetingSaves.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const promise = execute().finally(() => {
    if (inFlightMeetingSaves.get(key) === promise) {
      inFlightMeetingSaves.delete(key);
    }
  });
  inFlightMeetingSaves.set(key, promise);
  return promise;
}
