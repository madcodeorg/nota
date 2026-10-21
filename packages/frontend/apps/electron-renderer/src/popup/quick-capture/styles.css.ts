import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

const accent = '#6f7f54';

export const root = style({
  width: '100%',
  height: '100%',
  padding: 8,
  boxSizing: 'border-box',
  userSelect: 'text',
});

export const card = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px 10px',
  boxSizing: 'border-box',
  borderRadius: 14,
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  boxShadow: '0 18px 48px rgba(0, 0, 0, 0.22)',
});

export const header = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  ['WebkitAppRegion' as string]: 'drag',
});

export const title = style({
  fontSize: 13,
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const hint = style({
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const input = style({
  flex: 1,
  width: '100%',
  resize: 'none',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: cssVarV2('text/primary'),
  fontFamily: 'inherit',
  fontSize: 15,
  lineHeight: 1.5,
  '::placeholder': {
    color: cssVarV2('text/placeholder'),
  },
});

export const footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

export const keys = style({
  fontSize: 11,
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const saveButton = style({
  flexShrink: 0,
  height: 26,
  padding: '0 12px',
  border: 'none',
  borderRadius: 999,
  background: accent,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': { background: '#5f6e47' },
    '&:disabled': { opacity: 0.45, cursor: 'default' },
  },
});
