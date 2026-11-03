import { cssVar } from '@toeverything/theme';
import { globalStyle } from '@vanilla-extract/css';

import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_COLOR,
  FRAME_BACKGROUND,
} from './brand';

// Nota palette "Graphite Coral". AFFiNE's v1 (--affine-*) and v2
// (--affine-v2-*) tokens are both overridden because components use either set.
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
    '--affine-popover-radius': '12px',
    '--nota-panel-radius': '16px',
    '--nota-row-radius': '10px',
    '--nota-control-radius': '8px',
    '--nota-accent-light': ACCENT_PRESETS[DEFAULT_ACCENT_COLOR].light,
    '--nota-accent-dark': ACCENT_PRESETS[DEFAULT_ACCENT_COLOR].dark,
  },
});

// The accent setting writes data-accent on <html>; each theme block below
// picks the light or dark value, so every accent token follows the setting.
for (const [name, preset] of Object.entries(ACCENT_PRESETS)) {
  globalStyle(`:root[data-accent="${name}"]`, {
    vars: {
      '--nota-accent-light': preset.light,
      '--nota-accent-dark': preset.dark,
    },
  });
}

globalStyle('[data-theme="light"]', {
  vars: {
    // The frame regions also set data-theme="dark" so their text and icons
    // turn light.
    '--nota-frame-background': FRAME_BACKGROUND.light,
    '--nota-accent': 'var(--nota-accent-light)',
    '--nota-solid-background': '#18181b',
    '--nota-solid-background-hover': '#2c2c31',
    '--nota-solid-text': '#ffffff',
    '--nota-row-background': '#f4f4f5',
    '--nota-sidebar-active': 'rgba(24, 24, 27, 0.07)',
    '--nota-skeleton-base': '#ebebed',
    '--nota-skeleton-highlight': '#f6f6f7',
    '--nota-panel-shadow':
      '0 1px 2px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.05)',

    '--affine-primary-color': 'var(--nota-accent)',
    '--affine-brand-color': 'var(--nota-accent)',
    '--affine-text-emphasis-color': 'var(--nota-accent)',
    '--affine-link-color': '#2f5aa8',
    '--affine-hover-color': 'rgba(24, 24, 27, 0.05)',
    '--affine-hover-color-filled': '#f4f4f5',
    '--affine-background-primary-color': '#ffffff',
    '--affine-background-secondary-color': '#f4f4f5',
    '--affine-background-tertiary-color': '#ebebed',
    '--affine-background-overlay-panel-color': '#ffffff',
    '--affine-text-primary-color': '#18181b',
    '--affine-text-secondary-color': '#77777d',
    '--affine-text-disable-color': '#a8a8ad',
    '--affine-placeholder-color': '#a8a8ad',
    '--affine-icon-color': '#6b6b72',
    '--affine-icon-secondary': 'rgba(107, 107, 114, 0.6)',
    '--affine-border-color': '#e7e7ea',
    '--affine-divider-color': '#e7e7ea',

    '--affine-v2-button-primary': 'var(--nota-accent)',
    '--affine-v2-button-checkBox': '#18181b',
    '--affine-v2-button-actionActive':
      'color-mix(in srgb, var(--nota-accent) 8%, transparent)',
    '--affine-v2-icon-activated': 'var(--nota-accent)',
    '--affine-v2-icon-primary': '#6b6b72',
    '--affine-v2-icon-secondary': '#a8a8ad',
    '--affine-v2-icon-tertiary': '#c9c9cd',
    '--affine-v2-input-border-active': '#18181b',
    '--affine-v2-layer-insideBorder-border': '#e7e7ea',
    '--affine-v2-layer-insideBorder-primaryBorder': '#18181b',
    '--affine-v2-layer-background-primary': '#ffffff',
    '--affine-v2-layer-background-secondary': '#f4f4f5',
    '--affine-v2-layer-background-tertiary': '#ebebed',
    '--affine-v2-layer-background-overlayPanel': '#ffffff',
    '--affine-v2-layer-background-hoverOverlay': 'rgba(24, 24, 27, 0.05)',
    '--affine-v2-text-primary': '#18181b',
    '--affine-v2-text-secondary': '#77777d',
    '--affine-v2-text-tertiary': '#a1a1a6',
    '--affine-v2-text-placeholder': '#a8a8ad',
    '--affine-v2-text-emphasis': 'var(--nota-accent)',
    '--affine-v2-text-link': '#2f5aa8',
    '--affine-v2-tab-divider-indicator': 'var(--nota-accent)',
    '--affine-v2-tab-tabBackground-default': 'transparent',
    '--affine-v2-tab-tabBackground-hover': 'rgba(24, 24, 27, 0.05)',
    '--affine-v2-tab-tabBackground-active': '#ffffff',
    '--affine-v2-switch-switchBackground-background': '#ebebed',
  },
});

