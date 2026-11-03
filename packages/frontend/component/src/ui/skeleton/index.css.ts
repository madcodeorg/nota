import { cssVar } from '@toeverything/theme';
import { keyframes, style } from '@vanilla-extract/css';

const bg = `var(--nota-skeleton-base, color-mix(in srgb, ${cssVar('placeholderColor')} 30%, transparent))`;
const highlight = 'var(--nota-skeleton-highlight, rgba(255, 255, 255, 0.4))';
const defaultHeight = '32px';
const reducedMotion = '(prefers-reduced-motion: reduce)';

const pulseKeyframes = keyframes({
  '0%': {
    opacity: 1,
  },
  '50%': {
    opacity: 0.5,
  },
  '100%': {
    opacity: 1,
  },
});
const waveKeyframes = keyframes({
  '0%': {
    transform: 'translateX(-100%)',
  },
  '100%': {
    transform: 'translateX(100%)',
  },
});
export const root = style({
  display: 'block',
  width: '100%',
  maxWidth: '100%',
  height: defaultHeight,
  flexShrink: 0,
  position: 'relative',
  '::before': {
    content: '',
    position: 'absolute',
    borderRadius: 'inherit',
    inset: 0,
    backgroundColor: bg,
  },
});
export const variant = {
  circular: style({
    width: defaultHeight,
    borderRadius: '50%',
  }),
  rectangular: style({
    borderRadius: '8px',
  }),
  rounded: style({
    borderRadius: 'var(--nota-row-radius, 10px)',
  }),
  text: style({
    borderRadius: '6px',
    height: '1.2em',
    marginTop: '0.2em',
    marginBottom: '0.2em',
  }),
};
export const animation = {
  pulse: style({
    animation: `${pulseKeyframes} 2s ease-in-out 0.5s infinite`,
    '@media': {
      [reducedMotion]: {
        animation: 'none',
      },
    },
  }),
  wave: style({
    position: 'relative',
    overflow: 'hidden',
    /* Fix bug in Safari https://bugs.webkit.org/show_bug.cgi?id=68196 */
    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
    '::after': {
      animation: `${waveKeyframes} 1.4s ease-in-out infinite`,
      background: `linear-gradient(
        90deg,
        transparent,
        ${highlight},
        transparent
      )`,
      content: '',
      position: 'absolute',
      transform:
        'translateX(-100%)' /* Avoid flash during server-side hydration */,
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    },
    '@media': {
      [reducedMotion]: {
        '::after': {
          display: 'none',
        },
      },
    },
  }),
};
