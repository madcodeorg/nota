import { describe, expect, it } from 'vitest';

import { getCalendarEventNotesPreview } from './calendar-event-notes';

describe('getCalendarEventNotesPreview', () => {
  const marker = '-::~:~::~:~:~:~:~:~:~:~:~:~:~::~:~::-';
  const conferencing = `${marker}\nJoin with Google Meet: https://meet.google.com/abc-defg-hij\nOr dial: +1 555 0100\nPlease do not edit this section.\n${marker}`;

  it('hides generated conferencing-only notes', () => {
    expect(getCalendarEventNotesPreview(conferencing)).toBe('');
  });

  it('preserves actual notes before and after the generated section', () => {
    const notes = `Discuss roadmap\n\n${conferencing}\nBring estimates`;
    expect(getCalendarEventNotesPreview(notes)).toBe(
      'Discuss roadmap\n\nBring estimates'
    );
    expect(notes).toContain(conferencing);
  });

  it('supports Windows line endings', () => {
    expect(
      getCalendarEventNotesPreview(conferencing.replaceAll('\n', '\r\n'))
    ).toBe('');
  });

  it('preserves user-authored links and unrelated separator sections', () => {
    const notes = `Use https://meet.google.com/abc-defg-hij\n${marker}\nAgenda\n${marker}`;
    expect(getCalendarEventNotesPreview(notes)).toBe(notes);
  });

  it('preserves incomplete sections rather than removing potential notes', () => {
    const notes = `${marker}\nJoin with Google Meet\nDiscuss roadmap`;
    expect(getCalendarEventNotesPreview(notes)).toBe(notes);
  });

  it('preserves a dashed agenda section containing a Meet link', () => {
    const notes =
      '----------\nDiscuss roadmap\nhttps://meet.google.com/abc-defg-hij\n----------';
    expect(getCalendarEventNotesPreview(notes)).toBe(notes);
  });

  it('handles absent notes', () => {
    expect(getCalendarEventNotesPreview()).toBe('');
    expect(getCalendarEventNotesPreview(null)).toBe('');
  });
});