globalStyle('[data-theme="dark"]', {
  vars: {
    '--nota-frame-background': FRAME_BACKGROUND.dark,
    '--nota-accent': 'var(--nota-accent-dark)',
    '--nota-solid-background': '#f4f4f5',
    '--nota-solid-background-hover': '#dcdce0',
    '--nota-solid-text': '#18181b',
    '--nota-row-background': '#212124',
    '--nota-sidebar-active': 'rgba(255, 255, 255, 0.08)',
    '--nota-skeleton-base': '#29292d',
    '--nota-skeleton-highlight': '#323237',
    '--nota-panel-shadow': '0 0 0 1px rgba(255, 255, 255, 0.05)',

    '--affine-primary-color': 'var(--nota-accent)',
    '--affine-brand-color': 'var(--nota-accent)',
    '--affine-text-emphasis-color': 'var(--nota-accent)',
    '--affine-link-color': '#9dbaf5',
    '--affine-hover-color': 'rgba(255, 255, 255, 0.06)',
    '--affine-hover-color-filled': '#232326',
    '--affine-background-primary-color': '#18181a',
    '--affine-background-secondary-color': '#212124',
    '--affine-background-tertiary-color': '#29292d',
    '--affine-background-overlay-panel-color': '#1f1f22',
    '--affine-text-primary-color': '#ececee',
    '--affine-text-secondary-color': '#8d8d93',
    '--affine-text-disable-color': '#5c5c62',
    '--affine-placeholder-color': '#5c5c62',
    '--affine-icon-color': '#a1a1a8',
    '--affine-icon-secondary': 'rgba(161, 161, 168, 0.6)',
    '--affine-border-color': '#2a2a2e',
    '--affine-divider-color': '#2a2a2e',

    '--affine-v2-button-primary': 'var(--nota-accent)',
    '--affine-v2-button-checkBox': '#ececee',
    '--affine-v2-button-actionActive':
      'color-mix(in srgb, var(--nota-accent) 12%, transparent)',
    '--affine-v2-icon-activated': 'var(--nota-accent)',
    '--affine-v2-icon-primary': '#a1a1a8',
    '--affine-v2-icon-secondary': '#6e6e74',
    '--affine-v2-icon-tertiary': '#4a4a50',
    '--affine-v2-input-border-active': '#ececee',
    '--affine-v2-layer-insideBorder-border': '#2a2a2e',
    '--affine-v2-layer-insideBorder-primaryBorder': '#ececee',
    '--affine-v2-layer-background-primary': '#18181a',
    '--affine-v2-layer-background-secondary': '#212124',
    '--affine-v2-layer-background-tertiary': '#29292d',
    '--affine-v2-layer-background-overlayPanel': '#1f1f22',
    '--affine-v2-layer-background-hoverOverlay': 'rgba(255, 255, 255, 0.06)',
    '--affine-v2-text-primary': '#ececee',
    '--affine-v2-text-secondary': '#8d8d93',
    '--affine-v2-text-tertiary': '#6e6e74',
    '--affine-v2-text-placeholder': '#5c5c62',
    '--affine-v2-text-emphasis': 'var(--nota-accent)',
    '--affine-v2-text-link': '#9dbaf5',
    '--affine-v2-tab-divider-indicator': 'var(--nota-accent)',
    '--affine-v2-tab-tabBackground-default': 'transparent',
    '--affine-v2-tab-tabBackground-hover': 'rgba(255, 255, 255, 0.06)',
    '--affine-v2-tab-tabBackground-active': '#18181a',
    '--affine-v2-switch-switchBackground-background': '#29292d',
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
