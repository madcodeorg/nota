import { style } from '@vanilla-extract/css';

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  margin: 0,
  padding: '8px 12px 24px',
  color: '#ebe4d5',
});
export const item = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 56,
  padding: '12px 10px',
  borderRadius: 10,
  color: '#ebe4d5',
  textDecoration: 'none',
  transition: 'background-color 160ms ease',
  ':visited': { color: '#ebe4d5' },
  ':hover': { color: '#ebe4d5' },
  ':active': {
    color: '#ebe4d5',
    background: 'rgba(235, 228, 213, 0.08)',
  },
  ':focus': { color: '#ebe4d5' },

  selectors: {
    '&:not(:last-child)': {
      borderBottom: `0.5px solid rgba(207, 197, 169, 0.14)`,
    },
  },
});
export const content = style({
  width: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#ebe4d5',
  fontSize: 15,
  fontWeight: 650,
});

export const prefixIcon = style({
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ':before': {
    content: '""',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'currentColor',
  },
});
export const suffixIcon = style({
  padding: 0,
  fontSize: 24,
  color: 'rgba(235, 228, 213, 0.72)',
});
