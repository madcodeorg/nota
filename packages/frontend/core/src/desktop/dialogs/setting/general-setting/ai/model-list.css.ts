import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const list = style({
  containerType: 'inline-size',
  containerName: 'local-model-list',
  width: '100%',
  minWidth: 0,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  color: cssVar('textPrimaryColor'),
  fontSize: cssVar('fontSm'),
  lineHeight: '20px',
  letterSpacing: 0,
});

export const row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
  padding: '12px 0',
  selectors: {
    '&:not(:last-child)': {
      borderBottom: `1px solid ${cssVar('borderColor')}`,
    },
  },
});

export const main = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 0,
  '@container': {
    'local-model-list (max-width: 420px)': {
      flexDirection: 'column',
      gap: 6,
    },
  },
});

export const info = style({
  flex: '1 1 0',
  minWidth: 0,
  maxWidth: '100%',
});

export const heading = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '2px 8px',
  minWidth: 0,
});

export const name = style({
  minWidth: 0,
  fontWeight: 600,
  overflowWrap: 'anywhere',
});

export const selected = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
});

export const facts = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0 10px',
  minWidth: 0,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  overflowWrap: 'anywhere',
});

export const tier = style({
  textTransform: 'capitalize',
});

export const status = style({
  minWidth: 0,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  overflowWrap: 'anywhere',
});

export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flex: '0 1 auto',
  gap: 6,
  minWidth: 0,
  maxWidth: '100%',
  '@container': {
    'local-model-list (max-width: 420px)': {
      justifyContent: 'flex-start',
      width: '100%',
    },
  },
});

export const action = style({
  minWidth: 0,
  maxWidth: '100%',
  minHeight: 28,
  height: 'auto',
  padding: '4px 8px',
  fontSize: cssVar('fontXs'),
});

export const actionContent = style({
  minWidth: 0,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
});

export const reason = style({
  minWidth: 0,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const download = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: '100%',
  maxWidth: 360,
  minWidth: 0,
});

export const details = style({
  minWidth: 0,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
});

export const summary = style({
  width: 'fit-content',
  maxWidth: '100%',
  cursor: 'pointer',
  overflowWrap: 'anywhere',
  selectors: {
    '&:hover': {
      color: cssVar('textPrimaryColor'),
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 2,
    },
  },
});

export const detailList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: '8px 0 0',
  minWidth: 0,
});

export const detailRow = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  minWidth: 0,
  '@container': {
    'local-model-list (max-width: 420px)': {
      flexDirection: 'column',
      gap: 0,
    },
  },
});

export const detailValue = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  color: cssVar('textPrimaryColor'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
