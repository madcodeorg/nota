import path from 'node:path';

import { buildForge } from 'app-builder-lib';
import debug from 'debug';
import fs from 'fs-extra';

import {
  appIdMap,
  arch,
  buildType,
  platform,
  productName,
  ROOT,
} from './make-env.js';

const log = debug('nota:make-appx');

// Microsoft Store identity values come from Partner Center
// (Product identity page) after the app name is reserved.
const storeEnv = {
  identityName: process.env.NOTA_MSSTORE_IDENTITY_NAME,
  publisher: process.env.NOTA_MSSTORE_PUBLISHER,
  publisherDisplayName: process.env.NOTA_MSSTORE_PUBLISHER_DISPLAY_NAME,
};

async function make() {
  const missing = Object.entries(storeEnv)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Missing Microsoft Store identity values: ${missing.join(', ')}`
    );
  }

  const appName = productName;
  const makeDir = path.resolve(ROOT, 'out', buildType, 'make');
  const outPath = path.resolve(makeDir, `appx.windows/${arch}`);
  const appDirectory = path.resolve(
    ROOT,
    'out',
    buildType,
    `${appName}-${platform}-${arch}`
  );

  await fs.ensureDir(outPath);
  await fs.emptyDir(outPath);

  const tmpPath = await fs.mkdtemp(path.join(makeDir, 'appx-temp-'));
  log(`Copying app to ${tmpPath}`);
  await fs.copy(appDirectory, tmpPath);

  // The Store signs the package on submission, so it is built unsigned.
  const output = await buildForge(
    { dir: tmpPath },
    {
      win: [`appx:${arch}`],
      // @ts-expect-error - upstream type is wrong
      publish: null,
      config: {
        appId: appIdMap[buildType],
        productName,
        executableName: productName,
        directories: {
          output: path.join(makeDir, 'appx-output'),
          // Tile and store logos live in resources/appx.
          buildResources: path.resolve(ROOT, 'resources'),
        },
        extraMetadata: {
          name: productName,
        },
        protocols: [
          {
            name: productName,
            schemes: [productName.toLowerCase()],
          },
        ],
        appx: {
          applicationId: productName.replace(/[^A-Za-z0-9]/g, ''),
          displayName: productName,
          identityName: storeEnv.identityName,
          publisher: storeEnv.publisher,
          publisherDisplayName: storeEnv.publisherDisplayName,
          backgroundColor: 'transparent',
          languages: ['en-US'],
          capabilities: ['microphone'],
        },
      },
    }
  );

  log('making appx done:', output);
  for (const file of output) {
    if (!/\.(appx|msix)$/i.test(file)) continue;
    await fs.move(file, path.resolve(outPath, path.basename(file)), {
      overwrite: true,
    });
  }

  await fs.remove(tmpPath);
}

make().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
