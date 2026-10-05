import { ThemeProvider } from '@nota/core/components/theme-provider';
import { configureElectronStateStorageImpls } from '@nota/core/desktop/storage';
import { configureDesktopApiModule } from '@nota/core/modules/desktop-api';
import { configureI18nModule, I18nProvider } from '@nota/core/modules/i18n';
import { configureStorageModule } from '@nota/core/modules/storage';
import { configureEssentialThemeModule } from '@nota/core/modules/theme';
import { appInfo } from '@nota/electron-api';
import { Framework, FrameworkRoot } from '@nota/infra';

import * as styles from './app.css';
import { MeetingPopup } from './meeting';
import { Recording } from './recording';

const framework = new Framework();
configureI18nModule(framework);
configureEssentialThemeModule(framework);
configureStorageModule(framework);
configureElectronStateStorageImpls(framework);
configureDesktopApiModule(framework);
const frameworkProvider = framework.provider();

const mode = appInfo?.windowName as 'meeting' | 'notification' | 'recording';

export function App() {
  return (
    <FrameworkRoot framework={frameworkProvider}>
      <ThemeProvider>
        <I18nProvider>
          <div className={styles.root} data-is-windows={environment.isWindows}>
            {mode === 'meeting' && <MeetingPopup />}
            {mode === 'recording' && <Recording />}
          </div>
        </I18nProvider>
      </ThemeProvider>
    </FrameworkRoot>
  );
}
