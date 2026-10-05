import { DoneIcon, SearchIcon } from '@blocksuite/icons/rc';
import {
  Loading,
  Menu,
  MenuItem,
  type MenuProps,
  MenuSeparator,
  MenuTrigger,
  RadioGroup,
  type RadioItem,
  RowInput,
  Scrollable,
  Slider,
  Switch,
} from '@nota/component';
import { SettingRow, SettingWrapper } from '@nota/component/setting-components';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import {
  type EditorSettingSchema,
  EditorSettingService,
  type FontFamily,
  fontStyleOptions,
} from '@nota/core/modules/editor-setting';
import { SpellCheckSettingService } from '@nota/core/modules/editor-setting/services/spell-check-setting';
import {
  type FontData,
  SystemFontFamilyService,
} from '@nota/core/modules/system-font-family';
import { Trans, useI18n } from '@nota/i18n';
import { useLiveData, useService, useServices } from '@nota/infra';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Virtuoso } from 'react-virtuoso';

import * as styles from './style.css';

const getLabel = (fontKey: FontFamily, t: ReturnType<typeof useI18n>) => {
  switch (fontKey) {
    case 'Sans':
      return t['com.affine.appearanceSettings.fontStyle.sans']();
    case 'Serif':
      return t['com.affine.appearanceSettings.fontStyle.serif']();
    case 'Mono':
      return t[`com.affine.appearanceSettings.fontStyle.mono`]();
    case 'Custom':
      return t['com.affine.settings.editorSettings.edgeless.custom']();
    default:
      return '';
  }
};

export const getBaseFontStyleOptions = (
  t: ReturnType<typeof useI18n>
): Array<Omit<RadioItem, 'value'> & { value: FontFamily }> => {
  return fontStyleOptions
    .map(({ key, value }) => {
      if (key === 'Custom') {
        return null;
      }
      const label = getLabel(key, t);
      return {
        value: key,
        label,
        testId: 'system-font-style-trigger',
        style: {
          fontFamily: value,
        },
      } satisfies RadioItem;
    })
    .filter(item => item !== null);
};

const FontFamilySettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);

  const radioItems = useMemo(() => {
    const items = getBaseFontStyleOptions(t);
    if (!BUILD_CONFIG.isElectron) return items;

    // resolve custom fonts
    const customOption = fontStyleOptions.find(opt => opt.key === 'Custom');
    if (customOption) {
      const fontFamily = settings.customFontFamily
        ? `${settings.customFontFamily}, ${customOption.value}`
        : customOption.value;
      items.push({
        value: customOption.key,
        label: getLabel(customOption.key, t),
        testId: 'system-font-style-trigger',
        style: { fontFamily },
      });
    }

    return items;
  }, [settings.customFontFamily, t]);

  const handleFontFamilyChange = useCallback(
    (value: FontFamily) => {
      editorSettingService.editorSetting.set('fontFamily', value);
    },
    [editorSettingService.editorSetting]
  );

  return (
    <SettingRow
      name={t['com.affine.appearanceSettings.font.title']()}
      desc={t['com.affine.appearanceSettings.font.description']()}
    >
      <RadioGroup
        items={radioItems}
        value={settings.fontFamily}
        width={250}
        className={styles.settingWrapper}
        onChange={handleFontFamilyChange}
      />
    </SettingRow>
  );
};

const getFontFamily = (font: string) => `${font}, ${fontStyleOptions[0].value}`;

const Scroller = forwardRef<
  HTMLDivElement,
  PropsWithChildren<HTMLAttributes<HTMLDivElement>>
>(({ children, ...props }, ref) => {
  return (
    <Scrollable.Root>
      <Scrollable.Viewport {...props} ref={ref}>
        {children}
      </Scrollable.Viewport>
      <Scrollable.Scrollbar />
    </Scrollable.Root>
  );
});

Scroller.displayName = 'Scroller';

