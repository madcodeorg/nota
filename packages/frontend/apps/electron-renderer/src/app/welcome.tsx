import { NotaWelcome } from '@nota/core/desktop/pages/onboarding/nota-welcome';
import {
  configureDesktopApiModule,
  DesktopApiService,
} from '@nota/core/modules/desktop-api';
import { configureGoogleAuthModule } from '@nota/core/modules/google-auth';
import {
  configureUrlModule,
  PopupWindowProvider,
} from '@nota/core/modules/url';
import { apis, sharedStorage } from '@nota/electron-api';
import { Framework, FrameworkRoot } from '@nota/infra';

// The first-launch window only needs the desktop bridge (permissions) and
// Google sign-in. Workspaces and storage load with the main window.
const framework = new Framework();
configureDesktopApiModule(framework);
configureUrlModule(framework);
configureGoogleAuthModule(framework);
framework.impl(PopupWindowProvider, p => {
  const api = p.get(DesktopApiService).api;
  return {
    open: (url: string) => {
      api.handler.ui.openExternal(url).catch(error => {
        console.error('Failed to open external URL', error);
      });
    },
  };
});
const frameworkProvider = framework.provider();

const openMainApp = () => {
  if (!apis) throw new Error('Desktop APIs are unavailable.');
  return apis.ui.handleOpenMainApp();
};

// Shared global state reaches the main window, whose AI model service
// validates this choice when it starts.
const selectChatModel = (id: string) => {
  sharedStorage?.globalState.set('AIModelId', `local:${id}`);
};

export function WelcomeApp() {
  return (
    <FrameworkRoot framework={frameworkProvider}>
      <NotaWelcome
        desktopOverlay
        onOpenApp={openMainApp}
        onChatSelected={selectChatModel}
      />
    </FrameworkRoot>
  );
}
