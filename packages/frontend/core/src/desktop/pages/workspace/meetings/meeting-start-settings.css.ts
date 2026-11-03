import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const root = style({
  position: 'relative',
  display: 'inline-flex',
});

export const trigger = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 42,
  height: 42,
  padding: 0,
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 999,
  background: 'var(--nota-row-background)',
  color: cssVar('textPrimaryColor'),
  fontSize: 18,
  cursor: 'pointer',
  outline: 'none',
  transition: 'background 160ms ease, opacity 160ms ease',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColorFilled'),
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
    },
  },
});

export const warningDot = style({
  position: 'absolute',
  top: 4,
  right: 4,
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: '#e0a030',
  border: `2px solid ${cssVar('backgroundPrimaryColor')}`,
});

export const panel = style({
  position: 'absolute',
  bottom: 'calc(100% + 12px)',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: 340,
  padding: 16,
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 14,
  background: cssVar('backgroundOverlayPanelColor'),
  boxShadow: cssVar('menuShadow'),
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  lineHeight: 1.4,
  textAlign: 'left',
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const label = style({
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  fontWeight: 600,
});

export const select = style({
  width: '100%',
  height: 32,
  padding: '0 8px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
  selectors: {
    '&:disabled': {
      opacity: 0.58,
    },
  },
});

export const hint = style({
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
});

export const warning = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid #e0a030',
  borderRadius: 8,
  color: cssVar('textPrimaryColor'),
  fontSize: 12,
});

export const actionButton = style({
  height: 28,
  padding: '0 12px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColorFilled'),
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.58,
    },
  },
});
