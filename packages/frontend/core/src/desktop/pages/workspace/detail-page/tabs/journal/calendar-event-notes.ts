// Google Calendar appends conferencing instructions between generated markers.
// Hide only recognized, complete sections in the preview; retain original notes.
export function getCalendarEventNotesPreview(notes?: string | null): string {
  if (!notes) return '';

  return notes
    .replace(
      /^[ \t]*-::~:[:~]{10,}::-[ \t]*\r?\n([\s\S]*?)^[ \t]*-::~:[:~]{10,}::-[ \t]*(?:\r?\n|$)/gm,
      (section, content: string) =>
        /(?:https?:\/\/meet\.google\.com\/|Join with Google Meet)/i.test(
          content
        )
          ? ''
          : section
    )
    .trim();
}
