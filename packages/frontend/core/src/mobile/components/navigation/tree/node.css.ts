import { cssVar } from '@toeverything/theme';
import { bodyRegular } from '@toeverything/theme/typography';
import { createVar, style } from '@vanilla-extract/css';

export const levelIndent = createVar();

export const itemRoot = style({
  display: 'inline-flex',
  alignItems: 'center',
  textAlign: 'left',
  color: 'inherit',
  width: '100%',
  minHeight: '30px',
  userSelect: 'none',
  cursor: 'pointer',
  fontSize: cssVar('fontSm'),
  position: 'relative',
  marginTop: '6px',
  padding: '10px 12px',
  borderRadius: 14,
  gap: 12,
  background: 'rgba(235, 228, 213, 0.045)',
  border: '1px solid rgba(207, 197, 169, 0.08)',
  selectors: {
    '&[data-disabled="true"]': {
      cursor: 'default',
      color: cssVar('textSecondaryColor'),
      pointerEvents: 'none',
    },
    '&[data-dragging="true"]': {
      opacity: 0.5,
    },
  },

  ':after': {
    content: '',
    display: 'none',
  },
});

export const collapsedIconContainer = style({
  width: '16px',
  height: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '2px',
  transition: 'transform 0.2s',
  color: 'rgba(235, 228, 213, 0.62)',
  fontSize: 16,
  selectors: {
    '&[data-collapsed="true"]': {
      transform: 'rotate(-90deg)',
    },
    '&[data-disabled="true"]': {
      opacity: 0.3,
      pointerEvents: 'none',
    },
  },
});
export const collapsedIcon = style({
  transition: 'transform 0.2s ease-in-out',
  selectors: {
    '&[data-collapsed="true"]': {
      transform: 'rotate(-90deg)',
    },
  },
});

export const itemMain = style({
  display: 'flex',
  alignItems: 'center',
  width: 0,
  flex: 1,
  position: 'relative',
  gap: 12,
});

export const iconContainer = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  color: '#aeb165',

  width: 32,
  height: 32,
  fontSize: 24,
});

export const itemContent = style([
  bodyRegular,
  {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    alignItems: 'center',
    flex: 1,
    color: '#ebe4d5',
    letterSpacing: '0',
  },
]);

export const itemRenameAnchor = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  top: -10,
  width: 10,
  height: 10,
});

export const contentContainer = style({
  marginTop: 0,
  paddingLeft: levelIndent,
  position: 'relative',
});

export const linkItemRoot = style({
  color: 'inherit',
});

export const collapseContentPlaceholder = style({
  display: 'none',
  selectors: {
    '&:only-child': {
      display: 'initial',
    },
  },
});
