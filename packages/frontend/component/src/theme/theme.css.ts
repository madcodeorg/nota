import { cssVar } from '@toeverything/theme';
import { globalStyle } from '@vanilla-extract/css';

globalStyle(':root', {
  vars: {
    '--affine-font-family': "'Inter', ui-sans-serif, system-ui, sans-serif",
    '--affine-font-sans-family':
      "'Inter', ui-sans-serif, system-ui, sans-serif",
    '--affine-font-serif-family': "'Lora', Georgia, 'Times New Roman', serif",
    '--affine-font-number-family':
      "'IBM Plex Mono', 'Space Mono', 'Source Code Pro', monospace",
    '--affine-font-code-family':
      "'IBM Plex Mono', 'Space Mono', 'Source Code Pro', monospace",
    '--affine-primary-color': '#6f7f54',
    '--affine-hover-color': 'rgba(111, 127, 84, 0.12)',
    '--affine-hover-color-filled': 'rgba(111, 127, 84, 0.18)',
    '--affine-link-color': '#6f7f54',
  },
});

globalStyle('[data-theme="dark"]', {
  vars: {
    '--affine-primary-color': '#b9c78c',
    '--affine-hover-color': 'rgba(185, 199, 140, 0.12)',
    '--affine-hover-color-filled': 'rgba(185, 199, 140, 0.18)',
    '--affine-link-color': '#c8d690',
  },
});

globalStyle('body', {
  color: cssVar('textPrimaryColor'),
  fontFamily: cssVar('fontFamily'),
  fontSize: cssVar('fontBase'),
  fontFeatureSettings: '"kern" 1, "liga" 1',
});

globalStyle('button, input, textarea, select', {
  fontFamily: cssVar('fontFamily'),
  letterSpacing: 0,
});
