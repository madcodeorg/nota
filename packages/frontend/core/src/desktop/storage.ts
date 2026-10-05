import { DesktopApiService } from '@nota/core/modules/desktop-api';
import {
  CacheStorage,
  GlobalCache,
  GlobalState,
} from '@nota/core/modules/storage';
import {
  ElectronGlobalCache,
  ElectronGlobalState,
} from '@nota/core/modules/storage/impls/electron';
import { IDBGlobalState } from '@nota/core/modules/storage/impls/storage';
import type { Framework } from '@nota/infra';

export function configureElectronStateStorageImpls(framework: Framework) {
  framework.impl(GlobalCache, ElectronGlobalCache, [DesktopApiService]);
  framework.impl(GlobalState, ElectronGlobalState, [DesktopApiService]);
  framework.impl(CacheStorage, IDBGlobalState);
}
