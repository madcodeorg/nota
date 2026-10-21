import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const shell = style({
  display: 'flex',
  flex: '1 1 auto',
  minHeight: 0,
  margin: '0 -8px -8px',
});

export const rail = style({
  flex: '0 0 52px',
  width: 52,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '56px 0 10px',
  borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: {
    '&[data-electron="true"]': {
      padding: '6px 0 10px',
    },
  },
});

export const railGroup = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
});

export const railButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  padding: 0,
  border: 0,
  borderRadius: 10,
  background: 'transparent',
  color: cssVarV2('icon/secondary'),
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: cssVarV2('icon/primary'),
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-active="true"]': {
      color: cssVarV2('icon/primary'),
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const railDivider = style({
  width: 20,
  height: 1,
  margin: '6px 0',
  background: cssVarV2('layer/insideBorder/border'),
});

export const railAvatar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 6,
});

export const panel = style({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  rowGap: 6,
  padding: '0 8px 8px',
});

export const pagePanel = style({
  height: '100%',
  minHeight: 0,
});
globalStyle(`${pagePanel} [data-testid="right-sidebar-close"]`, {
  display: 'none',
});

export const panelGroup = style({
  display: 'flex',
  flexDirection: 'column',
  marginTop: 8,
});

export const panelGroupLabel = style({
  padding: '6px 2px',
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '16px',
});

export const aiPanelHost = style({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  selectors: {
    '&[data-hidden="true"]': {
      display: 'none',
    },
  },
});

export const aiPanel = style({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const aiPanelFallback = style({
  padding: '0 6px',
});

export const workspaceWrapper = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  width: 'calc(100% + 12px)',
  height: 42,
  paddingRight: 14,
  alignSelf: 'center',
});

globalStyle(`${workspaceWrapper} > :first-child`, {
  flex: 1,
  minWidth: 0,
});

export const historyNewButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: cssVar('textSecondaryColor'),
  cursor: 'pointer',
  padding: 0,
  selectors: {
    '&:hover': {
      background: 'rgba(111, 127, 84, 0.14)',
      color: cssVar('textPrimaryColor'),
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.5,
    },
  },
});

export const historyRoot = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 0,
});

export const historyHeader = style({
  padding: '6px 6px 4px',
});

export const historyTitle = style({
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  fontWeight: 650,
  lineHeight: 1.2,
});

export const historyCount = style({
  marginTop: 3,
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.2,
});

export const historyList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const historyItem = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 4,
  width: '100%',
  minHeight: 66,
  padding: '10px',
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'transparent',
  color: cssVar('textPrimaryColor'),
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    '&[data-selected="true"]': {
      background: cssVar('backgroundPrimaryColor'),
      borderColor: cssVar('borderColor'),
    },
  },
});

export const historyItemTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.25,
});

export const historyItemMeta = style({
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.25,
});

export const historyItemLink = style({
  alignSelf: 'flex-start',
  color: cssVar('linkColor'),
  fontSize: 12,
  fontWeight: 560,
  lineHeight: 1.25,
});

export const historyEmpty = style({
  padding: '12px 10px',
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.4,
});

export const historyMoreButton = style({
  height: 34,
  margin: '6px 4px 0',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 560,
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
  },
});

export const searchBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  height: 32,
  margin: '2px 0 6px',
  padding: '0 6px 0 10px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/tertiary'),
  fontSize: 13,
  cursor: 'pointer',
  transition: 'border-color .12s ease, color .12s ease',
  selectors: {
    '&:hover': {
      color: cssVarV2('text/secondary'),
      borderColor: cssVarV2('layer/insideBorder/blackBorder'),
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('layer/insideBorder/primaryBorder')}`,
      outlineOffset: 1,
    },
  },
});

export const searchBarIcon = style({
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
});

export const searchBarLabel = style({
  flex: 1,
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const searchBarShortcut = style({
  flexShrink: 0,
  padding: '1px 5px',
  borderRadius: 4,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('text/tertiary'),
  fontFamily: 'inherit',
  fontSize: 11,
  lineHeight: '16px',
});
