import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  width: '100%',
  height: '100%',
  display: 'block',
  borderRadius: 22,
  outlineOffset: 3,
  selectors: {
    '&:focus-visible': {
      outline: '2px solid rgba(185, 199, 140, 0.72)',
    },
  },
});

export const dragPreview = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px 10px 14px',
  background: cssVarV2.layer.background.primary,
  borderRadius: 18,
  border: '1px solid rgba(111, 127, 84, 0.18)',
  fontSize: 14,
  boxShadow: '0 14px 34px rgba(16, 24, 12, 0.18)',
});
export const dragPreviewIcon = style({
  fontSize: 24,
});

export const listViewRoot = style({
  padding: '0px 12px',
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  borderRadius: 18,
  overflow: 'hidden',
  background: 'rgba(111, 127, 84, 0.06)',
  border: '1px solid transparent',
  boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04)',
  transition:
    'background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease',
  containerName: 'list-view-root',
  containerType: 'size',
  selectors: {
    '&:hover': {
      backgroundColor: 'rgba(111, 127, 84, 0.14)',
      borderColor: 'rgba(111, 127, 84, 0.22)',
      boxShadow: '0 10px 24px rgba(16, 24, 12, 0.12)',
      transform: 'translateY(-1px)',
    },
    [`${root}[data-selected="true"] &`]: {
      backgroundColor: 'rgba(111, 127, 84, 0.18)',
      borderColor: 'rgba(111, 127, 84, 0.36)',
    },
  },
});

export const dragHandle = style({
  position: 'absolute',
  padding: '5px 2px',
  color: cssVarV2.icon.secondary,
});
export const listDragHandle = style([
  dragHandle,
  {
    left: -4,
    top: '50%',
    transform: 'translateY(-50%) translateX(-100%)',
    opacity: 0,
    selectors: {
      [`${listViewRoot}:hover &`]: {
        opacity: 1,
      },
    },
  },
]);
export const listSelect = style({
  width: 0,
  height: 24,
  fontSize: 20,
  padding: 2,
  // to make sure won't take place when hidden
  // 12 = gap + padding * 2
  marginLeft: -12,
  flexShrink: 0,
  display: 'flex',
  color: cssVarV2.icon.primary,
  overflow: 'hidden',
  alignItems: 'center',
  justifyContent: 'end',
  transition: 'width 0.25s ease, margin-left 0.25s ease',
  // when select mode is on, the whole item can be clicked,
  // the selection will be handled by the parent, the checkbox here just for the visual effect
  pointerEvents: 'none',
  selectors: {
    '&[data-select-mode="true"]': {
      width: 24,
      marginLeft: 0,
    },
  },
});

export const listIcon = style({
  width: 34,
  height: 34,
  fontSize: 20,
  color: '#b9c78c',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  borderRadius: 14,
  background: 'rgba(111, 127, 84, 0.14)',
  boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.18)',
});
export const listContent = style({
  width: 0,
  height: '100%',
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'space-between',
});
export const listBrief = style({
  height: '100%',
  flexShrink: 10,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  marginLeft: 2,
  minWidth: 200,
});
export const listSpace = style({
  width: 0,
  flex: 1,
});
// export const listDetails = style({
//   display: 'flex',
//   gap: 8,
//   alignItems: 'center',
//   flexShrink: 1,
//   minWidth: 0,
//   justifyContent: 'flex-end',
// });
const ellipsis = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const listTitle = style([
  ellipsis,
  {
    fontSize: 14,
    lineHeight: '22px',
    fontWeight: 650,
    color: cssVarV2.text.primary,
  },
]);
export const listPreview = style([
  ellipsis,
  {
    fontSize: 12,
    lineHeight: '20px',
    fontWeight: 400,
    color: cssVarV2.text.secondary,
  },
]);

export const listQuickActions = style({
  display: 'flex',
  gap: 4,
  padding: 3,
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.035)',
  boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.1)',
  flexShrink: 0,
  selectors: {
    [`${listViewRoot}:hover &`]: {
      background: 'rgba(111, 127, 84, 0.1)',
      boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.18)',
    },
  },
});

export const listHide750 = style({
  '@container': {
    'list-view-root (width <= 750px)': {
      display: 'none',
    },
  },
});

