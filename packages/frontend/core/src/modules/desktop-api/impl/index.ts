import { apis, appInfo, events, sharedStorage } from '@nota/electron-api';
import { Service } from '@nota/infra';

import type { DesktopApiProvider } from '../provider';

export class ElectronApiImpl extends Service implements DesktopApiProvider {
  constructor() {
    super();

    if (!apis || !events || !sharedStorage || !appInfo) {
      throw new Error('Failed to initialize DesktopApiImpl');
    }
  }
  handler = apis;
  events = events;
  sharedStorage = sharedStorage;
  appInfo = appInfo as NonNullable<typeof appInfo>;
}
