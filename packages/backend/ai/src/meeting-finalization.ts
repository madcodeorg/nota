export class MeetingFinalizationTracker {
  private readonly pending = new Map<string, Promise<void>>();

  start(meetingId: string, finalize: () => Promise<void>) {
    const existing = this.pending.get(meetingId);
    if (existing) {
      return existing;
    }

    const finalization = Promise.resolve().then(finalize);
    this.pending.set(meetingId, finalization);

    const clear = () => {
      if (this.pending.get(meetingId) === finalization) {
        this.pending.delete(meetingId);
      }
    };
    void finalization.then(clear, clear);

    return finalization;
  }

  async wait(meetingId: string) {
    await this.pending.get(meetingId);
  }

  async waitAll() {
    while (this.pending.size) {
      await Promise.allSettled(this.pending.values());
    }
  }
}
