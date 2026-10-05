import { cssVar } from '@toeverything/theme';
import { keyframes, style } from '@vanilla-extract/css';

const controlIn = keyframes({
  from: {
    opacity: 0,
    transform: 'translateY(8px) scale(0.96)',
  },
  to: {
    opacity: 1,
    transform: 'translateY(0) scale(1)',
  },
});

const snippetIn = keyframes({
  from: {
    opacity: 0,
    transform: 'translateY(10px)',
  },
  to: {
    opacity: 1,
    transform: 'translateY(0)',
  },
});

export const root = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  width: '100%',
  height: '100%',
  padding: '28px 24px 36px',
  boxSizing: 'border-box',
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  overflowX: 'hidden',
  overflowY: 'auto',
  gap: 18,
  isolation: 'isolate',
  selectors: {
    '&[data-recording="true"]': {
      paddingTop: 24,
    },
  },
  '@media': {
    '(max-width: 860px)': {
      padding: '20px 16px 28px',
    },
  },
});

export const stage = style({
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 18,
  width: 'min(100%, 760px)',
  height: 'auto',
  minHeight: '100%',
  selectors: {
    '&[data-active="true"]': {
      gap: 14,
    },
  },
  '@media': {
    '(max-width: 860px)': {
      width: '100%',
    },
  },
});

export const cover = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'flex-start',
  width: '100%',
  height: 220,
  minHeight: 220,
  padding: 20,
  overflow: 'hidden',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  boxSizing: 'border-box',
  background: '#161814',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
  transition: 'height 220ms ease, min-height 220ms ease, padding 220ms ease',
  selectors: {
    '&[data-started="true"]': {
      height: 84,
      minHeight: 84,
      padding: '12px 16px',
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      pointerEvents: 'none',
      background:
        'linear-gradient(180deg, rgba(5, 7, 5, 0.04) 20%, rgba(5, 7, 5, 0.78) 100%)',
    },
  },
  '@media': {
    '(max-width: 860px)': {
      height: 176,
      minHeight: 176,
      padding: 16,
      selectors: {
        '&[data-started="true"]': {
          height: 76,
          minHeight: 76,
        },
      },
    },
  },
});

export const coverImage = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
});

export const dateStack = style({
  position: 'relative',
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  minWidth: 0,
  textAlign: 'left',
});

export const day = style({
  color: 'rgba(255, 255, 255, 0.78)',
  fontSize: 13,
  fontWeight: 560,
  lineHeight: 1.3,
  textShadow: '0 1px 8px rgba(0, 0, 0, 0.48)',
});

export const date = style({
  overflow: 'hidden',
  color: '#ffffff',
  fontSize: 30,
  fontWeight: 650,
  lineHeight: 1.2,
  textOverflow: 'ellipsis',
  textShadow: '0 2px 14px rgba(0, 0, 0, 0.64)',
  whiteSpace: 'nowrap',
  selectors: {
    [`${cover}[data-started="true"] &`]: {
      fontSize: 22,
    },
  },
});

export const controls = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: 46,
  transform: 'translateY(0)',
  transition: 'opacity 240ms ease',
  selectors: {
    '&[data-busy="true"]': {
      opacity: 0.72,
      pointerEvents: 'none',
    },
  },
});

export const preStartStatus = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: 'min(100%, 620px)',
  minHeight: 28,
  color: cssVar('textSecondaryColor'),
  fontSize: 14,
  fontWeight: 560,
  lineHeight: 1.3,
  animation: `${snippetIn} 220ms ease both`,
});

export const permissionPanel = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  width: 'min(100%, 680px)',
  padding: '12px 14px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  background: cssVar('backgroundSecondaryColor'),
  boxSizing: 'border-box',
  animation: `${snippetIn} 220ms ease both`,
  '@media': {
    '(max-width: 720px)': {
      alignItems: 'stretch',
      flexDirection: 'column',
      gap: 12,
    },
  },
});

export const permissionText = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  lineHeight: 1.35,
});

export const permissionSubtext = style({
  color: cssVar('textSecondaryColor'),
});

export const permissionChecks = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '5px 12px',
  marginTop: 5,
});

