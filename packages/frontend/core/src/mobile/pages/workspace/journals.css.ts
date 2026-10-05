import { globalStyle, style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100dvh',
  overflow: 'hidden',
  background: 'linear-gradient(180deg, #171914 0%, #10110f 52%, #0d0d0c 100%)',
  color: '#ebe4d5',
});

export const header = style({
  background:
    'linear-gradient(180deg, rgba(23, 25, 20, 0.98), rgba(16, 17, 15, 0.94))',
  borderBottom: '1px solid rgba(207, 197, 169, 0.1)',
});

export const headerTitle = style({
  color: '#ebe4d5',
  fontSize: 17,
  lineHeight: '22px',
  fontWeight: 600,
  letterSpacing: 0,
});

export const journalDatePicker = style({
  backgroundColor: 'transparent',
});

globalStyle(`${container} *`, {
  letterSpacing: '0',
});

globalStyle(`${container} [class*="journal"]`, {
  color: '#ebe4d5',
});

globalStyle(`${container} [class*="placeholder"]`, {
  background: 'rgba(22, 23, 20, 0.82)',
  borderColor: 'rgba(207, 197, 169, 0.16)',
  color: '#ebe4d5',
});

globalStyle(`${container} button`, {
  backgroundColor: '#6f7f54',
  color: '#f4eedf',
});
