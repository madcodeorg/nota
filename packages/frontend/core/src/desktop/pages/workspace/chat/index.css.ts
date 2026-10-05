import { style } from '@vanilla-extract/css';

export const chatShell = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  minWidth: 0,
  minHeight: 0,
  '@media': {
    '(max-width: 720px)': {
      flexDirection: 'column',
      background:
        'linear-gradient(180deg, #171914 0%, #10110f 52%, #0d0d0c 100%)',
    },
  },
});

export const chatRoot = style({
  flex: 1,
  minWidth: 0,
  height: '100%',
  '@media': {
    '(max-width: 720px)': {
      minHeight: 0,
      height: 'auto',
    },
  },
});

export const chatHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  '@media': {
    '(max-width: 720px)': {
      minHeight: 48,
      padding: '0 8px',
    },
  },
});
