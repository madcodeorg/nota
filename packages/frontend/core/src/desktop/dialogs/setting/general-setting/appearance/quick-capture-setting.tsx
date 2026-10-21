import type { RadioItem } from '@nota/component';
import { RadioGroup, Switch } from '@nota/component';
import { SettingRow, SettingWrapper } from '@nota/component/setting-components';
import { GlobalStateService } from '@nota/core/modules/storage';
import type { QuickCaptureStateSchema } from '@nota/electron/main/shared-state-schema';
import { LiveData, useLiveData, useService } from '@nota/infra';
import { useMemo } from 'react';

import { settingWrapper } from './style.css';

const QUICK_CAPTURE_KEY = 'quickCapture';
const DEFAULT_SETTINGS: QuickCaptureStateSchema = {
  enabled: true,
  shortcut: 'CommandOrControl+Shift+Space',
};

const formatShortcut = (accelerator: string) =>
  environment.isMacOs
    ? accelerator
        .replace('CommandOrControl', '⌘')
        .replace('Control', '⌃')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥')
        .replaceAll('+', '')
    : accelerator.replace('CommandOrControl', 'Ctrl');

const SHORTCUT_OPTIONS = [
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Alt+N',
  'Control+Alt+Space',
];

export const QuickCaptureSetting = () => {
  const globalState = useService(GlobalStateService).globalState;
  const settings$ = useMemo(
    () =>
      LiveData.from(
        globalState.watch<QuickCaptureStateSchema>(QUICK_CAPTURE_KEY),
        undefined
      ).map(value => ({ ...DEFAULT_SETTINGS, ...value })),
    [globalState]
  );
  const settings = useLiveData(settings$);

  const update = (patch: Partial<QuickCaptureStateSchema>) => {
    globalState.set(QUICK_CAPTURE_KEY, { ...settings, ...patch });
  };

  const items = useMemo<RadioItem[]>(
    () =>
      SHORTCUT_OPTIONS.map(value => ({
        value,
        label: formatShortcut(value),
      })),
    []
  );

  return (
    <SettingWrapper id="quickCapture" title="Quick capture">
      <SettingRow
        name="Quick note shortcut"
        desc="Open a small note window from any app. Notes are saved to today’s journal."
      >
        <Switch
          checked={settings.enabled}
          onChange={checked => update({ enabled: checked })}
        />
      </SettingRow>
      {settings.enabled ? (
        <SettingRow
          name="Shortcut"
          desc="If the shortcut is used by another app, pick a different one."
        >
          <RadioGroup
            items={items}
            value={settings.shortcut}
            width={300}
            className={settingWrapper}
            onChange={(value: string) => update({ shortcut: value })}
          />
        </SettingRow>
      ) : null}
    </SettingWrapper>
  );
};
