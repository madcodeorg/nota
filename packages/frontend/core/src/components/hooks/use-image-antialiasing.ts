import { useEffect } from 'react';

import { useAppSettingHelper } from './nota/use-app-setting-helper';

export function useImageAntialiasing() {
  const { appSettings } = useAppSettingHelper();

  useEffect(() => {
    document.documentElement.dataset.imageAntialiasing =
      appSettings.disableImageAntialiasing ? 'off' : 'on';
  }, [appSettings.disableImageAntialiasing]);
}
