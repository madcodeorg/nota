import { globalStyle, style } from '@vanilla-extract/css';

const basicHeader = style({
  width: '100%',
  height: 44,
});
export const header = style({
  width: '100%',
  position: 'fixed',
  top: 0,
  background:
    'linear-gradient(180deg, rgba(23, 25, 20, 0.98), rgba(16, 17, 15, 0.94))',
  borderBottom: '1px solid rgba(207, 197, 169, 0.1)',
  zIndex: 1,
});
export const headerSpace = style([basicHeader]);
export const headerContent = style([
  basicHeader,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: `0px 16px`,
  },
]);

export const tabs = style({
  height: 44,
  gap: 16,
  display: 'flex',
  alignItems: 'center',
});
export const tab = style({
  fontSize: 20,
  fontWeight: 600,
  lineHeight: '28px',
  color: 'rgba(235, 228, 213, 0.48)',
  letterSpacing: 0,
  selectors: {
    '&[data-active="true"]': {
      color: '#ebe4d5',
    },
  },
});

export const explorer = style({
  flex: 1,
  minHeight: 0,
  background: 'transparent',
});

globalStyle(`${explorer} [data-testid="doc-list-item"]`, {
  color: '#ebe4d5',
});
