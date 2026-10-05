import { configureElectronStateStorageImpls } from '@nota/core/desktop/storage';
import { configureCommonModules } from '@nota/core/modules';
import { configureAppTabsHeaderModule } from '@nota/core/modules/app-tabs-header';
import { configureDesktopBackupModule } from '@nota/core/modules/backup';
import { ValidatorProvider } from '@nota/core/modules/cloud';
import {
  configureDesktopApiModule,
  DesktopApiService,
} from '@nota/core/modules/desktop-api';
import {
  configureSpellCheckSettingModule,
  configureTraySettingModule,
} from '@nota/core/modules/editor-setting';
import { configureFindInPageModule } from '@nota/core/modules/find-in-page';
import {
  ClientSchemeProvider,
  PopupWindowProvider,
} from '@nota/core/modules/url';
import { configureDesktopWorkbenchModule } from '@nota/core/modules/workbench';
import { configureBrowserWorkspaceFlavours } from '@nota/core/modules/workspace-engine';
import { Framework } from '@nota/infra';

export function setupModules() {
  const framework = new Framework();
  configureCommonModules(framework);
  configureElectronStateStorageImpls(framework);
  configureBrowserWorkspaceFlavours(framework);
  configureDesktopWorkbenchModule(framework);
  configureAppTabsHeaderModule(framework);
  configureFindInPageModule(framework);
  configureDesktopApiModule(framework);
  configureSpellCheckSettingModule(framework);
  configureTraySettingModule(framework);
  configureDesktopBackupModule(framework);

  framework.impl(PopupWindowProvider, p => {
    const apis = p.get(DesktopApiService).api;
    return {
      open: (url: string) => {
        apis.handler.ui.openExternal(url).catch(e => {
          console.error('Failed to open external URL', e);
        });
      },
    };
  });
  framework.impl(ClientSchemeProvider, p => {
    const appInfo = p.get(DesktopApiService).appInfo;
    return {
      getClientScheme() {
        return appInfo?.scheme;
      },
    };
  });
  framework.impl(ValidatorProvider, p => {
    const apis = p.get(DesktopApiService).api;
    return {
      async validate(_challenge, resource) {
        const token = await apis.handler.ui.getChallengeResponse(resource);
        if (!token) {
          throw new Error('Challenge failed');
        }
        return token;
      },
    };
  });

  const frameworkProvider = framework.provider();

  return { framework, frameworkProvider };
}
