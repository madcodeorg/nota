import { Menu, MenuItem, MenuTrigger } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';

import * as styles from './style.css';

export type AzureApiMode = 'responses' | 'chat' | 'deepseek';
const labels: Record<AzureApiMode, string> = {
  responses: 'Responses',
  chat: 'Chat Completions',
  deepseek: 'DeepSeek',
};

export function AzureApiFormat({
  value = 'responses',
  disabled,
  onChange,
}: {
  value?: AzureApiMode;
  disabled: boolean;
  onChange: (value: AzureApiMode) => void;
}) {
  return (
    <SettingRow
      name="API format"
      desc="Choose the API supported by your Azure deployment."
    >
      <Menu
        items={(Object.keys(labels) as AzureApiMode[]).map(mode => (
          <MenuItem
            key={mode}
            selected={mode === value}
            disabled={disabled}
            onSelect={() => onChange(mode)}
          >
            {labels[mode]}
          </MenuItem>
        ))}
      >
        <MenuTrigger
          className={styles.menuTrigger}
          disabled={disabled}
          aria-label="API format"
        >
          {labels[value]}
        </MenuTrigger>
      </Menu>
    </SettingRow>
  );
}
