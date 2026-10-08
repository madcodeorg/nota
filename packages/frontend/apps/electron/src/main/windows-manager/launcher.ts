import { logger } from '../logger';
import { initAndShowMainWindow } from './main-window';
import { getOrCreateOnboardingWindow } from './onboarding';
import { launchStage } from './stage';

/**
 * Launch app depending on launch stage
 */
export async function launch() {
  try {
    if (launchStage.value === 'onboarding') {
      const window = await getOrCreateOnboardingWindow();
      window.show();
      return;
    }
    await initAndShowMainWindow();
  } catch (e) {
    logger.error('Failed to restore or create window:', e);
  }
}
