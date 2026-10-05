import {
  AiIcon,
  AppearanceIcon,
  FolderIcon,
  InformationIcon,
  KeyboardIcon,
  MeetingIcon,
  PenIcon,
} from '@blocksuite/icons/rc';
import type { SettingTab } from '@nota/core/modules/dialogs/constant';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { MeetingSettingsService } from '@nota/core/modules/media/services/meeting-settings';
import { useI18n } from '@nota/i18n';
import { useLiveData, useServices } from '@nota/infra';
import { useMemo } from 'react';

import type { SettingSidebarItem, SettingState } from '../types';
import { AboutAffine } from './about';
import { AISettingsPanel } from './ai';
import { AppearanceSettings } from './appearance';
import { BackupSettingPanel } from './backup';
import { EditorSettings } from './editor';
import { MeetingsSettings } from './meetings';
import { Shortcuts } from './shortcuts';

export type GeneralSettingList = SettingSidebarItem[];

export const useGeneralSettingList = (): GeneralSettingList => {
  const t = useI18n();
  const { featureFlagService, meetingSettingsService } = useServices({
    FeatureFlagService,
    MeetingSettingsService,
  });
  const enableEditorSettings = useLiveData(
    featureFlagService.flags.enable_editor_settings.$
  );

  const meetingSettings = useLiveData(meetingSettingsService.settings$);

  return useMemo(() => {
    const settings: GeneralSettingList = [
      {
        key: 'appearance',
        title: t['com.affine.settings.appearance'](),
        icon: <AppearanceIcon />,
        testId: 'appearance-panel-trigger',
      },
      {
        key: 'shortcuts',
        title: t['com.affine.keyboardShortcuts.title'](),
        icon: <KeyboardIcon />,
        testId: 'shortcuts-panel-trigger',
      },
      {
        key: 'ai',
        title: 'AI & models',
        icon: <AiIcon />,
        testId: 'ai-panel-trigger',
      },
    ];
    if (enableEditorSettings) {
      // add editor settings to second position
      settings.splice(1, 0, {
        key: 'editor',
        title: t['com.affine.settings.editorSettings'](),
        icon: <PenIcon />,
        testId: 'editor-panel-trigger',
      });
    }

    if (
      (environment.isMacOs || environment.isWindows) &&
      BUILD_CONFIG.isElectron
    ) {
      settings.push({
        key: 'meetings',
        title: 'Meetings & transcription',
        icon: <MeetingIcon />,
        testId: 'meetings-panel-trigger',
        beta: !meetingSettings?.enabled,
      });
    }

    // Plans and billing tabs disabled — EE backend removed

    if (BUILD_CONFIG.isElectron) {
      settings.push({
        key: 'backup',
        title: t['com.affine.settings.workspace.backup'](),
        icon: <FolderIcon />,
        testId: 'backup-panel-trigger',
      });
    }

    settings.push({
      key: 'about',
      title: t['com.affine.aboutAFFiNE.title'](),
      icon: <InformationIcon />,
      testId: 'about-panel-trigger',
    });
    return settings;
  }, [t, enableEditorSettings, meetingSettings?.enabled]);
};

interface GeneralSettingProps {
  activeTab: SettingTab;
  onChangeSettingState: (settingState: SettingState) => void;
}

export const GeneralSetting = ({ activeTab }: GeneralSettingProps) => {
  switch (activeTab) {
    case 'shortcuts':
      return <Shortcuts />;
    case 'ai':
      return <AISettingsPanel />;
    case 'editor':
      return <EditorSettings />;
    case 'appearance':
      return <AppearanceSettings />;
    case 'meetings':
      return <MeetingsSettings />;
    case 'about':
      return <AboutAffine />;
    case 'backup':
      return <BackupSettingPanel />;
    default:
      return null;
  }
};