const FontMenuItems = ({ onSelect }: { onSelect: (font: string) => void }) => {
  const { systemFontFamilyService, editorSettingService } = useServices({
    SystemFontFamilyService,
    EditorSettingService,
  });
  const systemFontFamily = systemFontFamilyService.systemFontFamily;

  const currentCustomFont = useLiveData(
    editorSettingService.editorSetting.settings$
  ).customFontFamily;
  useEffect(() => {
    if (systemFontFamily.fontList$.value.length === 0) {
      systemFontFamily.loadFontList();
    }
    systemFontFamily.clearSearch();
  }, [systemFontFamily]);

  const isLoading = useLiveData(systemFontFamily.isLoading$);
  const result = useLiveData(systemFontFamily.result$);
  const searchText = useLiveData(systemFontFamily.searchText$);

  const onInputChange = useCallback(
    (value: string) => {
      systemFontFamily.search(value);
    },
    [systemFontFamily]
  );
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation(); // avoid typeahead search built-in in the menu
    },
    []
  );

  return (
    <div>
      <div className={styles.InputContainer}>
        <SearchIcon className={styles.searchIcon} />
        <RowInput
          value={searchText ?? ''}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          autoFocus
          className={styles.searchInput}
          placeholder="Fonts"
        />
      </div>
      <MenuSeparator />
      {isLoading ? (
        <Loading />
      ) : (
        <Scrollable.Root style={{ height: '330px' }}>
          <Scrollable.Viewport>
            {result.length > 0 ? (
              <Virtuoso
                totalCount={result.length}
                components={{
                  Scroller: Scroller,
                }}
                itemContent={index => (
                  <FontMenuItem
                    key={result[index].fullName}
                    font={result[index]}
                    onSelect={onSelect}
                    currentFont={currentCustomFont}
                  />
                )}
              />
            ) : (
              <div className={styles.notFound}>No results found.</div>
            )}
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      )}
    </div>
  );
};

const FontMenuItem = ({
  font,
  currentFont,
  onSelect,
}: {
  font: FontData;
  currentFont: string;
  onSelect: (font: string) => void;
}) => {
  const handleFontSelect = useCallback(
    () => onSelect(font.family),
    [font, onSelect]
  );
  const fontFamily = getFontFamily(font.family);
  const selected = currentFont === font.fullName;

  return (
    <div style={{ marginTop: '4px' }}>
      <MenuItem key={font.fullName} onSelect={handleFontSelect}>
        <div className={styles.fontItemContainer}>
          <div className={styles.fontItem}>
            <div className={styles.fontLabel} style={{ fontFamily }}>
              {font.fullName}
            </div>
            <div className={clsx(styles.fontLabel, 'secondary')}>
              {font.fullName}
            </div>
          </div>

          {selected && (
            <DoneIcon fontSize={20} className={styles.selectedIcon} />
          )}
        </div>
      </MenuItem>
    </div>
  );
};

const CustomFontFamilySettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);

  const fontFamily = getFontFamily(settings.customFontFamily);

  const onCustomFontFamilyChange = useCallback(
    (fontFamily: string) => {
      editorSettingService.editorSetting.set('customFontFamily', fontFamily);
    },
    [editorSettingService.editorSetting]
  );
  if (settings.fontFamily !== 'Custom' || !BUILD_CONFIG.isElectron) {
    return null;
  }
  return (
    <SettingRow
      name={t[
        'com.affine.settings.editorSettings.general.font-family.custom.title'
      ]()}
      desc={t[
        'com.affine.settings.editorSettings.general.font-family.custom.description'
      ]()}
    >
      <Menu
        items={<FontMenuItems onSelect={onCustomFontFamilyChange} />}
        contentOptions={{
          align: 'end',
          style: { width: '250px', height: '380px' },
        }}
      >
        <MenuTrigger className={styles.menuTrigger} style={{ fontFamily }}>
          {settings.customFontFamily || 'Select a font'}
        </MenuTrigger>
      </Menu>
    </SettingRow>
  );
};

const FontSizeSettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);

  const onFontSizeChange = useCallback(
    (fontSize: number[]) => {
      const size = fontSize[0];
      editorSettingService.editorSetting.set('fontSize', size);
      // Update CSS variable immediately
      document.documentElement.style.setProperty(
        '--affine-font-base',
        `${size}px`
      );
    },
    [editorSettingService.editorSetting]
  );

  // Apply current font size to CSS variable on mount
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--affine-font-base',
      `${settings.fontSize}px`
    );
  }, [settings.fontSize]);

  return (
    <SettingRow
      name={t['com.affine.settings.editorSettings.general.font-size.title']()}
      desc={t[
        'com.affine.settings.editorSettings.general.font-size.description'
      ]()}
    >
      <div className={styles.fontSizeContainer}>
        <Slider
          value={[settings.fontSize]}
          onValueChange={onFontSizeChange}
          min={12}
          max={24}
          step={1}
          className={styles.fontSizeSlider}
        />
        <span className={styles.fontSizeValue}>{settings.fontSize}px</span>
      </div>
    </SettingRow>
  );
};

