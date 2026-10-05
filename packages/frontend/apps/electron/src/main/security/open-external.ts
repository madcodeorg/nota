import cp from 'node:child_process';

import { shell } from 'electron';

const DEFAULT_ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export interface OpenExternalOptions {
  additionalProtocols?: string[];
}

export const isAllowedExternalUrl = (
  rawUrl: string,
  additionalProtocols: Iterable<string> = []
) => {
  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol.toLowerCase();
    if (DEFAULT_ALLOWED_PROTOCOLS.has(protocol)) {
      return true;
    }

    for (const extra of additionalProtocols) {
      if (protocol === extra.toLowerCase()) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn('[security] Failed to parse external URL', rawUrl, error);
    return false;
  }
};

export const openExternalSafely = async (
  rawUrl: string,
  options: OpenExternalOptions = {}
) => {
  const { additionalProtocols = [] } = options;

  if (!isAllowedExternalUrl(rawUrl, additionalProtocols)) {
    console.warn('[security] Blocked attempt to open external URL:', rawUrl);
    return;
  }

  try {
    await shell.openExternal(rawUrl);
  } catch (error) {
    console.error('[security] Failed to open external URL:', rawUrl, error);
  }
};
export const ALLOWED_EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(
  DEFAULT_ALLOWED_PROTOCOLS
);

/**
 * Keep Windows Settings outside the general external-URL allowlist. Only
 * this fixed microphone pane may be opened by the recording recovery action.
 */
export const openWindowsMicrophoneSettings = async (): Promise<boolean> => {
  if (process.platform !== 'win32') {
    return false;
  }
  try {
    await shell.openExternal('ms-settings:privacy-microphone');
    return true;
  } catch (error) {
    console.error(
      '[security] Failed to open Windows microphone Settings',
      error
    );
    return false;
  }
};

/**
 * Open a macOS System Settings privacy pane reliably.
 *
 * `shell.openExternal` can silently no-op for the `x-apple.systempreferences:`
 * scheme on recent macOS, so we shell out to the `open` command, which honors
 * the legacy preference anchors (e.g. `Privacy_ScreenCapture`,
 * `Privacy_Microphone`, `Privacy_Calendars`) and brings System Settings to the
 * front. Returns true when `open` was launched successfully.
 */
export const openMacSystemSettings = (anchor: string) =>
  new Promise<boolean>(resolve => {
    const url = `x-apple.systempreferences:com.apple.preference.security?${anchor}`;
    cp.execFile('open', [url], error => {
      if (error) {
        console.error(
          '[security] Failed to open macOS System Settings pane:',
          url,
          error
        );
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
