import './setup';

import { appConfigProxy } from '@nota/core/components/hooks/use-app-config-storage';
import { Telemetry } from '@nota/core/components/telemetry';
import { appInfo } from '@nota/electron-api';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

async function main() {
  // load persistent config for electron
  // TODO(@Peng): should be sync, but it's not necessary for now
  appConfigProxy
    .getSync()
    .catch(() => console.error('failed to load app config'));

  // The transparent first-launch window runs setup without workspace or
  // storage services. The normal app loads only in the main window.
  const rootElement = document.getElementById('app');
  if (!rootElement) throw new Error('App root is missing.');
  const root = createRoot(rootElement);
  if (appInfo?.windowName === 'onboarding') {
    document.documentElement.dataset.notaOnboardingOverlay = 'true';
    document.documentElement.dataset.notaOnboardingPlatform = globalThis
      .environment?.isWindows
      ? 'windows'
      : 'desktop';
    const { WelcomeApp } = await import('./welcome');
    root.render(
      <StrictMode>
        <WelcomeApp />
      </StrictMode>
    );
    return;
  }
  const { App } = await import('./app');
  root.render(
    <StrictMode>
      <Telemetry />
      <App />
    </StrictMode>
  );
}
main().catch(err => {
  console.error('Failed to bootstrap app', err);
});
