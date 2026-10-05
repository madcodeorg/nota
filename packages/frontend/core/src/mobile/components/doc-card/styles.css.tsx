import {
  bodyEmphasized,
  footnoteRegular,
} from '@toeverything/theme/typography';
import { style } from '@vanilla-extract/css';

export const card = style({
  padding: 16,
  borderRadius: 20,
  border: '1px solid rgba(207, 197, 169, 0.15)',
  boxShadow: '0 20px 48px rgba(0, 0, 0, 0.26)',
  background:
    'linear-gradient(180deg, rgba(34, 35, 30, 0.96), rgba(22, 23, 20, 0.96))',

  display: 'flex',
  flexDirection: 'column',
  gap: 8,

  color: '#ebe4d5',
  ':visited': { color: '#ebe4d5' },
  ':hover': { color: '#ebe4d5' },
  ':active': { color: '#ebe4d5' },
});
export const head = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
export const title = style([
  bodyEmphasized,
  {
    width: 0,
    flex: 1,
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    color: '#ebe4d5',
    letterSpacing: '0',
  },
]);
export const untitled = style({
  opacity: 0.4,
});
export const content = style([
  footnoteRegular,
  {
    overflow: 'hidden',
    color: 'rgba(235, 228, 213, 0.58)',
    lineHeight: '18px',
  },
]);

export const contentEmpty = style({
  opacity: 0.55,
});
