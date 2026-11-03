import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, style } from '@vanilla-extract/css';

export const tabOverlayWidth = createVar('0px');
export const tabButtonWidth = createVar('16px');
export const tabMaxWidth = createVar('200px');

export const root = style({
  width: '100%',
  // Matches the 40px header slot so the tab sits centered with room below.
  height: '40px',
  display: 'flex',
  alignItems: 'center',
  flexDirection: 'row',
  gap: '8px',
  overflow: 'clip',
  pointerEvents: 'auto',
  color: cssVarV2('text/primary'),
  ['WebkitAppRegion' as string]: 'drag',
  selectors: {
    '&[data-is-windows="false"]': {
      paddingRight: 8,
    },
  },
});

export const headerLeft = style({
  display: 'flex',
  flexFlow: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingRight: 8,
  gap: 6,
  flexShrink: 0,
  selectors: {
    [`${root}[data-mode="app"] &`]: {
      transition: 'all 0.3s',
    },
  },
});

export const tabs = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  paddingLeft: 8,
  overflow: 'hidden',
  height: '100%',
  selectors: {
    '&[data-pinned="true"]': {
      flexShrink: 0,
    },
  },
});

export const pinSeparator = style({
  background: cssVarV2('tab/divider/divider'),
  width: 1,
  height: 16,
  flexShrink: 0,
  marginRight: 8,
});

export const splitViewSeparator = style({
  background: cssVarV2('tab/divider/divider'),
  width: 1,
  height: '100%',
  flexShrink: 0,
});

export const tabWrapper = style({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  padding: '0 6px',
  margin: '0 -6px',
});

export const tab = style({
  height: 26,
  minWidth: 38,
  maxWidth: tabMaxWidth,
  width: 200,
  overflow: 'clip',
  background: cssVarV2('tab/tabBackground/default'),
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  color: cssVarV2('tab/fontColor/default'),
  userSelect: 'none',
  borderRadius: 8,
  border: '1px solid transparent',
  transition: 'background-color .14s ease, box-shadow .14s ease',
  position: 'relative',
  ['WebkitAppRegion' as string]: 'no-drag',
  selectors: {
    [`${tabWrapper} &`]: {
      marginRight: 8,
    },
    '&:hover': {
      background: cssVarV2('tab/tabBackground/hover'),
    },
    '&[data-active="true"]': {
      background: cssVarV2('tab/tabBackground/active'),
      boxShadow: 'var(--nota-panel-shadow)',
    },
    [`${tabWrapper}[data-dragging="true"] &`]: {
      boxShadow: `0 0 0 1px ${cssVar('primaryColor')}`,
    },
  },
});

export const splitViewLabel = style({
  minWidth: 48,
  padding: '0 10px',
  height: '100%',
  display: 'flex',
  gap: '4px',
  fontWeight: 500,
  alignItems: 'center',
  cursor: 'default',
  flex: 1,
  borderRadius: 8,
  selectors: {
    '&[data-active="true"]': {
      background: cssVarV2('tab/tabBackground/active'),
    },
  },
});

export const tabCloseButtonWrapper = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  height: '100%',
  width: 14,
  overflow: 'clip',
  display: 'flex',
  alignItems: 'center',
  paddingRight: 6,
  justifyContent: 'flex-end',
  selectors: {
    [`${tab}:is([data-active=true], :hover) &:not(:empty)`]: {
      width: 48,
    },
    [`${splitViewLabel}:last-of-type[data-active=true] + &`]: {
      background: `linear-gradient(270deg, ${cssVarV2('tab/tabBackground/active')} 50%, rgba(255, 255, 255, 0.00) 100%)`,
    },
    [`${splitViewLabel}:last-of-type[data-active=false] + &`]: {
      background: `linear-gradient(270deg, ${cssVarV2('tab/tabBackground/default')} 65.71%, rgba(244, 244, 245, 0.00) 100%)`,
    },
  },
});

export const tabIcon = style({
  color: cssVarV2('tab/iconColor/default'),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const labelIcon = style([
  tabIcon,
  {
    width: 16,
    height: 16,
    fontSize: 16,
    flexShrink: 0,
    selectors: {
      [`${splitViewLabel}[data-active=true] &`]: {
        color: cssVarV2('tab/iconColor/active'),
      },
      [`${splitViewLabel}[data-active=false]:hover &, ${tab}:has(${tabCloseButtonWrapper}:hover) ${splitViewLabel}:last-of-type &`]:
        {
          color: cssVarV2('tab/iconColor/hover'),
        },
    },
  },
]);

export const tabCloseButton = style([
  tabIcon,
  {
    pointerEvents: 'auto',
    width: 16,
    height: 16,
    borderRadius: 999,
    display: 'none',
    color: cssVarV2('tab/iconColor/default'),
    selectors: {
      [`${tab}:is([data-active=true], :hover) &`]: {
        display: 'flex',
      },
      '&:hover': {
        color: cssVarV2('tab/iconColor/hover'),
        background: cssVarV2('layer/background/hoverOverlay'),
      },
    },
  },
]);

export const splitViewLabelText = style({
  minWidth: 0,
  textOverflow: 'ellipsis',
  overflow: 'clip',
  whiteSpace: 'nowrap',
  color: cssVarV2('tab/fontColor/default'),
  fontSize: cssVar('fontSm'),
  paddingRight: 4,
  fontWeight: 650,
  selectors: {
    [`${splitViewLabel}:hover &, ${tab}:has(${tabCloseButtonWrapper}:hover) ${splitViewLabel}:last-of-type &`]:
      {
        color: cssVarV2('tab/fontColor/hover'),
      },
    [`${splitViewLabel}[data-active="true"] &`]: {
      color: cssVarV2('tab/fontColor/active'),
    },
    [`${splitViewLabel}:last-of-type &`]: {
      textOverflow: 'clip',
    },
    [`${splitViewLabel}:last-of-type [data-padding-right="true"]&`]: {
      paddingRight: 32,
    },
  },
});

export const spacer = style({
  flexGrow: 1,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  marginLeft: -8,
  position: 'relative',
  selectors: {
    '&[data-dragged-over=true]:after': {
      content: '""',
      position: 'absolute',
      top: 7,
      height: 26,
      left: -5,
      right: 0,
      width: 2,
      borderRadius: 2,
      background: cssVar('primaryColor'),
    },
  },
});

export const windowsAppControlsPlaceholder = style({
  width: '120px',
  height: '100%',
  flexShrink: 0,
});

export const dropIndicator = style({
  position: 'absolute',
  height: 26,
  top: 7,
  width: 2,
  borderRadius: 2,
  opacity: 0,
  background: cssVar('primaryColor'),
  selectors: {
    '&[data-edge="left"]': {
      opacity: 1,
      transform: 'translateX(-5px)',
    },
    '&[data-edge="right"]': {
      right: 0,
      opacity: 1,
      transform: 'translateX(-9px)',
    },
  },
});
