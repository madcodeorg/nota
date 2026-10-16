import fs from 'node:fs';
import path from 'node:path';

import {
  type AppConfigSchema,
  AppConfigStorage,
  defaultAppConfig,
} from '@nota/infra/app-config-storage';
import { app } from 'electron';

const FILENAME = 'config.json';
const FILEPATH = path.join(app.getPath('userData'), FILENAME);

// This module is the only reader/writer of config.json, so the parsed value
// can be cached after the first successful read or write.
let cached: AppConfigSchema | undefined;

/**
 * @deprecated use shared storage
 */
export const persistentConfig = new AppConfigStorage({
  config: defaultAppConfig,
  get: () => (cached ??= JSON.parse(fs.readFileSync(FILEPATH, 'utf-8'))),
  set: data => {
    fs.writeFileSync(FILEPATH, JSON.stringify(data, null, 2));
    cached = data;
  },
});