export const permissionCheck = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  color: 'rgba(199, 102, 91, 0.96)',
  fontSize: 12,
  lineHeight: '18px',
  selectors: {
    '&[data-ready="true"]': {
      color: 'rgba(90, 138, 85, 0.98)',
    },
  },
});

export const permissionCheckState = style({
  color: cssVar('textSecondaryColor'),
});

export const permissionActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
  flexShrink: 0,
  '@media': {
    '(max-width: 720px)': {
      justifyContent: 'flex-start',
    },
  },
});

export const permissionButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 32,
  minWidth: 104,
  padding: '0 12px',
  border: '1px solid rgba(111, 127, 84, 0.32)',
  borderRadius: 6,
  background: 'rgba(111, 127, 84, 0.88)',
  color: 'rgba(247, 249, 239, 0.96)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 650,
  cursor: 'pointer',
  transition:
    'background 160ms ease, border-color 160ms ease, opacity 160ms ease',
  selectors: {
    '&[data-variant="secondary"]': {
      background: cssVar('backgroundPrimaryColor'),
      borderColor: cssVar('borderColor'),
      color: cssVar('textPrimaryColor'),
    },
    '&:hover': {
      background: 'rgba(123, 142, 90, 0.94)',
    },
    '&[data-variant="secondary"]:hover': {
      background: cssVar('hoverColor'),
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
    },
  },
});

export const calendarPermissionPanel = style([
  permissionPanel,
  {
    alignItems: 'center',
    selectors: {
      '&[data-connected="true"]': {
        borderColor: 'rgba(90, 138, 85, 0.34)',
        background: 'rgba(90, 138, 85, 0.1)',
      },
    },
  },
]);

export const calendarPermissionIcon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  width: 34,
  height: 34,
  borderRadius: 8,
  color: 'rgba(90, 138, 85, 0.96)',
  background: 'rgba(90, 138, 85, 0.14)',
  fontSize: 20,
});

export const calendarPreview = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 'min(100%, 680px)',
  maxHeight: 280,
  padding: '12px 14px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  background: cssVar('backgroundSecondaryColor'),
  boxSizing: 'border-box',
  overflow: 'hidden',
  animation: `${snippetIn} 220ms ease both`,
  '@media': {
    '(max-width: 720px)': {
      maxHeight: 240,
    },
  },
});

export const calendarPreviewHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 22,
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  fontWeight: 650,
});

export const calendarPreviewCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 20,
  height: 20,
  padding: '0 6px',
  marginLeft: 'auto',
  borderRadius: 999,
  background: 'rgba(90, 138, 85, 0.14)',
  color: cssVar('textPrimaryColor'),
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
});

export const calendarEventList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minHeight: 0,
  overflowY: 'auto',
  scrollbarWidth: 'thin',
});

export const calendarPreviewStatus = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: 48,
  padding: '8px 10px',
  color: cssVar('textSecondaryColor'),
  fontSize: 13,
  lineHeight: 1.4,
  selectors: {
    '&[data-error="true"]': {
      color: 'rgba(199, 102, 91, 0.96)',
    },
  },
});

export const calendarEventRow = style({
  display: 'grid',
  gridTemplateColumns: '94px minmax(0, 1fr)',
  gap: 10,
  flex: '0 0 auto',
  minHeight: 44,
  padding: '7px 10px',
  borderLeft: '3px solid',
  borderTop: `1px solid ${cssVar('borderColor')}`,
  borderRight: `1px solid ${cssVar('borderColor')}`,
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 6,
  background: cssVar('backgroundPrimaryColor'),
  boxSizing: 'border-box',
  '@media': {
    '(max-width: 720px)': {
      gridTemplateColumns: '78px minmax(0, 1fr)',
      gap: 8,
    },
  },
});

export const calendarEventTime = style({
  minWidth: 0,
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 620,
  lineHeight: '18px',
});

export const calendarEventBody = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const calendarEventMetaRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});

export const calendarEventTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  fontWeight: 620,
  lineHeight: '18px',
});

export const calendarEventMeta = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: '18px',
});

export const calendarEventLink = style({
  flex: '0 0 auto',
  width: 'fit-content',
  color: 'rgba(90, 138, 85, 0.98)',
  fontSize: 12,
  fontWeight: 650,
  lineHeight: '18px',
  textDecoration: 'none',
  selectors: {
    '&:hover': {
      textDecoration: 'underline',
    },
  },
});

