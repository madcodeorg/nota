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

export const aiPanelSlot = style({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  selectors: {
    '&:empty': {
      display: 'none',
    },
  },
});

export const aiPanelFallback = style({
  padding: '0 6px',
});

globalStyle(`${aiPanelSlot}:not(:empty) + ${aiPanelFallback}`, {
  display: 'none',
});

export const workspaceWrapper = style({
  display: 'flex',
  alignItems: 'center',
  width: 'calc(100% + 12px)',
  height: 42,
  alignSelf: 'center',
});

export const meetingsNewButton = style({
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

export const meetingHistoryRoot = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 0,
});

export const meetingHistoryHeader = style({
  padding: '6px 6px 4px',
});

export const meetingHistoryTitle = style({
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  fontWeight: 650,
  lineHeight: 1.2,
});

export const meetingHistoryCount = style({
  marginTop: 3,
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.2,
});

export const meetingHistoryList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const meetingHistoryItem = style({
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

export const meetingHistoryItemTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.25,
});

export const meetingHistoryItemMeta = style({
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.25,
});

export const meetingHistoryItemLink = style({
  alignSelf: 'flex-start',
  color: cssVar('linkColor'),
  fontSize: 12,
  fontWeight: 560,
  lineHeight: 1.25,
});

export const meetingHistoryEmpty = style({
  padding: '12px 10px',
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.4,
});

export const meetingHistoryMoreButton = style({
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
