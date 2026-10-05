import { style } from '@vanilla-extract/css';

export const sidebarSwitchClip = style({
  position: 'relative',
  flexShrink: 0,
  overflow: 'hidden',
  transition:
    'max-width 0.2s ease-in-out, margin 0.3s ease-in-out, opacity 0.3s ease',
  selectors: {
    '&[data-show=true]': {
      opacity: 1,
      maxWidth: '60px',
    },
    '&[data-show=false]': {
      opacity: 0,
      maxWidth: 0,
    },
  },
});

export const switchIcon = style({
  transition: 'clip-path 0.3s ease',
  clipPath:
    'path(evenodd, "M 0 0 L 24 0 L 24 24 L 0 24 L 0 0 M19 4.25C19 4.38807 19.1119 4.5 19.25 4.5C19.3881 4.5 19.5 4.38807 19.5 4.25C19.5 4.11193 19.3881 4 19.25 4C19.1119 4 19 4.11193 19 4.25Z")',
});