export const calendarPreviewMore = style({
  padding: '2px 4px',
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: '18px',
});

export const snippetLayer = style({
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  flex: '1 1 auto',
  width: 'min(100%, 760px)',
  minHeight: 0,
  overflow: 'hidden',
  pointerEvents: 'auto',
  opacity: 0,
  transform: 'translateY(12px)',
  transition: 'opacity 260ms ease, transform 260ms ease',
  selectors: {
    '&[data-visible="true"]': {
      opacity: 1,
      transform: 'translateY(0)',
    },
  },
  '@media': {
    '(max-width: 860px)': {
      width: '100%',
    },
  },
});

export const recordingStatus = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  alignSelf: 'flex-start',
  minHeight: 24,
  color: 'rgba(255, 255, 255, 0.92)',
  fontSize: 14,
  fontWeight: 560,
  lineHeight: 1,
  textShadow: '0 2px 12px rgba(0, 0, 0, 0.42)',
  animation: `${snippetIn} 260ms ease both`,
  selectors: {
    '[data-theme="light"] &': {
      color: cssVar('textPrimaryColor'),
      textShadow: 'none',
    },
  },
  '@media': {
    '(max-width: 860px)': {
      fontSize: 13,
    },
  },
});

export const recordingOnlyStatus = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  flex: '1 1 auto',
  minHeight: 220,
  color: 'rgba(255, 255, 255, 0.92)',
  fontSize: 22,
  fontWeight: 560,
  lineHeight: 1,
  textShadow: '0 2px 12px rgba(0, 0, 0, 0.42)',
  animation: `${snippetIn} 320ms ease both`,
  selectors: {
    '[data-theme="light"] &': {
      color: cssVar('textPrimaryColor'),
      textShadow: 'none',
    },
  },
  '@media': {
    '(max-width: 860px)': {
      minHeight: 150,
      fontSize: 18,
    },
  },
});

export const processingStatus = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  minHeight: 52,
  color: 'rgba(255, 255, 255, 0.84)',
  fontSize: 17,
  fontWeight: 540,
  textShadow: '0 2px 12px rgba(0, 0, 0, 0.42)',
  animation: `${snippetIn} 260ms ease both`,
  selectors: {
    '[data-theme="light"] &': {
      color: cssVar('textSecondaryColor'),
      textShadow: 'none',
    },
  },
});

export const recordingDot = style({
  flex: '0 0 auto',
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#f05252',
});

export const recordingTime = style({
  selectors: {
    [`${recordingStatus} &`]: {
      marginLeft: 0,
    },
    [`${recordingStatus} &::before`]: {
      content: '"•"',
      display: 'inline-block',
      marginRight: 6,
    },
  },
});

export const snippetList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '4px 2px 20px',
  boxSizing: 'border-box',
  scrollbarWidth: 'thin',
});

export const snippetRow = style({
  display: 'grid',
  gridTemplateColumns: '92px minmax(0, 1fr)',
  columnGap: 14,
  alignItems: 'start',
  width: '100%',
  animation: `${snippetIn} 260ms ease both`,
  selectors: {
    '&[data-type="partial"]': {
      opacity: 0.72,
    },
  },
  '@media': {
    '(max-width: 860px)': {
      gridTemplateColumns: '76px minmax(0, 1fr)',
      columnGap: 10,
    },
  },
});

export const snippetTime = style({
  display: 'block',
  padding: '8px 0 6px',
  color: 'rgba(255, 255, 255, 0.58)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 620,
  lineHeight: 1.2,
  textAlign: 'right',
  textShadow: '0 2px 10px rgba(0, 0, 0, 0.46)',
  whiteSpace: 'nowrap',
  selectors: {
    [`${snippetRow}[data-type="partial"] &`]: {
      color: 'rgba(255, 255, 255, 0.44)',
    },
    '[data-theme="light"] &': {
      color: cssVar('textSecondaryColor'),
      textShadow: 'none',
    },
    [`[data-theme="light"] ${snippetRow}[data-type="partial"] &`]: {
      color: cssVar('textSecondaryColor'),
    },
  },
  '@media': {
    '(max-width: 860px)': {
      fontSize: 11,
    },
  },
});

