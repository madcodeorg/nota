import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const linkItemRoot = style({
  color: 'inherit',
});
export const root = style({
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '12px',
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
  ':before': {
    content: '""',
    position: 'absolute',
    left: '4px',
    width: '3px',
    height: '16px',
    borderRadius: '999px',
    opacity: 0,
    background: '#6f7f54',
    transition: 'opacity .16s ease',
  },
  selectors: {
    '&:hover': {
      background: 'rgba(111, 127, 84, 0.11)',
      boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.12)',
    },
    '&[data-active="true"]': {
      background: 'rgba(111, 127, 84, 0.17)',
      color: cssVarV2('text/primary'),
      boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.18)',
    },
    '&[data-active="true"]::before': {
      opacity: 1,
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
      color: '#6f7f54',
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
      background: 'rgba(111, 127, 84, 0.14)',
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
