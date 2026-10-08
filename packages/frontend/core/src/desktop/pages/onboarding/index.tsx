import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { useServiceOptional } from '@nota/infra';
import { useCallback, useEffect } from 'react';
import { redirect, useNavigate } from 'react-router-dom';

import { appConfigStorage } from '../../../components/hooks/use-app-config-storage';
import { NotaWelcome } from './nota-welcome';

/**
 * /onboarding page
 *
 * only for electron
 */
export const loader = () => {
  if (!BUILD_CONFIG.isElectron && !appConfigStorage.get('onBoarding')) {
    // onboarding is off, redirect to index
    return redirect('/');
  }

  return null;
};

export const Component = () => {
  const desktopApi = useServiceOptional(DesktopApiService);
  const navigate = useNavigate();
  const desktopOverlay = desktopApi?.appInfo.windowName === 'onboarding';
  useEffect(() => {
    if (!desktopOverlay) return;
    document.documentElement.dataset.notaOnboardingOverlay = 'true';
    return () => {
      delete document.documentElement.dataset.notaOnboardingOverlay;
    };
  }, [desktopOverlay]);

  const openApp = useCallback(async () => {
    if (desktopApi) await desktopApi.handler.ui.handleOpenMainApp();
    else {
      appConfigStorage.patch('onBoarding', false);
      navigate('/');
    }
  }, [desktopApi, navigate]);

  return <NotaWelcome onOpenApp={openApp} desktopOverlay={desktopOverlay} />;
};
