import {
  type StreamObject,
  StreamObjectSchema,
} from '../components/ai-chat-messages/type';

export function mergeStreamObjects(chunks: StreamObject[] = []) {
  return chunks.reduce((acc, curr) => {
    const prev = acc.at(-1);
    switch (curr.type) {
      case 'reasoning':
      case 'text-delta': {
        if (prev && prev.type === curr.type) {
          acc[acc.length - 1] = {
            ...prev,
            textDelta: prev.textDelta + curr.textDelta,
          };
        } else {
          acc.push(curr);
        }
        break;
      }
      case 'tool-result': {
        const index = acc.findIndex(
          item =>
            item.type === 'tool-call' &&
            item.toolCallId === curr.toolCallId &&
            item.toolName === curr.toolName
        );
        if (index !== -1) {
          acc[index] = curr;
        } else {
          acc.push(curr);
        }
        break;
      }
      default: {
        acc.push(curr);
        break;
      }
    }
    return acc;
  }, [] as StreamObject[]);
}

export type AnswerSegment =
  | { kind: 'object'; data: StreamObject }
  | { kind: 'steps'; items: StreamObject[] };

/**
 * Groups consecutive tool steps so a finished answer can show them as one
 * line. Reasoning is never displayed, so it does not split a group.
 */
export function groupToolSteps(
  objects: StreamObject[],
  isStep: (data: StreamObject) => boolean
): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  for (const data of objects) {
    if (data.type === 'reasoning') continue;
    if (data.type === 'text-delta' && !data.textDelta.trim()) continue;
    const last = segments.at(-1);
    if (!isStep(data)) {
      segments.push({ kind: 'object', data });
    } else if (last?.kind === 'steps') {
      last.items.push(data);
    } else {
      segments.push({ kind: 'steps', items: [data] });
    }
  }
  return segments;
}

function parseStreamObject(chunk: string): StreamObject | null {
  try {
    const parsed = StreamObjectSchema.safeParse(JSON.parse(chunk));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Adds one streamed chunk to an assistant answer. The backend sends plain
 * text deltas and JSON stream objects on the same channel; once any object
 * arrives, messages render only `streamObjects`, so text must be kept there
 * too, in arrival order, or it disappears until history reloads.
 */
export function appendStreamChunk(
  answer: { content: string; streamObjects?: StreamObject[] | null },
  chunk: string
): { content: string; streamObjects?: StreamObject[] } {
  const current = answer.streamObjects ?? [];
  const object = parseStreamObject(chunk);
  if (!object) {
    const content = answer.content + chunk;
    if (!current.length) return { content };
    return {
      content,
      streamObjects: mergeStreamObjects([
        ...current,
        { type: 'text-delta', textDelta: chunk },
      ]),
    };
  }
  const prior: StreamObject[] =
    current.length || !answer.content
      ? current
      : [{ type: 'text-delta', textDelta: answer.content }];
  return {
    content: answer.content,
    streamObjects: mergeStreamObjects([...prior, object]),
  };
}

export function mergeStreamContent(chunks: StreamObject[]): string {
  return chunks.reduce((acc, curr) => {
    if (curr.type === 'text-delta') {
      acc += curr.textDelta;
    }
    return acc;
  }, '');
}
