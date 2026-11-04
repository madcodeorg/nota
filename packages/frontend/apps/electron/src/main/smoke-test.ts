import { appendFileSync, writeFileSync } from 'node:fs';

import { app } from 'electron';

/**
 * Release smoke test hook. Packaged builds ignore --remote-debugging-port (the
 * inspect fuse is off), so CI cannot drive the app from outside. With
 * NOTA_SMOKE_TEST=<file> set, the app writes that file once a renderer has
 * mounted its React root (#app has children), then exits. It also appends a
 * short trace to <file>.trace so a failed run shows how far startup got.
 * Without the variable this does nothing. See scripts/smoke-desktop-app.ts.
 */
export function setupSmokeTest() {
  const resultFile = process.env.NOTA_SMOKE_TEST;
  if (!resultFile) return;

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
  trace('smoke hook installed');
  app
    .whenReady()
    .then(() => trace('app ready'))
    .catch(() => {});

  let done = false;
  app.on('web-contents-created', (_event, contents) => {
    trace(`web contents created (${contents.getType()})`);
    contents.on('did-fail-load', (_e, code, description, url) =>
      trace(`did-fail-load ${code} ${description} ${url}`)
    );
    contents.on('render-process-gone', (_e, details) =>
      trace(`render-process-gone ${details.reason}`)
    );
    contents.on('did-finish-load', () => {
      trace(`did-finish-load ${contents.getURL()}`);
      const poll = async () => {
        for (let attempt = 0; attempt < 120 && !done; attempt++) {
          try {
            const children = await contents.executeJavaScript(
              "document.getElementById('app')?.childElementCount ?? -1"
            );
            if (attempt % 10 === 0) trace(`#app children: ${children}`);
            if (typeof children === 'number' && children > 0) {
              done = true;
              writeFileSync(resultFile, contents.getURL());
              app.exit(0);
              return;
            }
          } catch (error) {
            trace(`probe failed: ${String(error)}`);
            return; // the page went away; another page may still mount
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      };
      poll().catch(() => {});
    });
  });
}
