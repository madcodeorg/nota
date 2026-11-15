import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  width: '100%',
  height: '100%',
  overflowY: 'auto',
});

export const content = style({
  maxWidth: 760,
  margin: '0 auto',
  padding: '48px 40px 80px',
  selectors: {
    '&[data-view="board"]': {
      maxWidth: 1200,
    },
  },
});

export const header = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 24,
});

export const headerText = style({
  minWidth: 0,
});

export const title = style({
  fontSize: 28,
  fontWeight: 700,
  lineHeight: '36px',
  letterSpacing: '-0.01em',
  color: cssVarV2.text.primary,
});

export const subtitle = style({
  marginTop: 6,
  fontSize: cssVar('fontSm'),
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
});

export const composer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 'var(--nota-row-radius)',
  backgroundColor: 'var(--nota-row-background)',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  transition: 'border-color .14s ease',
  selectors: {
    '&:focus-within': {
      borderColor: 'var(--nota-accent)',
    },
  },
});

export const composerInput = style({
  height: 32,
  padding: 0,
  backgroundColor: 'transparent',
  fontSize: cssVar('fontBase'),
  selectors: {
    // The composer box shows focus, so the input does not need its own ring.
    '&&&:focus-within': {
      boxShadow: 'none',
    },
  },
});

export const composerActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
});

export const composerSpacer = style({
  flex: 1,
});

export const dueButton = style({
  color: cssVarV2.text.secondary,
  selectors: {
    '&[data-active="true"]': {
      color: 'var(--nota-accent)',
    },
  },
});

export const empty = style({
  marginTop: 16,
  padding: '20px 16px',
  borderRadius: 'var(--nota-row-radius)',
  backgroundColor: 'var(--nota-row-background)',
  fontSize: cssVar('fontSm'),
  color: cssVarV2.text.secondary,
});

export const group = style({
  marginTop: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 4px 4px',
});

export const groupLabel = style({
  fontSize: cssVar('fontBase'),
  fontWeight: 700,
  color: cssVarV2.text.primary,
  selectors: {
    '&[data-overdue="true"], &[data-today="true"]': {
      color: 'var(--nota-accent)',
    },
  },
});

export const groupToggle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  transition: 'color .14s ease',
  ':hover': {
    color: cssVarV2.text.primary,
  },
});

export const groupCount = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: cssVarV2.text.tertiary,
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 'var(--nota-row-radius)',
  backgroundColor: 'var(--nota-row-background)',
  transition: 'background-color .14s ease',
  ':hover': {
    backgroundColor: cssVarV2.layer.background.tertiary,
  },
});

export const rowMain = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  textAlign: 'left',
  cursor: 'pointer',
});

export const rowText = style({
  width: '100%',
  fontSize: cssVar('fontBase'),
  lineHeight: '22px',
  color: cssVarV2.text.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    [`${row}[data-checked="true"] &`]: {
      color: cssVarV2.text.secondary,
      textDecoration: 'line-through',
    },
  },
});

export const rowSource = style({
  width: '100%',
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  color: cssVarV2.text.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const due = style({
  flexShrink: 0,
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: cssVarV2.text.secondary,
  selectors: {
    '&[data-overdue="true"], &[data-today="true"]': {
      color: 'var(--nota-accent)',
    },
  },
});

export const board = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(240px, 1fr))',
  gap: 16,
  alignItems: 'start',
  overflowX: 'auto',
});

export const column = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 160,
  padding: 10,
  borderRadius: 12,
  backgroundColor: cssVarV2.layer.background.secondary,
  border: '1px solid transparent',
  transition: 'border-color .14s ease, background-color .14s ease',
  selectors: {
    '&[data-drag-over="true"]': {
      borderColor: 'var(--nota-accent)',
    },
  },
});

export const columnHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 4px',
});

export const columnDot = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: cssVarV2.text.tertiary,
  selectors: {
    '&[data-column="doing"]': {
      backgroundColor: 'var(--nota-accent)',
    },
    '&[data-column="done"]': {
      backgroundColor: cssVarV2.status.success,
    },
  },
});

export const columnLabel = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 700,
  color: cssVarV2.text.primary,
});

export const columnCards = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const columnAdd = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: cssVar('fontSm'),
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  transition: 'background-color .14s ease, color .14s ease',
  ':hover': {
    color: cssVarV2.text.primary,
    backgroundColor: cssVarV2.layer.background.hoverOverlay,
  },
});

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 10px 10px 12px',
  borderRadius: 10,
  backgroundColor: cssVarV2.layer.background.primary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  cursor: 'grab',
  transition: 'box-shadow .14s ease',
  ':hover': {
    boxShadow: cssVar('shadow1'),
  },
  ':active': {
    cursor: 'grabbing',
  },
});

export const cardTop = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
});

export const cardText = style({
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  fontSize: cssVar('fontSm'),
  lineHeight: '20px',
  color: cssVarV2.text.primary,
  wordBreak: 'break-word',
  cursor: 'pointer',
  selectors: {
    [`${card}[data-checked="true"] &`]: {
      color: cssVarV2.text.secondary,
      textDecoration: 'line-through',
    },
  },
});

export const cardMenu = style({
  opacity: 0,
  transition: 'opacity .14s ease',
  selectors: {
    [`${card}:hover &, &[data-state="open"], &:focus-visible`]: {
      opacity: 1,
    },
  },
});

export const cardMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingLeft: 28,
});

export const cardSource = style({
  flex: 1,
  minWidth: 0,
  fontSize: cssVar('fontXs'),
  color: cssVarV2.text.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const reminderIcon = style({
  flexShrink: 0,
  width: 20,
  height: 20,
  color: 'var(--nota-accent)',
});
