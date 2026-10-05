import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const workspaceWrapper = style({
  display: 'flex',
  alignItems: 'center',
  width: 'calc(100% + 12px)',
  height: 42,
  alignSelf: 'center',
});

export const meetingsNewButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: cssVar('textSecondaryColor'),
  cursor: 'pointer',
  padding: 0,
  selectors: {
    '&:hover': {
      background: 'rgba(111, 127, 84, 0.14)',
      color: cssVar('textPrimaryColor'),
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.5,
    },
  },
});

export const meetingHistoryRoot = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 0,
});

export const meetingHistoryHeader = style({
  padding: '6px 6px 4px',
});

export const meetingHistoryTitle = style({
  color: cssVar('textPrimaryColor'),
  fontSize: 13,
  fontWeight: 650,
  lineHeight: 1.2,
});

export const meetingHistoryCount = style({
  marginTop: 3,
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.2,
});

export const meetingHistoryList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const meetingHistoryItem = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 4,
  width: '100%',
  minHeight: 66,
  padding: '10px',
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'transparent',
  color: cssVar('textPrimaryColor'),
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    '&[data-selected="true"]': {
      background: cssVar('backgroundPrimaryColor'),
      borderColor: cssVar('borderColor'),
    },
  },
});

export const meetingHistoryItemTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.25,
});

export const meetingHistoryItemMeta = style({
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.25,
});

export const meetingHistoryItemLink = style({
  alignSelf: 'flex-start',
  color: cssVar('linkColor'),
  fontSize: 12,
  fontWeight: 560,
  lineHeight: 1.25,
});

export const meetingHistoryEmpty = style({
  padding: '12px 10px',
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: 1.4,
});

export const meetingHistoryMoreButton = style({
  height: 34,
  margin: '6px 4px 0',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 8,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 560,
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
  },
});
