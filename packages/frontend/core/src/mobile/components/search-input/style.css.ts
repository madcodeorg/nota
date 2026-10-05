import { bodyRegular } from '@toeverything/theme/typography';
import { generateIdentifier, style } from '@vanilla-extract/css';

export const searchVTName = generateIdentifier('mobile-search-input');
export const searchVTScope = generateIdentifier('mobile-search');

export const wrapper = style({
  position: 'relative',
  height: 48,
  borderRadius: 16,
  border: '1px solid rgba(207, 197, 169, 0.14)',
  backgroundColor: 'rgba(235, 228, 213, 0.07)',
  overflow: 'hidden',

  selectors: {
    [`[data-${searchVTScope}] &`]: {
      viewTransitionName: searchVTName,
    },
  },
});

export const prefixIcon = style({
  position: 'absolute',
  width: 36,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'rgba(235, 228, 213, 0.58)',
  pointerEvents: 'none',
});

export const input = style([
  bodyRegular,
  {
    padding: '11px 8px 11px 36px',
    width: '100%',
    height: '100%',
    outline: 'none',
    border: 'none',
    background: 'transparent',
    color: '#ebe4d5',
  },
]);

export const placeholder = style([
  input,
  {
    position: 'absolute',
    left: 0,
    top: 0,
    pointerEvents: 'none',
    color: 'rgba(235, 228, 213, 0.52)',
  },
]);