export const snippet = style({
  display: 'block',
  minWidth: 0,
  minHeight: 0,
  padding: '6px 0',
  boxSizing: 'border-box',
  color: 'rgba(255, 255, 255, 0.96)',
  fontSize: 18,
  fontWeight: 500,
  lineHeight: 1.45,
  textShadow: '0 2px 14px rgba(0, 0, 0, 0.5)',
  selectors: {
    [`${snippetRow}[data-type="partial"] &`]: {
      color: 'rgba(255, 255, 255, 0.72)',
      fontStyle: 'italic',
    },
    '[data-theme="light"] &': {
      color: cssVar('textPrimaryColor'),
      textShadow: 'none',
    },
    [`[data-theme="light"] ${snippetRow}[data-type="partial"] &`]: {
      color: cssVar('textSecondaryColor'),
    },
  },
  '@media': {
    '(max-width: 860px)': {
      fontSize: 16,
    },
  },
});

export const listeningLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 28,
  color: 'rgba(255, 255, 255, 0.78)',
  fontSize: 16,
  fontWeight: 500,
  textShadow: '0 2px 12px rgba(0, 0, 0, 0.42)',
  selectors: {
    '[data-theme="light"] &': {
      color: cssVar('textSecondaryColor'),
      textShadow: 'none',
    },
  },
});

export const listeningDot = style({
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#8ab4f8',
});

const pillButtonBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 42,
  minWidth: 112,
  padding: '0 18px',
  border: '1px solid rgba(204, 223, 149, 0.18)',
  borderRadius: 999,
  color: 'rgba(247, 249, 239, 0.94)',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 650,
  lineHeight: '42px',
  cursor: 'pointer',
  userSelect: 'none',
  outline: 'none',
  boxShadow:
    '0 14px 28px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  transition:
    'transform 180ms ease, background 180ms ease, border-color 180ms ease, opacity 180ms ease',
  selectors: {
    '&:hover': {
      transform: 'translateY(-1px)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
      transform: 'none',
    },
  },
} as const;

export const startButton = style({
  ...pillButtonBase,
  background: 'rgba(111, 127, 84, 0.88)',
  selectors: {
    '&:hover': {
      transform: 'translateY(-1px)',
      background: 'rgba(123, 142, 90, 0.92)',
      borderColor: 'rgba(204, 223, 149, 0.28)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
      transform: 'none',
    },
  },
});

export const summaryButton = style({
  ...pillButtonBase,
  background: 'rgba(45, 75, 91, 0.9)',
  borderColor: 'rgba(137, 197, 226, 0.2)',
  selectors: {
    '&:hover': {
      transform: 'translateY(-1px)',
      background: 'rgba(51, 86, 104, 0.94)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
      transform: 'none',
    },
  },
});

export const saveButton = style({
  ...pillButtonBase,
  background: 'rgba(111, 127, 84, 0.92)',
  selectors: {
    '&:hover': {
      transform: 'translateY(-1px)',
      background: 'rgba(123, 142, 90, 0.96)',
      borderColor: 'rgba(204, 223, 149, 0.3)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
      transform: 'none',
    },
  },
});

export const controlButton = style({
  ...pillButtonBase,
  animation: `${controlIn} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both`,
  selectors: {
    '&[data-variant="stop"]': {
      background: 'rgba(118, 59, 55, 0.9)',
      borderColor: 'rgba(255, 165, 150, 0.18)',
    },
    '&[data-variant="pause"]': {
      background: 'rgba(45, 75, 91, 0.9)',
      borderColor: 'rgba(137, 197, 226, 0.2)',
      animationDelay: '70ms',
    },
    '&[data-variant="stop"]:hover': {
      transform: 'translateY(-1px)',
      background: 'rgba(132, 65, 60, 0.94)',
    },
    '&[data-variant="pause"]:hover': {
      transform: 'translateY(-1px)',
      background: 'rgba(51, 86, 104, 0.94)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
      transform: 'none',
    },
  },
});

export const errorText = style({
  maxWidth: 620,
  color: 'rgba(255, 165, 150, 0.88)',
  fontSize: 12,
  lineHeight: 1.4,
  textAlign: 'center',
  selectors: {
    '[data-theme="light"] &': {
      color: cssVar('errorColor'),
    },
  },
});
