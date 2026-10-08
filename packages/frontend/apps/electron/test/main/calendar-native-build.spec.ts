import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  execFile: vi.fn(),
  fs: {
    access: vi.fn(),
    chmod: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    mkdtemp: vi.fn(),
    readdir: vi.fn(),
    rm: vi.fn(),
  },
  loadError: null as Error | null,
  missingExport: null as string | null,
  api: {
    getAppleCalendarStatus: vi.fn(),
    requestAppleCalendarAccess: vi.fn(),
    listAppleCalendars: vi.fn(),
    listAppleCalendarEvents: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({ execFile: fixtures.execFile }));
vi.mock('node:fs/promises', () => ({ default: fixtures.fs }));
vi.mock('../../scripts/make-env.js', () => ({ arch: process.arch }));

const { buildAppleCalendarNative } =
  await import('../../scripts/build-apple-calendar-native');

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.loadError = null;
  fixtures.missingExport = null;
  fixtures.fs.mkdtemp.mockResolvedValue('/tmp/nota-calendar-build-fixture');
  fixtures.fs.access.mockResolvedValue(undefined);
  fixtures.execFile.mockImplementation(
    (
      _file: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      try {
        if (args[0] === '-e') {
          if (fixtures.loadError) throw fixtures.loadError;
          const binding: Record<string, unknown> = { ...fixtures.api };
          if (fixtures.missingExport) {
            delete binding[fixtures.missingExport];
          }
          // Execute the real load/API-check program, without calling EventKit.
          runInNewContext(args[1], {
            process: { argv: ['node', args[2]] },
            require: (name: string) =>
              name === 'node:assert/strict' ? assert : binding,
          });
        }
        callback(null, '', '');
      } catch (error) {
        callback(error as Error, '', '');
      }
    }
  );
});

describe('Calendar native release build', () => {
  it('exempts the Calendar module from the release symbol stripper', () => {
    const cargo = readFileSync(
      new URL('../../../../../../Cargo.toml', import.meta.url),
      'utf8'
    );
    expect(cargo).toMatch(
      /\[profile\.release\.package\.nota_apple_calendar_native\]\s+strip\s*=\s*"none"/
    );
  });

  it.runIf(process.platform === 'darwin')(
    'validates exported methods before staging without invoking Calendar APIs',
    async () => {
      await expect(buildAppleCalendarNative()).resolves.toMatchObject({
        built: true,
      });
      expect(fixtures.execFile).toHaveBeenCalledTimes(2);
      expect(fixtures.fs.copyFile).toHaveBeenCalledOnce();
      expect(fixtures.execFile.mock.invocationCallOrder[1]).toBeLessThan(
        fixtures.fs.copyFile.mock.invocationCallOrder[0]
      );
      for (const api of Object.values(fixtures.api)) {
        expect(api).not.toHaveBeenCalled();
      }
    }
  );

  it.runIf(process.platform === 'darwin')(
    'refuses to stage a binding rejected by dlopen and cleans temporary output',
    async () => {
      fixtures.loadError = new Error('mis-aligned LINKEDIT string pool');
      await expect(buildAppleCalendarNative()).rejects.toThrow(
        'mis-aligned LINKEDIT string pool'
      );
      expect(fixtures.fs.copyFile).not.toHaveBeenCalled();
      expect(fixtures.fs.rm).toHaveBeenCalledWith(
        '/tmp/nota-calendar-build-fixture',
        { recursive: true, force: true }
      );
    }
  );

  it.runIf(process.platform === 'darwin')(
    'refuses to stage a binding with a missing Calendar method',
    async () => {
      fixtures.missingExport = 'listAppleCalendarEvents';
      await expect(buildAppleCalendarNative()).rejects.toThrow(
        'Missing Calendar native API: listAppleCalendarEvents'
      );
      expect(fixtures.fs.copyFile).not.toHaveBeenCalled();
    }
  );
});