const menuContentOptions: MenuProps['contentOptions'] = {
  align: 'end',
  sideOffset: 16,
  style: { width: 250 },
};
const NewDocDefaultModeSettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);
  const items = useMemo(
    () =>
      [
        {
          value: 'page',
          label: t['Page'](),
          testId: 'page-mode-trigger',
        },
        {
          value: 'edgeless',
          label: t['Edgeless'](),
          testId: 'edgeless-mode-trigger',
        },
        {
          value: 'ask',
          label: t['com.affine.settings.editorSettings.ask-me-every-time'](),
          testId: 'ask-every-time-trigger',
        },
      ] as const,
    [t]
  );
  const updateNewDocDefaultMode = useCallback(
    (value: EditorSettingSchema['newDocDefaultMode']) => {
      editorSettingService.editorSetting.set('newDocDefaultMode', value);
    },
    [editorSettingService.editorSetting]
  );
  return (
    <SettingRow
      name={t[
        'com.affine.settings.editorSettings.general.default-new-doc.title'
      ]()}
      desc={t[
        'com.affine.settings.editorSettings.general.default-new-doc.description'
      ]()}
    >
      <Menu
        contentOptions={menuContentOptions}
        items={items.map(item => {
          return (
            <MenuItem
              key={item.value}
              selected={item.value === settings.newDocDefaultMode}
              onSelect={() => updateNewDocDefaultMode(item.value)}
              data-testid={item.testId}
            >
              {item.label}
            </MenuItem>
          );
        })}
      >
        <MenuTrigger
          className={styles.menuTrigger}
          data-testid="new-doc-default-mode-trigger"
        >
          {items.find(item => item.value === settings.newDocDefaultMode)?.label}
        </MenuTrigger>
      </Menu>
    </SettingRow>
  );
};

const SpellCheckSettings = () => {
  const t = useI18n();
  const spellCheckSetting = useService(SpellCheckSettingService);

  const desktopApiService = useService(DesktopApiService);

  const enabled = useLiveData(spellCheckSetting.enabled$)?.enabled;

  const [requireRestart, setRequireRestart] = useState(false);

  const onToggleSpellCheck = useCallback(
    (checked: boolean) => {
      spellCheckSetting.setEnabled(checked);
      setRequireRestart(true);
    },
    [spellCheckSetting]
  );

  const onRestart = useAsyncCallback(async () => {
    await desktopApiService.handler.ui.restartApp();
  }, [desktopApiService]);

  return (
    <SettingRow
      name={t['com.affine.settings.editorSettings.general.spell-check.title']()}
      desc={
        requireRestart ? (
          <div className={styles.spellCheckSettingDescription}>
            <Trans i18nKey="com.affine.settings.editorSettings.general.spell-check.restart-hint">
              Settings changed; please restart the app.
              <button
                onClick={onRestart}
                className={styles.spellCheckSettingDescriptionButton}
              >
                Restart
              </button>
            </Trans>
          </div>
        ) : (
          t[
            'com.affine.settings.editorSettings.general.spell-check.description'
          ]()
        )
      }
    >
      <Switch checked={enabled} onChange={onToggleSpellCheck} />
    </SettingRow>
  );
};

const MiddleClickPasteSettings = () => {
  const t = useI18n();
  const editorSettingService = useService(EditorSettingService);
  const settings = useLiveData(editorSettingService.editorSetting.settings$);
  const onToggleMiddleClickPaste = useCallback(
    (checked: boolean) => {
      editorSettingService.editorSetting.set('enableMiddleClickPaste', checked);
    },
    [editorSettingService.editorSetting]
  );
  return (
    <SettingRow
      name={t[
        'com.affine.settings.editorSettings.general.middle-click-paste.title'
      ]()}
      desc={t[
        'com.affine.settings.editorSettings.general.middle-click-paste.description'
      ]()}
    >
      <Switch
        checked={settings.enableMiddleClickPaste}
        onChange={onToggleMiddleClickPaste}
      />
    </SettingRow>
  );
};

export const General = () => {
  const t = useI18n();

  return (
    <SettingWrapper title={t['com.affine.settings.editorSettings.general']()}>
      <FontFamilySettings />
      <CustomFontFamilySettings />
      <FontSizeSettings />
      <NewDocDefaultModeSettings />
      {BUILD_CONFIG.isElectron && <SpellCheckSettings />}
      {environment.isLinux && <MiddleClickPasteSettings />}
      {/* // TODO(@akumatus): implement these settings
        <DeFaultCodeBlockSettings />
       */}
    </SettingWrapper>
  );
};
