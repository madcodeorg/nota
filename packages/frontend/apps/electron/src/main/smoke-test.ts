import { writeFileSync } from 'node:fs';

import { app } from 'electron';

/**
 * Release smoke test hook. Packaged builds ignore --remote-debugging-port (the
 * inspect fuse is off), so CI cannot drive the app from outside. With
 * NOTA_SMOKE_TEST=<file> set, the app writes that file once a renderer has
 * mounted its React root (#app has children), then exits. Without the variable
 * this does nothing. See scripts/smoke-desktop-app.ts.
 */
export function setupSmokeTest() {
  const resultFile = process.env.NOTA_SMOKE_TEST;
  if (!resultFile) return;

  let done = false;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => {
      const poll = async () => {
        for (let attempt = 0; attempt < 120 && !done; attempt++) {
          try {
            const children = await contents.executeJavaScript(
              "document.getElementById('app')?.childElementCount ?? -1"
            );
            if (typeof children === 'number' && children > 0) {
              done = true;
              writeFileSync(resultFile, contents.getURL());
              app.exit(0);
              return;
            }
          } catch {
            return; // the page went away; another page may still mount
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      };
      poll().catch(() => {});
    });
  });
}
