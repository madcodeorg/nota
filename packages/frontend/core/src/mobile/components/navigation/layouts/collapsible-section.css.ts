import { cssVar } from '@toeverything/theme';
import { headlineRegular } from '@toeverything/theme/typography';
import { style } from '@vanilla-extract/css';

// content
export const content = style({
  paddingTop: 8,
});

// trigger
export const triggerRoot = style({
  fontSize: cssVar('fontXs'),
  height: 25,
  width: '100%',
  userSelect: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  borderRadius: 4,
});
export const triggerLabel = style([
  headlineRegular,
  {
    flexGrow: '0',
    display: 'flex',
    gap: 2,
    alignItems: 'center',
    justifyContent: 'start',
    color: 'rgba(235, 228, 213, 0.72)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
]);
export const triggerCollapseIcon = style({
  vars: { '--y': '1px', '--r': '90deg' },
  color: 'rgba(235, 228, 213, 0.42)',
  transform: 'translateY(var(--y)) rotate(var(--r))',
  transition: 'transform 0.2s',
  selectors: {
    [`${triggerRoot}[data-collapsed="true"] &`]: {
      vars: { '--r': '0deg' },
    },
  },
});
export const triggerActions = style({
  display: 'flex',
  gap: 8,
});
