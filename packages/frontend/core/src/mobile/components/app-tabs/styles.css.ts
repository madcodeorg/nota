import { createVar, style } from '@vanilla-extract/css';

import { globalVars } from '../../styles/variables.css';

export const appTabsBackground = createVar('appTabsBackground');

export const appTabs = style({
  vars: {
    [appTabsBackground]: 'rgba(18, 19, 16, 0.94)',
  },
  backgroundColor: appTabsBackground,
  borderTop: '1px solid rgba(207, 197, 169, 0.14)',
  boxShadow: '0 -18px 44px rgba(0, 0, 0, 0.28)',
  backdropFilter: 'blur(18px)',

  width: '100dvw',

  zIndex: 1,

  marginBottom: -2,
  selectors: {
    '&[data-fixed="true"]': {
      position: 'fixed',
      bottom: -2,
      marginBottom: 0,
    },
  },
});
export const appTabsInner = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,

  height: `calc(${globalVars.appTabHeight} + 2px)`,
  padding: '12px 14px',
});
export const tabItem = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 0,
  flex: 1,
  height: 36,
  padding: 3,
  borderRadius: 10,
  fontSize: 27,
  color: 'rgba(235, 228, 213, 0.62)',
  lineHeight: 0,
  transition: 'background-color 160ms ease, color 160ms ease',

  selectors: {
    '&[data-active="true"]': {
      background: 'rgba(174, 177, 101, 0.14)',
      color: '#d4ce77',
    },
  },
});
