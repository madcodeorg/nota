import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const trayContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px 12px',
  borderTop: '1px solid rgba(204, 223, 149, 0.08)',
  background:
    'linear-gradient(180deg, transparent, rgba(4, 6, 6, 0.16) 38%, rgba(4, 6, 6, 0.28))',
  selectors: {
    '[data-theme="light"] &': {
      borderTop: '1px solid rgba(111, 127, 84, 0.14)',
      background:
        'linear-gradient(180deg, transparent, rgba(111, 127, 84, 0.055) 42%, rgba(111, 127, 84, 0.095))',
    },
  },
});

export const utilityDock = style({
  display: 'grid',
  gridTemplateColumns: '36px 1fr',
  alignItems: 'center',
  gap: 8,
  padding: 4,
  borderRadius: 18,
  background: 'rgba(8, 11, 10, 0.54)',
  border: '1px solid rgba(204, 223, 149, 0.09)',
  boxShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.055), 0 8px 22px rgba(0, 0, 0, 0.14)',
  selectors: {
    '[data-theme="light"] &': {
      background: 'rgba(255, 255, 250, 0.74)',
      border: '1px solid rgba(111, 127, 84, 0.16)',
      boxShadow:
        'inset 0 1px 0 rgba(255, 255, 255, 0.82), 0 8px 20px rgba(79, 94, 62, 0.08)',
    },
  },
});

export const avatarSection = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const utilityActions = style({
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(28px, 1fr)',
  alignItems: 'center',
  gap: 4,
});

export const utilityIconButton = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
  width: '100%',
  height: 30,
  borderRadius: 12,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: cssVarV2('icon/secondary'),
  selectors: {
    '&:hover': {
      color: cssVarV2('icon/primary'),
      background: 'rgba(255, 255, 255, 0.06)',
    },
    '[data-theme="light"] &:hover': {
      background: 'rgba(111, 127, 84, 0.1)',
    },
    '&[data-active="true"]': {
      color: cssVarV2('button/primary'),
      background: 'rgba(111, 127, 84, 0.15)',
    },
  },
});
