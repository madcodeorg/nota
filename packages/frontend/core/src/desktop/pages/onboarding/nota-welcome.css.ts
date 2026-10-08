import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';

const arrive = keyframes({
  from: { opacity: 0, transform: 'translateY(10px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

// Theme tokens keep onboarding readable in both light and dark themes. Only
// the Nota accent is a fixed brand color, matching the app's primary button.
const text = cssVarV2('text/primary');
const secondary = cssVarV2('text/secondary');
const tertiary = cssVarV2('text/tertiary');
const border = cssVarV2('layer/insideBorder/border');
const surface = cssVarV2('layer/background/primary');
const raised = cssVarV2('layer/background/secondary');
const hover = cssVarV2('layer/background/hoverOverlay');
const accent = 'var(--affine-primary-color, #6f7f54)';
// Matches the app's primary button, which keeps white text on a fixed green.
const primaryFill = '#6f7f54';
const onAccent = cssVarV2('button/pureWhiteText');
const serif = "var(--affine-font-serif-family, 'Lora', serif)";

export const header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 36,
});
export const wordmark = style({
  fontSize: 21,
  fontFamily: serif,
  letterSpacing: 0,
  color: text,
});
export const progress = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
  listStyle: 'none',
  padding: 0,
  margin: '16px 0 0',
  gap: 8,
  color: tertiary,
  fontSize: 11,
  lineHeight: 1.3,
});
export const progressStep = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  minWidth: 0,
  overflowWrap: 'anywhere',
  selectors: {
    '&[data-complete="true"]': { color: secondary },
    '&[aria-current="step"]': { color: text, fontWeight: 600 },
  },
});
globalStyle(`${progressStep}::before`, {
  content: '""',
  display: 'block',
  height: 3,
  borderRadius: 3,
  background: border,
});
globalStyle(
  `${progressStep}[data-complete="true"]::before, ${progressStep}[aria-current="step"]::before`,
  { background: accent }
);
export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
});
export const button = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 32,
  boxSizing: 'border-box',
  border: `1px solid ${border}`,
  borderRadius: 8,
  padding: '6px 12px',
  background: surface,
  color: text,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.3,
  cursor: 'pointer',
  transition: 'background 150ms ease, filter 150ms ease',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
    '&:hover:not(:disabled)': { background: hover },
  },
});
export const primary = style([
  button,
  {
    background: primaryFill,
    color: onAccent,
    borderColor: 'transparent',
    padding: '6px 16px',
    selectors: {
      '&:hover:not(:disabled)': {
        background: primaryFill,
        filter: 'brightness(.92)',
      },
    },
  },
]);
export const subtle = style([
  button,
  {
    borderColor: 'transparent',
    background: 'transparent',
    color: secondary,
    fontWeight: 400,
    selectors: { '&:hover:not(:disabled)': { color: text } },
  },
]);
export const iconButton = style([
  subtle,
  {
    width: 32,
    height: 32,
    padding: 0,
    flexShrink: 0,
  },
]);
globalStyle(`${iconButton} svg`, { width: 20, height: 20 });
export const bottom = style([
  actions,
  { justifyContent: 'space-between', marginTop: 20 },
]);
export const caption = style({
  color: tertiary,
  fontSize: 12,
  margin: '14px 0 0',
  lineHeight: 1.5,
});
export const footer = style({
  display: 'flex',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 16,
  marginTop: 18,
  paddingTop: 14,
  borderTop: `1px solid ${border}`,
  fontSize: 12,
});
globalStyle(`${footer} a`, { color: tertiary, textDecoration: 'none' });
globalStyle(`${footer} a:hover`, { color: text });
globalStyle(`${footer} a:focus-visible`, {
  outline: `2px solid ${accent}`,
  outlineOffset: 3,
  borderRadius: 2,
});
export const error = style({
  fontSize: 13,
  color: cssVarV2('status/error'),
  margin: '12px 0 0',
  lineHeight: 1.5,
});

// Setup sheet. It renders inside a Modal, which already provides the surface.
export const panel = style({
  boxSizing: 'border-box',
  width: '100%',
  padding: '22px 32px 18px',
  color: text,
  animation: `${arrive} 300ms ease-out both`,
  '@media': { '(max-width: 640px)': { padding: '16px 18px' } },
});
export const panelTitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  margin: '22px 0 0',
  minHeight: 36,
});
export const panelHeading = style({
  fontSize: 26,
  fontFamily: serif,
  fontWeight: 400,
  letterSpacing: 0,
  lineHeight: 1.25,
  margin: 0,
  color: text,
  selectors: { '&:focus': { outline: 'none' } },
});
export const panelDescription = style({
  lineHeight: 1.55,
  color: secondary,
  fontSize: 14,
  margin: '6px 0 18px',
  maxWidth: 640,
});
export const setupStage = style({
  // A stable stage keeps the sheet from resizing between steps.
  minHeight: 300,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
});
export const setupContent = style({
  border: `1px solid ${border}`,
  borderRadius: 8,
  background: raised,
  padding: 18,
});
export const stageActions = style([
  actions,
  { justifyContent: 'space-between', marginTop: 'auto', paddingTop: 6 },
]);
export const localDefault = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: secondary,
  fontSize: 13,
});
export const localDot = style({
  width: 7,
  height: 7,
  background: accent,
  borderRadius: '50%',
  flexShrink: 0,
});
export const importPreview = style({
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  margin: '12px 0 14px',
  padding: 0,
  listStyle: 'none',
});
export const importSource = style({
  fontSize: 12,
  padding: '3px 8px',
  borderRadius: 4,
  color: secondary,
  background: hover,
});
export const box = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
});
export const choice = style({
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  border: `1px solid ${border}`,
  borderRadius: 8,
  background: raised,
  minWidth: 0,
});
export const choiceTitle = style({
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  color: text,
});
export const permissionGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
  width: '100%',
  margin: '6px 0 2px',
  fontSize: 13,
  '@media': { '(max-width: 420px)': { gridTemplateColumns: '1fr' } },
});
export const permissionStatus = style({
  display: 'block',
  marginTop: 2,
  color: secondary,
  fontSize: 12,
  textTransform: 'capitalize',
});
export const detail = style({
  margin: 0,
  color: secondary,
  fontSize: 13,
  lineHeight: 1.5,
});
export const select = style({
  border: `1px solid ${border}`,
  borderRadius: 8,
  padding: '7px 10px',
  color: text,
  background: surface,
  font: 'inherit',
  fontSize: 13,
  width: '100%',
  maxWidth: 320,
  margin: '6px 0 2px',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});

globalStyle(`${panel}, ${button}`, {
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      transition: 'none',
    },
  },
});
