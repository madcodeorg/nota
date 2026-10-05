import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';
export const settingSlideBar = style({
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
  width: '27%',
  maxWidth: '264px',
  minWidth: '220px',
  background: cssVarV2('layer/background/secondary'),
  borderRight: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  padding: '22px 14px 12px',
  height: '100%',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      left: '50%',
      bottom: '-160px',
      zIndex: -1,
      width: '320px',
      height: '320px',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
      background:
        'radial-gradient(circle at 50% 50%, rgba(111, 127, 84, 0.16), transparent 68%)',
      filter: 'blur(8px)',
    },
    '[data-theme="dark"] &::after': {
      background:
        'radial-gradient(circle at 50% 50%, rgba(185, 199, 140, 0.12), transparent 68%)',
    },
  },
});
export const brandHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '2px 8px 4px',
});
export const brandLogo = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '34px',
  height: '34px',
  flexShrink: 0,
  borderRadius: '10px',
  fontSize: '18px',
  color: cssVar('primaryColor'),
  background: cssVar('hoverColorFilled'),
});
export const sidebarTitle = style({
  fontSize: cssVar('fontH5'),
  fontWeight: 600,
  lineHeight: '28px',
  letterSpacing: '-0.01em',
  color: cssVarV2('text/primary'),
});
export const navScroll = style({
  flex: 1,
  minHeight: 0,
});
export const sidebarSubtitle = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  lineHeight: '16px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: cssVarV2('text/secondary'),
  padding: '8px 10px 4px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
});
export const sidebarItemsWrapper = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});
export const sidebarSelectItem = style({
  position: 'relative',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  padding: '7px 10px',
  minHeight: '34px',
  flexShrink: 0,
  fontSize: cssVar('fontSm'),
  fontFamily: 'inherit',
  textAlign: 'left',
  color: cssVarV2('text/primary'),
  border: 0,
  background: 'transparent',
  outline: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background 0.16s ease, color 0.16s ease',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: '3px',
      top: '50%',
      width: '3px',
      height: '16px',
      borderRadius: '3px',
      background: cssVar('primaryColor'),
      transform: 'translateY(-50%) scaleY(0.4)',
      opacity: 0,
      transition: 'opacity 0.16s ease, transform 0.16s ease',
    },
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${cssVar('primaryColor')}`,
    },
    '&.active': {
      background: cssVar('hoverColor'),
    },
    '&.active::before': {
      opacity: 1,
      transform: 'translateY(-50%) scaleY(1)',
    },
  },
});
export const sidebarSelectSubItem = style({
  display: 'flex',
  alignItems: 'center',
  margin: '0px 16px',
  padding: '0px 8px 0px 32px',
  height: '30px',
  flexShrink: 0,
  fontSize: cssVar('fontSm'),
  borderRadius: '8px',
  cursor: 'pointer',
  userSelect: 'none',
  color: cssVar('textSecondaryColor'),
  selectors: {
    '&.active, &:hover': {
      color: cssVar('textPrimaryColor'),
    },
  },
});

export const sidebarSelectItemIcon = style({
  width: '16px',
  height: '16px',
  fontSize: '16px',
  marginRight: '10px',
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
  display: 'inline-flex',
  transition: 'color 0.16s ease',
});
globalStyle(`${sidebarSelectItem}:hover ${sidebarSelectItemIcon}`, {
  color: cssVarV2('icon/primary'),
});
globalStyle(`${sidebarSelectItem}.active ${sidebarSelectItemIcon}`, {
  color: cssVar('primaryColor'),
});

export const sidebarSelectItemName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexGrow: 1,
});
globalStyle(`${sidebarSelectItem}.active ${sidebarSelectItemName}`, {
  fontWeight: 600,
});

export const sidebarSelectItemBeta = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVar('primaryColor'),
  background: cssVar('hoverColorFilled'),
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 8px',
  borderRadius: '6px',
  transform: 'translateX(2px)',
});

export const currentWorkspaceLabel = style({
  width: '20px',
  height: '20px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  selectors: {
    '&::after': {
      content: '""',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: cssVar('blue'),
    },
  },
});

export const sidebarGroup = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  marginBottom: '8px',
});

export const accountButton = style({
  width: '100%',
  padding: '10px',
  borderRadius: '12px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontFamily: 'inherit',
  textAlign: 'left',
  outline: 'none',
  cursor: 'pointer',
  userSelect: 'none',
  display: 'flex',
  columnGap: '10px',
  justifyContent: 'space-between',
  alignItems: 'center',
  transition: 'background 0.16s ease, border-color 0.16s ease',
  ':hover': {
    background: cssVar('hoverColor'),
  },
  selectors: {
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${cssVar('primaryColor')}`,
    },
    '&.active': {
      background: cssVar('hoverColor'),
      borderColor: cssVar('primaryColor'),
    },
  },
});
globalStyle(`${accountButton} .avatar`, {
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  fontSize: '20px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  flexShrink: 0,
});
globalStyle(`${accountButton} .avatar.not-sign`, {
  color: cssVar('primaryColor'),
  background: cssVar('hoverColorFilled'),
  paddingBottom: '2px',
});
globalStyle(`${accountButton} .content`, {
  flexGrow: '1',
  minWidth: 0,
});
globalStyle(`${accountButton} .name-container`, {
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  width: '100%',
  gap: '4px',
  height: '22px',
});
globalStyle(`${accountButton} .name`, {
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  height: '22px',
});
globalStyle(`${accountButton} .email`, {
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexGrow: 1,
  height: '20px',
});
