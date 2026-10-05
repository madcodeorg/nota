import { createVar, style } from '@vanilla-extract/css';

const headerHeight = createVar('headerHeight');
const wsSelectorHeight = createVar('wsSelectorHeight');
const searchHeight = createVar('searchHeight');

export const root = style({
  vars: {
    [headerHeight]: '44px',
    [wsSelectorHeight]: '48px',
    [searchHeight]: '44px',
  },
  width: '100dvw',
  color: '#ebe4d5',
});
export const headerSettingRow = style({
  minHeight: 54,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  padding: '10px 16px 4px',
});
export const wsSelectorAndSearch = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '4px 16px 18px 16px',
});
export const brand = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  color: '#ebe4d5',
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: '0.01em',
});
export const brandMark = style({
  width: 20,
  height: 20,
  borderRadius: 6,
  background: 'linear-gradient(145deg, #aeb165, #6f7844)',
  border: '1px solid rgba(235, 228, 213, 0.18)',
  boxShadow: '0 10px 24px rgba(89, 93, 43, 0.34)',
  position: 'relative',
  ':after': {
    content: '',
    position: 'absolute',
    inset: 5,
    borderRadius: 3,
    border: '1px solid rgba(16, 17, 15, 0.44)',
  },
});
export const headerActions = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});
export const iconButton = style({
  color: 'rgba(235, 228, 213, 0.78)',
  borderRadius: 10,
  transition: 'background-color 160ms ease, color 160ms ease',
  ':active': {
    background: 'rgba(235, 228, 213, 0.08)',
    color: '#d4ce77',
  },
});
export const float = style({
  position: 'fixed',
  top: 0,
  width: '100%',
  zIndex: 2,

  display: 'flex',
  alignItems: 'center',
  padding: '8px 10px 8px 16px',
  gap: 10,

  // visibility control
  background: 'transparent',
  selectors: {
    '&.dense': {
      background: 'rgba(18, 19, 16, 0.92)',
      borderBottom: '1px solid rgba(207, 197, 169, 0.12)',
      backdropFilter: 'blur(18px)',
    },
  },
});
export const floatWsSelector = style({
  width: 0,
  flex: 1,
  visibility: 'hidden',
  pointerEvents: 'none',
  selectors: {
    [`${float}.dense &`]: {
      visibility: 'visible',
      pointerEvents: 'auto',
    },
  },
});
