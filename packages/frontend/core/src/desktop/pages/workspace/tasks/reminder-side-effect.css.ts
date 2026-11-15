import { style } from '@vanilla-extract/css';

export const reminderLinks = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
});

export const reminderLink = style({
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  color: 'var(--nota-accent)',
  cursor: 'pointer',
  ':hover': {
    textDecoration: 'underline',
  },
});
