import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const button = style({
  ['WebkitAppRegion' as string]: 'no-drag',
  position: 'fixed',
  top: 48,
  right: 16,
  zIndex: 10,
  height: 26,
  padding: '0 10px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 999,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textSecondaryColor'),
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  opacity: 0.35,
  transition: 'opacity .16s ease',
  selectors: {
    '&:hover, &:focus-visible': { opacity: 1 },
  },
});
