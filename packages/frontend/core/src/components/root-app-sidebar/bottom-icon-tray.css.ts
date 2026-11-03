import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const trayContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px 12px',
});

export const utilityDock = style({
  display: 'grid',
  gridTemplateColumns: '36px 1fr',
  alignItems: 'center',
  gap: 8,
  padding: 4,
  borderRadius: 14,
  background: cssVarV2('layer/background/primary'),
  boxShadow: 'var(--nota-panel-shadow)',
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
  borderRadius: 'var(--nota-control-radius, 8px)',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: cssVarV2('icon/secondary'),
  selectors: {
    '&:hover': {
      color: cssVarV2('icon/primary'),
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-active="true"]': {
      color: 'var(--nota-accent)',
      background: 'var(--nota-sidebar-active)',
    },
  },
});
