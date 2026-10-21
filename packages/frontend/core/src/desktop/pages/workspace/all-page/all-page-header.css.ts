import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const header = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '0 4px',
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
});

export const viewModeGroup = style({
  display: 'flex',
  alignItems: 'center',
});

export const viewToggle = style({
  backgroundColor: 'transparent',
});
export const viewToggleItem = style({
  padding: 0,
  fontSize: 16,
  width: 32,
  height: 32,
  borderRadius: 6,
  color: cssVarV2.icon.primary,
  selectors: {
    '&[data-state=checked]': {
      color: cssVarV2.text.primary,
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
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
  width: 28,
  minWidth: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
  padding: 0,
  borderRadius: 6,
});

export const newPageButtonCompact = style({});

globalStyle(`${newPageButtonCompact} button`, {
  height: 28,
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
  paddingLeft: 8,
  borderRadius: 6,
});

globalStyle(`${newPageButtonCompact} button > span:nth-child(2)`, {
  margin: '0 4px',
  marginRight: 0,
});

globalStyle(`${newPageButtonCompact} button > span:last-child`, {
  paddingLeft: 2,
  paddingRight: 8,
});
