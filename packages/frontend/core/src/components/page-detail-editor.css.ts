import { globalStyle, style } from '@vanilla-extract/css';
export const editor = style({
  flex: 1,
  selectors: {
    '&.full-screen': {
      width: '100%',
      minWidth: 0,
      vars: {
        '--affine-editor-width': '100%',
        '--affine-editor-side-padding': '72px',
      },
    },
    '&.small-text': {
      vars: {
        '--affine-font-base': '14px',
      },
    },
  },
  '@media': {
    'screen and (max-width: 800px)': {
      selectors: {
        '&.is-public': {
          vars: {
            '--affine-editor-width': '100%',
            '--affine-editor-side-padding': '24px',
          },
        },
      },
    },
  },
});

globalStyle(`${editor}[data-page-font] .doc-title-container`, {
  fontFamily: 'var(--affine-font-family)',
});
