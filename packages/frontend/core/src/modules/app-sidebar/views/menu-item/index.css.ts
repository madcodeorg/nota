import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const linkItemRoot = style({
  color: 'inherit',
});
export const root = style({
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '9px',
  textAlign: 'left',
  color: 'inherit',
  width: '100%',
  minHeight: '34px',
  userSelect: 'none',
  cursor: 'pointer',
  padding: '0 8px 0 0',
  fontSize: cssVar('fontSm'),
  marginTop: '5px',
  position: 'relative',
  transition:
    'background-color .16s ease, color .16s ease, box-shadow .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    '&[data-active="true"]': {
      background: 'var(--nota-sidebar-active)',
      color: cssVarV2('text/primary'),
    },
    '&[data-disabled="true"]': {
      cursor: 'default',
      color: cssVarV2.text.disable,
      pointerEvents: 'none',
    },
    // this is not visible in dark mode
    // '&[data-active="true"]:hover': {
    //   background:
    //     // make this a variable?
    //     'linear-gradient(0deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.04)), rgba(0, 0, 0, 0.04)',
    // },
    '&[data-collapsible="true"]': {
      paddingLeft: '6px',
      paddingRight: '8px',
    },
    '&[data-collapsible="false"]:is([data-active="true"], :hover)': {
      paddingLeft: '8px',
      paddingRight: '8px',
    },
    [`${linkItemRoot}:first-of-type &`]: {
      marginTop: '0px',
    },
  },
});
export const content = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  fontWeight: 600,
});
export const postfix = style({
  right: '4px',
  position: 'absolute',
  opacity: 0,
  pointerEvents: 'none',
  selectors: {
    [`${root}:hover &, &[data-postfix-display="always"]`]: {
      justifySelf: 'flex-end',
      position: 'initial',
      opacity: 1,
      pointerEvents: 'all',
    },
  },
});
export const icon = style({
  color: cssVarV2('icon/primary'),
  fontSize: '19px',
  selectors: {
    [`${root}[data-active="true"] &`]: {
      color: 'var(--nota-accent)',
    },
  },
});
export const collapsedIconContainer = style({
  width: '18px',
  height: '18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '9px',
  transition: 'transform 0.2s',
  color: 'inherit',
  selectors: {
    '&[data-collapsed="true"]': {
      transform: 'rotate(-90deg)',
    },
    '&[data-disabled="true"]': {
      opacity: 0.3,
      pointerEvents: 'none',
    },
    '&:hover': {
      background: cssVar('hoverColor'),
    },
  },
});
export const iconsContainer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  width: '36px',
  flexShrink: 0,
  selectors: {
    '&[data-collapsible="true"]': {
      width: '46px',
    },
  },
});
export const collapsedIcon = style({
  transition: 'transform 0.2s ease-in-out',
  selectors: {
    '&[data-collapsed="true"]': {
      transform: 'rotate(-90deg)',
    },
  },
});
export const spacer = style({
  flex: 1,
});
