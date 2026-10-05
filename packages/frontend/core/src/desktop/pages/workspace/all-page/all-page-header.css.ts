import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const header = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '6px 8px',
  borderRadius: 24,
  background:
    'linear-gradient(180deg, rgba(111, 127, 84, 0.1), rgba(111, 127, 84, 0.04)), ' +
    cssVarV2('layer/background/secondary'),
  border: '1px solid rgba(111, 127, 84, 0.16)',
  boxShadow:
    '0 14px 30px rgba(16, 24, 12, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  borderRadius: 22,
  background:
    'linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025))',
  border: '1px solid rgba(111, 127, 84, 0.18)',
  flexShrink: 0,
});

export const viewModeGroup = style({
  display: 'flex',
  alignItems: 'center',
  padding: '0 1px',
  borderRadius: 20,
  borderLeft: '1px solid rgba(111, 127, 84, 0.16)',
  borderRight: '1px solid rgba(111, 127, 84, 0.16)',
});

export const viewToggle = style({
  backgroundColor: 'rgba(111, 127, 84, 0.1)',
  borderRadius: 18,
});
export const viewToggleItem = style({
  padding: 0,
  fontSize: 16,
  width: 32,
  height: 32,
  borderRadius: 14,
  color: cssVarV2.icon.primary,
  selectors: {
    '&[data-state=checked]': {
      color: '#b9c78c',
    },
  },
});

export const newPageButtonLabel = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
  fontSize: '12px',
  color: cssVarV2.text.primary,
  fontWeight: 700,
});

export const displayMenuButton = style({
  width: 32,
  minWidth: 32,
  height: 32,
  padding: 0,
  borderRadius: 15,
});

export const newPageButtonCompact = style({});

globalStyle(`${newPageButtonCompact} button`, {
  height: 32,
  paddingLeft: 8,
  borderRadius: 15,
});

globalStyle(`${newPageButtonCompact} button > span:nth-child(2)`, {
  margin: '0 4px',
  marginRight: 0,
});

globalStyle(`${newPageButtonCompact} button > span:last-child`, {
  paddingLeft: 2,
  paddingRight: 8,
});
