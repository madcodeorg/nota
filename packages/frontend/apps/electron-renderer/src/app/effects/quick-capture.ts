import { appendQuickCaptureToJournal } from '@nota/core/modules/journal/quick-capture';
import { apis, events } from '@nota/electron-api';
import type { FrameworkProvider } from '@nota/infra';

import { getCurrentWorkspace } from './utils';

const RETRY_MS = 500;
const MAX_RETRIES = 120;

let flushing = false;
let flushAgain = false;
let retries = 0;
let retryTimer: number | null = null;

async function flushQuickCaptures(frameworkProvider: FrameworkProvider) {
  if (!apis) return;
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    if (!(await apis.ui.isActiveTab())) return;
    using currentWorkspace = getCurrentWorkspace(frameworkProvider);
    if (!currentWorkspace) {
      // The workspace is still opening; captures stay queued in main.
      if (retries++ >= MAX_RETRIES) return;
      retryTimer ??= window.setTimeout(() => {
        retryTimer = null;
        flushQuickCaptures(frameworkProvider).catch(console.error);
      }, RETRY_MS);
      return;
    }
    retries = 0;
    const texts = await apis.quickCapture.takePending();
    for (const [index, text] of texts.entries()) {
      try {
        await appendQuickCaptureToJournal(currentWorkspace.workspace, text);
      } catch (error) {
        console.error('Failed to save quick note to the journal', error);
        await apis.quickCapture.requeue(texts.slice(index));
        return;
      }
    }
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      flushQuickCaptures(frameworkProvider).catch(console.error);
    }
  }
}

export function setupQuickCaptureEvents(frameworkProvider: FrameworkProvider) {
  events?.quickCapture.onCaptured(() => {
    retries = 0;
    flushQuickCaptures(frameworkProvider).catch(console.error);
  });
  flushQuickCaptures(frameworkProvider).catch(console.error);
}
