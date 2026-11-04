import { appendFileSync } from 'node:fs';

// Imported first by main/index.ts so it runs before every other module: tells
// the release smoke test whether the packaged main bundle started at all, and
// records any startup error (otherwise Electron only shows a modal "Error"
// dialog that nobody can read on a CI runner). Does nothing without
// NOTA_SMOKE_TEST.
const resultFile = process.env.NOTA_SMOKE_TEST;
if (resultFile) {
  const trace = (message: string) => {
    try {
      appendFileSync(
        `${resultFile}.trace`,
        `${new Date().toISOString()} ${message}\n`
      );
    } catch {
      // tracing must never break startup
    }
  };
  trace('main bundle started');
  process.on('uncaughtException', error => {
    trace(`uncaughtException: ${error?.stack ?? String(error)}`);
    // Without a listener Electron would block on a modal error dialog.
    process.exit(1);
  });
  process.on('unhandledRejection', reason => {
    trace(`unhandledRejection: ${(reason as Error)?.stack ?? String(reason)}`);
  });
}
