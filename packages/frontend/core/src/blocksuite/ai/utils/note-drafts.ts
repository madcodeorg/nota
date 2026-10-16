export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'note'; text: string };

// The chat prompt asks the model to wrap insertable note content in a
// ```note fence. An unclosed fence still counts so drafts style while streaming.
const NOTE_FENCE = /^```note[^\S\n]*\n([\s\S]*?)(?:^```[^\S\n]*$|(?![\s\S]))/gm;

// Replies saved before the fence existed introduce drafts with a line such as
// "Here's a ready-to-insert draft:"; everything after that line is the draft.
const DRAFT_INTRO =
  /^[^\n]*\b(?:draft|ready-to-(?:insert|paste)|paste-ready)\b[^\n]*:[^\S\n]*$/im;

function splitIntroducedDraft(text: string): MessagePart[] {
  const match = DRAFT_INTRO.exec(text);
  if (!match) return [{ type: 'text', text }];
  const end = match.index + match[0].length;
  const note = text.slice(end).trim();
  if (!note) return [{ type: 'text', text }];
  return [
    { type: 'text', text: text.slice(0, end) },
    { type: 'note', text: note },
  ];
}

export function splitNoteDrafts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(NOTE_FENCE)) {
    const before = text.slice(last, match.index);
    if (before.trim()) parts.push({ type: 'text', text: before });
    const note = match[1].replace(/\n$/, '');
    if (note.trim()) parts.push({ type: 'note', text: note });
    last = match.index + match[0].length;
  }
  const rest = text.slice(last);
  if (!parts.length) return splitIntroducedDraft(text);
  if (rest.trim()) parts.push({ type: 'text', text: rest });
  return parts;
}
