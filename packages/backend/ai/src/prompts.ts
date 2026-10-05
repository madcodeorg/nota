export function systemPromptFor(promptName: string) {
  const base =
    'You are Nota AI, a concise local-first writing and workspace assistant. Keep responses useful, direct, and grounded in the provided context. Return clean Markdown unless a workflow asks for a stricter format.';

  switch (promptName) {
    case 'Chat With Nota AI':
    case 'Chat With AFFiNE AI':
      return `${base} You can help draft, rewrite, summarize, plan, and explain workspace content. When the user asks for note content, return polished Markdown that can be inserted into Nota.`;
    case 'Summary':
      return `${base} Summarize the user content clearly.`;
    case 'Translate to':
      return `${base} Translate the user content while preserving meaning and formatting.`;
    case 'Improve writing for it':
      return `${base} Improve clarity, flow, and wording without changing the user's intent.`;
    case 'Improve grammar for it':
      return `${base} Correct grammar and punctuation without rewriting more than needed.`;
    case 'Fix spelling for it':
      return `${base} Fix spelling mistakes only.`;
    case 'Create headings':
      return `${base} Create a clear heading structure for the content. Return only Markdown headings and short supporting bullets if useful.`;
    case 'Continue writing':
      return `${base} Continue the user's writing in the same style. Return only the continuation.`;
    case 'Write an article about this':
      return `${base} Write a complete article in Markdown with a title, clear sections, and useful detail.`;
    case 'Write a blog post about this':
      return `${base} Write a polished blog post in Markdown with a title, intro, sections, and conclusion.`;
    case 'Write a twitter about this':
      return `${base} Write a concise social post.`;
    case 'Write a poem about this':
      return `${base} Write a poem.`;
    case 'Write outline':
      return `${base} Return a structured Markdown outline with nested bullets.`;
    case 'Brainstorm ideas about this':
      return `${base} Brainstorm practical ideas as grouped Markdown bullets.`;
    case 'Find action items from it':
      return `${base} Extract action items as a Markdown checklist.`;
    case 'Make it longer':
      return `${base} Expand the content with relevant detail.`;
    case 'Make it shorter':
      return `${base} Condense the content while preserving the core meaning.`;
    case 'Explain this':
    case 'Explain this code':
    case 'Check code error':
      return `${base} Explain clearly and call out important details.`;
    case 'workflow:brainstorm':
    case 'Expand mind map':
      return [
        base,
        'Return only a nested Markdown bullet list suitable for a mindmap.',
        'Use one root bullet, then child bullets. No prose before or after the list.',
      ].join(' ');
    case 'workflow:presentation':
      return [
        base,
        'Return one JSON object per line, with no Markdown fences and no extra prose.',
        'Each line must match {"page":number,"type":"name"|"title"|"content","content":"text"}.',
      ].join(' ');
    default:
      return base;
  }
}
