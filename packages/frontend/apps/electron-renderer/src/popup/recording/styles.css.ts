import { globalStyle, keyframes, style } from '@vanilla-extract/css';

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

const spin = keyframes({
  to: {
    transform: 'rotate(360deg)',
  },
});

export const root = style({
  width: '100%',
  height: '100%',
  ['WebkitAppRegion' as string]: 'drag',
});

export const capsule = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  padding: '6px 7px',
  boxSizing: 'border-box',
  borderRadius: 999,
  background:
    'linear-gradient(135deg, rgba(28, 31, 34, 0.92), rgba(18, 20, 23, 0.88))',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  boxShadow:
    '0 16px 40px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  backdropFilter: 'blur(22px) saturate(1.15)',
});

export const statusGroup = style({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
});

export const iconWrap = style({
  flex: '0 0 auto',
  position: 'relative',
  width: 34,
  height: 34,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'rgba(247, 249, 239, 0.94)',
  background: 'rgba(93, 124, 164, 0.72)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
  selectors: {
    '&[data-state="recording"], &[data-state="create-block-failed"]': {
      background: 'rgba(159, 63, 58, 0.78)',
    },
    '&[data-state="paused"]': {
      background: 'rgba(150, 108, 39, 0.78)',
    },
    '&[data-state="create-block-success"]': {
      background: 'rgba(91, 132, 67, 0.78)',
    },
  },
});

globalStyle(`${iconWrap} svg`, {
  width: 17,
  height: 17,
});

export const statusDot = style({
  position: 'absolute',
  right: 1,
  bottom: 1,
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#8ab4f8',
  border: '2px solid rgba(21, 23, 26, 0.96)',
  boxShadow: '0 0 0 2px rgba(138, 180, 248, 0.16)',
  selectors: {
    '&[data-state="recording"]': {
      background: '#f05252',
      boxShadow: '0 0 0 2px rgba(240, 82, 82, 0.18)',
    },
    '&[data-state="paused"]': {
      background: '#f59e0b',
      boxShadow: '0 0 0 2px rgba(245, 158, 11, 0.18)',
    },
    '&[data-state="stopped"]': {
      background: '#8ab4f8',
      boxShadow: '0 0 0 2px rgba(138, 180, 248, 0.18)',
    },
    '&[data-state="ready"]': {
      background: '#8ab4f8',
      boxShadow: '0 0 0 2px rgba(138, 180, 248, 0.18)',
    },
    '&[data-state="create-block-success"]': {
      background: '#74b816',
      boxShadow: '0 0 0 2px rgba(116, 184, 22, 0.18)',
    },
    '&[data-state="create-block-failed"]': {
      background: '#f05252',
      boxShadow: '0 0 0 2px rgba(240, 82, 82, 0.18)',
    },
  },
});

export const statusCopy = style({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 3,
});

export const statusTitle = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'rgba(250, 251, 247, 0.96)',
  fontSize: 13,
  fontWeight: 680,
  lineHeight: 1,
});

export const statusMeta = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'rgba(220, 226, 218, 0.64)',
  fontSize: 11,
  fontWeight: 560,
  lineHeight: 1,
});

export const controls = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  ['WebkitAppRegion' as string]: 'no-drag',
});

const pillButtonBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 36,
  padding: '0 13px',
  border: '1px solid rgba(204, 223, 149, 0.18)',
  borderRadius: 999,
  color: 'rgba(247, 249, 239, 0.94)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  userSelect: 'none',
  outline: 'none',
  boxShadow:
    '0 10px 22px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  transition:
    'transform 180ms ease, background 180ms ease, border-color 180ms ease, opacity 180ms ease',
  animation: `${controlIn} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both`,
  ['WebkitAppRegion' as string]: 'no-drag',
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

globalStyle(`${controls} button svg`, {
  width: 14,
  height: 14,
});

export const startButton = style({
  ...pillButtonBase,
  minWidth: 82,
  border: '1px solid rgba(158, 206, 255, 0.2)',
  background: 'rgba(52, 92, 128, 0.9)',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      background: 'rgba(61, 108, 150, 0.94)',
      borderColor: 'rgba(158, 206, 255, 0.32)',
    },
  },
});

export const stopButton = style({
  ...pillButtonBase,
  width: 36,
  padding: 0,
  background: 'rgba(118, 59, 55, 0.9)',
  borderColor: 'rgba(255, 165, 150, 0.18)',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      background: 'rgba(132, 65, 60, 0.94)',
    },
  },
});

export const secondaryButton = style({
  ...pillButtonBase,
  width: 36,
  padding: 0,
  background: 'rgba(45, 75, 91, 0.9)',
  borderColor: 'rgba(137, 197, 226, 0.2)',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      background: 'rgba(51, 86, 104, 0.94)',
    },
  },
});

export const doneButton = style({
  ...pillButtonBase,
  minWidth: 82,
  background: 'rgba(111, 127, 84, 0.88)',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      background: 'rgba(123, 142, 90, 0.92)',
      borderColor: 'rgba(204, 223, 149, 0.28)',
    },
  },
});

export const dismissButton = style({
  ...pillButtonBase,
  height: 36,
  padding: '0 10px',
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'rgba(220, 226, 218, 0.72)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  boxShadow: 'none',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.12)',
    },
  },
});

export const errorButton = style({
  ...pillButtonBase,
  height: 36,
  padding: '0 10px',
  background: 'rgba(118, 59, 55, 0.9)',
  borderColor: 'rgba(255, 165, 150, 0.18)',
  boxShadow: 'none',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      background: 'rgba(132, 65, 60, 0.94)',
    },
  },
});

export const processingButton = style({
  ...pillButtonBase,
  minWidth: 96,
  cursor: 'default',
  opacity: 0.86,
  background: 'rgba(111, 127, 84, 0.72)',
  selectors: {
    ...pillButtonBase.selectors,
    '&:hover': {
      transform: 'none',
    },
  },
});

export const spinner = style({
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: '2px solid rgba(247, 249, 239, 0.36)',
  borderTopColor: 'rgba(247, 249, 239, 0.94)',
  animation: `${spin} 900ms linear infinite`,
});
