import { appendFileSync } from 'node:fs';

// Imported first by main/index.ts so it runs before every other module: tells
// the release smoke test whether the packaged main bundle started at all.
if (process.env.NOTA_SMOKE_TEST) {
  try {
    appendFileSync(
      `${process.env.NOTA_SMOKE_TEST}.trace`,
      `${new Date().toISOString()} main bundle started\n`
    );
  } catch {
    // tracing must never break startup
  }
}