export const listHide560 = style({
  '@container': {
    'list-view-root (width <= 560px)': {
      display: 'none',
    },
  },
});

// --- card view ---
export const cardViewRoot = style({
  vars: {
    '--ring-color': 'transparent',
    '--light-shadow':
      '0px 0px 0px 1px var(--ring-color), 0px 10px 28px rgba(16,24,12,.08)',
    '--dark-shadow':
      '0px 0px 0px 1px var(--ring-color), 0px 10px 28px rgba(0,0,0,.22)',
    '--light-shadow-hover':
      '0px 0px 0px 1px var(--ring-color), 0px 16px 40px rgba(16,24,12,.14)',
    '--dark-shadow-hover':
      '0px 0px 0px 1px var(--ring-color), 0px 16px 40px rgba(0,0,0,.32)',
  },
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 18,
  borderRadius: 28,
  background: BUILD_CONFIG.isMobileEdition
    ? 'linear-gradient(180deg, rgba(34, 35, 30, 0.98), rgba(21, 22, 19, 0.98))'
    : 'linear-gradient(180deg, rgba(111, 127, 84, 0.12), rgba(111, 127, 84, 0.04)), ' +
      cssVarV2.layer.background.mobile.secondary,
  border: '1px solid rgba(111, 127, 84, 0.18)',
  // TODO: use variable
  boxShadow:
    '0px 0px 0px 1px var(--ring-color), 0px 10px 28px rgba(16,24,12,.1)',
  overflow: 'hidden',
  transition:
    'box-shadow 0.23s ease, border-color 0.23s ease, transform .18s ease, background-color .18s ease',
  selectors: {
    [`${root}[data-selected="true"] &`]: {
      vars: {
        '--ring-color': 'rgba(111, 127, 84, 0.5)',
      },
    },
    '&:hover': {
      borderColor: 'rgba(111, 127, 84, 0.36)',
      transform: 'translateY(-2px)',
    },
    '[data-theme="light"] &': {
      boxShadow: 'var(--light-shadow)',
    },
    '[data-theme="light"] &:hover': {
      boxShadow: 'var(--light-shadow-hover)',
    },
    '[data-theme="dark"] &': {
      boxShadow: 'var(--dark-shadow)',
    },
    '[data-theme="dark"] &:hover': {
      boxShadow: 'var(--dark-shadow-hover)',
    },
  },
});
export const cardViewHeader = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
export const cardViewIcon = style({
  width: 40,
  height: 40,
  fontSize: 22,
  color: '#b9c78c',
  lineHeight: 0,
  borderRadius: 18,
  background: 'rgba(111, 127, 84, 0.14)',
  boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.18)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});
export const cardViewTitle = style({
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 700,
  color: BUILD_CONFIG.isMobileEdition ? '#ebe4d5' : cssVarV2.text.primary,
  letterSpacing: 0,
  width: 0,
  flexGrow: 1,
  flexShrink: 1,
  textOverflow: 'ellipsis',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});
export const cardViewActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 3,
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.035)',
  boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.1)',
  flexShrink: 0,
  selectors: {
    [`${cardViewRoot}:hover &`]: {
      background: 'rgba(111, 127, 84, 0.1)',
      boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.18)',
    },
  },
});
export const cardPreviewContainer = style({
  width: '100%',
  fontSize: 12,
  lineHeight: '20px',
  fontWeight: 400,
  color: BUILD_CONFIG.isMobileEdition
    ? 'rgba(235, 228, 213, 0.66)'
    : cssVarV2.text.primary,
  minHeight: 20,
  flexGrow: 1,
  flexShrink: 1,
  overflow: 'hidden',
});
export const cardViewCheckbox = style({
  width: 20,
  height: 20,
  fontSize: 16,
  padding: 2,
  color: cssVarV2.icon.primary,
  pointerEvents: 'none',
});
export const cardDragHandle = style([
  dragHandle,
  {
    left: -4,
    top: 0,
    transform: 'translateX(-100%)',
    opacity: 0,
    selectors: {
      [`${cardViewRoot}:hover &`]: {
        opacity: 1,
      },
    },
  },
]);
