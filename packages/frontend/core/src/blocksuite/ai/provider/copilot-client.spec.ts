// @vitest-environment happy-dom

import { showAILoginRequiredAtom } from '@nota/core/components/affine/auth/ai-login-required';
import { UserFriendlyError } from '@nota/error';
import { getCurrentStore } from '@nota/infra';
import { describe, expect, test, vi } from 'vitest';

import { CopilotClient, handleError, resolveError } from './copilot-client';
import { PaymentRequiredError, UnauthorizedError } from './error';

function backendError(status: 401 | 402) {
  return new UserFriendlyError({
    code: status === 401 ? 'UNAUTHORIZED' : 'PAYMENT_REQUIRED',
    message: 'Legacy cloud response',
    name: 'INTERNAL_SERVER_ERROR',
    status,
    type: status === 401 ? 'UNAUTHORIZED' : 'PAYMENT_REQUIRED',
  });
}

describe('CopilotClient chat retry', () => {
  test('maps 401 to local backend auth guidance without opening sign-in', () => {
    const store = getCurrentStore();
    store.set(showAILoginRequiredAtom, false);

    const error = handleError(backendError(401));

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toContain('local AI backend');
    expect(error.message).toContain('Restart Nota');
    expect(error.message).not.toContain('Cloud');
    expect(store.get(showAILoginRequiredAtom)).toBe(false);
  });

  test('maps 402 to selected-provider billing and model guidance', () => {
    const error = resolveError(backendError(402));

    expect(error).toBeInstanceOf(PaymentRequiredError);
    expect(error.message).toContain('selected AI provider');
    expect(error.message).toContain('billing or credits');
    expect(error.message).toContain('another model in AI settings');
    expect(error.message).not.toContain('Upgrade');
  });

  test('marks regenerate requests in the stream URL', () => {
    const urls: string[] = [];
    const client = new CopilotClient(
      vi.fn() as unknown as ConstructorParameters<typeof CopilotClient>[0],
      ((url: string) => {
        urls.push(url);
        return {} as EventSource;
      }) as ConstructorParameters<typeof CopilotClient>[1]
    );

    client.chatTextStream({ retry: true, sessionId: 'session-1' });

    expect(urls).toEqual(['/api/ai/chat/session-1/stream-object?retry=true']);
  });

  test('forwards the per-chat workspace privacy setting in the stream URL', () => {
    const urls: string[] = [];
    const client = new CopilotClient(
      vi.fn() as unknown as ConstructorParameters<typeof CopilotClient>[0],
      ((url: string) => {
        urls.push(url);
        return {} as EventSource;
      }) as ConstructorParameters<typeof CopilotClient>[1]
    );

    client.chatTextStream({
      sessionId: 'session-1',
      toolsConfig: { readingDocs: false, searchWorkspace: false },
    });

    const url = new URL(urls[0], 'https://nota.local');
    expect(JSON.parse(url.searchParams.get('toolsConfig') ?? '')).toEqual({
      readingDocs: false,
      searchWorkspace: false,
    });
  });
});
