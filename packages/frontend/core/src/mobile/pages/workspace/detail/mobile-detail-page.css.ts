import { cssVar } from '@toeverything/theme';
import { bodyEmphasized } from '@toeverything/theme/typography';
import { globalStyle, style } from '@vanilla-extract/css';

const mobileEditorThemeVars = {
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
};

export const root = style({
  background: 'linear-gradient(180deg, #171914 0%, #10110f 52%, #0d0d0c 100%)',
  color: '#ebe4d5',
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
});

export const header = style({
  background:
    'linear-gradient(180deg, rgba(23, 25, 20, 0.98), rgba(16, 17, 15, 0.94))',
  color: '#ebe4d5',
  position: 'fixed',
  top: 0,
  zIndex: 1,
});

export const headerContent = style({
  maxWidth: `calc(100% - 200px)`,
});
export const headerTitle = style([
  bodyEmphasized,
  {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',

    opacity: 0,
    transition: 'opacity 0.23s ease',
    color: '#ebe4d5',
    selectors: {
      '&[data-show="true"]': {
        opacity: 1,
      },
    },
  },
]);

export const mainContainer = style({
  containerType: 'inline-size',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
  borderTop: `0.5px solid transparent`,
  transition: 'border-color 0.2s',
  selectors: {
    '&[data-dynamic-top-border="false"]': {
      borderColor: cssVar('borderColor'),
    },
    '&[data-has-scroll-top="true"]': {
      borderColor: cssVar('borderColor'),
    },
  },
});

export const editorContainer = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  zIndex: 0,
});
// brings styles of .affine-page-viewport from blocksuite
export const affineDocViewport = style({
  vars: mobileEditorThemeVars,
  display: 'flex',
  flexDirection: 'column',
  containerName: 'viewport',
  containerType: 'inline-size',
  background: 'linear-gradient(180deg, #171914 0%, #10110f 52%, #0d0d0c 100%)',
  color: '#ebe4d5',
  selectors: {
    '&[data-mode="edgeless"]': {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
  },
});

export const errorBoundary = style({
  flex: 1,
});

export const scrollbar = style({
  marginRight: '4px',
});

globalStyle('.doc-title-container', {
  fontSize: cssVar('fontH1'),
  '@container': {
    [`viewport (width <= 640px)`]: {
      padding: '10px 16px',
      lineHeight: '38px',
    },
  },
});

globalStyle('[data-peek-view-wrapper] .doc-title-container', {
  fontSize: cssVar('fontH6'),
});

globalStyle('.affine-page-root-block-container', {
  '@container': {
    [`viewport (width <= 640px)`]: {
      paddingLeft: 16,
      paddingRight: 16,
    },
  },
});

export const journalIconButton = style({
  position: 'absolute',
  zIndex: 1,
  top: 16,
  right: 12,
  display: 'flex',
});

export const journalDatePicker = style({
  background: '#10110f',
});

globalStyle(`${affineDocViewport} .affine-page-root-block-container`, {
  vars: mobileEditorThemeVars,
  color: '#ebe4d5',
});

globalStyle(`${affineDocViewport} .affine-paragraph`, {
  color: '#ebe4d5',
});

globalStyle(`${affineDocViewport} .affine-divider`, {
  borderColor: 'rgba(207, 197, 169, 0.16)',
});

globalStyle(
  `${affineDocViewport} :is(.page-editor-container, editor-host, affine-page-root, affine-note, .affine-note-block-container, .affine-block-children-container, affine-database, affine-data-view)`,
  {
    vars: mobileEditorThemeVars,
  }
);

globalStyle(`${affineDocViewport} :is(affine-database, affine-data-view)`, {
  backgroundColor: '#151613',
  color: '#ebe4d5',
});
