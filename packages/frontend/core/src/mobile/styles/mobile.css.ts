import { globalStyle } from '@vanilla-extract/css';

import { globalVars } from './variables.css';

globalStyle(':root', {
  vars: {
    [globalVars.appTabHeight]: BUILD_CONFIG.isIOS ? '49px' : '62px',
    [globalVars.appTabSafeArea]: `calc(${globalVars.appTabHeight} + env(safe-area-inset-bottom))`,
  },
  userSelect: 'none',
  WebkitUserSelect: 'none',
  background: '#10110f',
});

globalStyle('body', {
  vars: {
    '--affine-background-primary-color': '#151613',
    '--affine-background-secondary-color': '#20211d',
    '--affine-background-tertiary-color': '#292a24',
    '--affine-background-overlay-panel-color': '#1b1c18',
    '--affine-background-kanban-card-color': '#1d1e1a',
    '--affine-hover-color': 'rgba(235, 228, 213, 0.08)',
    '--affine-divider-color': 'rgba(207, 197, 169, 0.16)',
    '--affine-border-color': 'rgba(207, 197, 169, 0.16)',
    '--affine-icon-color': 'rgba(235, 228, 213, 0.72)',
    '--affine-text-primary-color': '#ebe4d5',
    '--affine-text-secondary-color': 'rgba(235, 228, 213, 0.66)',
    '--affine-text-disable-color': 'rgba(235, 228, 213, 0.38)',
    '--affine-white': '#1d1e1a',
    '--affine-white-10': 'rgba(235, 228, 213, 0.08)',
    '--affine-v2-layer-insideBorder-border': 'rgba(207, 197, 169, 0.16)',
    '--affine-v2-layer-insideBorder-primaryBorder': 'rgba(212, 206, 119, 0.34)',
    '--affine-v2-icon-primary': 'rgba(235, 228, 213, 0.72)',
    '--affine-v2-database-textSecondary': 'rgba(235, 228, 213, 0.56)',
  },
  height: 'auto',
  minHeight: '100dvh',
  overflowY: 'unset',
  background: 'linear-gradient(180deg, #171914 0%, #10110f 48%, #0d0d0c 100%)',
  color: '#ebe4d5',
  fontFamily:
    '"SF Pro Display", "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
});
globalStyle('body:has(>#app-tabs):not(:has(affine-keyboard-toolbar))', {
  paddingBottom: globalVars.appTabSafeArea,
});
globalStyle('body:has(affine-keyboard-toolbar)', {
  paddingBottom: `calc(${globalVars.appKeyboardStaticHeight} + 46px)`,
});
globalStyle('body:has(>#app-tabs) edgeless-toolbar-widget', {
  bottom: globalVars.appTabSafeArea,
});

globalStyle('html', {
  height: '100dvh',
  overflowY: 'auto',
  background: '#10110f',
});

globalStyle('a:focus', {
  outline: 'none',
});
globalStyle('button:focus', {
  outline: 'none',
});

globalStyle('body :is(button, a)', {
  WebkitTapHighlightColor: 'transparent',
});
