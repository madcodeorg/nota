import { setupGlobal } from '@nota/env/global';
import { getBuildConfig } from '@nota-tools/utils/build-config';
import { Package } from '@nota-tools/utils/workspace';

globalThis.BUILD_CONFIG = getBuildConfig(new Package('@nota/web'), {
  mode: 'development',
  channel: 'canary',
});

if (typeof window !== 'undefined') {
  window.location.search = '?prefixUrl=http://127.0.0.1:3010/';
}

setupGlobal();
