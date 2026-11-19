import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const breadcrumbs = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
  maxWidth: '45%',
  overflow: 'hidden',
  color: cssVarV2('text/secondary'),
  fontSize: 13,
  lineHeight: '20px',
  '@container': {
    'detail-page-header (width <= 460px)': {
      display: 'none',
    },
  },
});

export const crumb = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  maxWidth: 160,
  padding: '2px 6px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: cssVarV2('text/secondary'),
  fontSize: 13,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const crumbButton = style([
  crumb,
  {
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        backgroundColor: cssVarV2('layer/background/hoverOverlay'),
        color: cssVarV2('text/primary'),
      },
      '&:focus-visible': {
        outline: `2px solid ${cssVarV2('button/primary')}`,
        outlineOffset: -1,
      },
    },
  },
]);

export const crumbLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const crumbIcon = style({
  flexShrink: 0,
  opacity: 0.72,
});

export const separator = style({
  flexShrink: 0,
  color: cssVarV2('text/tertiary'),
  userSelect: 'none',
  padding: '0 1px',
});
