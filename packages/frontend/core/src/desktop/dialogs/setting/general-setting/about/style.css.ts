import { cssVar } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';
export const link = style({
  height: '18px',
  display: 'flex',
  alignItems: 'center',
  color: cssVar('textPrimaryColor'),
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  marginBottom: '12px',
  selectors: {
    '&:last-of-type': {
      marginBottom: '0',
    },
  },
});
globalStyle(`${link} .icon`, {
  color: cssVar('iconColor'),
  fontSize: cssVar('fontBase'),
  marginLeft: '5px',
});
export const appImageRow = style({
  flexDirection: 'row-reverse',
  selectors: {
    '&.two-col': {
      justifyContent: 'flex-end',
    },
  },
});
globalStyle(`${appImageRow} .right-col`, {
  paddingLeft: '0',
  paddingRight: '20px',
});
