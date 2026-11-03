import { DEFAULT_ACCENT_COLOR } from '@nota/component';
import { AppThemeService } from '@nota/core/modules/theme';
import { appSettingAtom, useService } from '@nota/infra';
import { useAtomValue } from 'jotai';
import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';
import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';

const themes = ['dark', 'light'];

function ThemeObserver() {
  const { resolvedTheme } = useTheme();
  const service = useService(AppThemeService);

  useEffect(() => {
    service.appTheme.theme$.next(resolvedTheme);
  }, [resolvedTheme, service.appTheme.theme$]);

  return null;
}

// Every window renders this provider, and the setting is synced across
// windows through localStorage, so all of them follow the chosen accent.
function AccentObserver() {
  const accentColor =
    useAtomValue(appSettingAtom).accentColor ?? DEFAULT_ACCENT_COLOR;

  useEffect(() => {
    document.documentElement.dataset.accent = accentColor;
  }, [accentColor]);

  return null;
}

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  return (
    <NextThemeProvider themes={themes} enableSystem={true}>
      {children}
      <ThemeObserver />
      <AccentObserver />
    </NextThemeProvider>
  );
};
