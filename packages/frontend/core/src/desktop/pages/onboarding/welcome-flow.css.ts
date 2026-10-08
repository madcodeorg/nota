import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';

import * as shared from './nota-welcome.css';

// The first-launch window floats over the desktop, so the intro and card use
// one fixed dark palette regardless of the app theme.
const white = '#f4f5f0';
const dim = 'rgba(244, 245, 240, .68)';
const faint = 'rgba(244, 245, 240, .44)';
const line = 'rgba(255, 255, 255, .11)';
const cardFill = '#0e0f0d';
const accent = '#b9c78c';
const serif = "var(--affine-font-serif-family, 'Lora', serif)";
const sans = "var(--affine-font-family, 'Inter', sans-serif)";
const ease = 'cubic-bezier(.2, .7, .2, 1)';
const token = (name: Parameters<typeof cssVarV2>[0]) =>
  cssVarV2(name).slice(4, -1);

const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
// A pen stroke of light draws across the screen, then closes on the mark.
const penStroke = keyframes({
  '0%': { opacity: 0, left: '14%', width: '0%' },
  '8%': { opacity: 1 },
  '46%': { left: '14%', width: '72%' },
  '78%': { opacity: 1, left: '50%', width: '0%' },
  '100%': { opacity: 0, left: '50%', width: '0%' },
});
const horizonGlow = keyframes({
  '0%': { opacity: 0, transform: 'scaleY(.12)' },
  '55%': { opacity: 1, transform: 'scaleY(1)' },
  '100%': { opacity: 0, transform: 'scaleY(.35)' },
});
const writeOn = keyframes({
  from: { opacity: 1, clipPath: 'inset(0 100% 0 0)' },
  to: { opacity: 1, clipPath: 'inset(0 -8% 0 -8%)' },
});
const markIn = keyframes({
  from: { opacity: 0, transform: 'scale(.6)' },
  to: { opacity: 1, transform: 'scale(1)' },
});
const rise = keyframes({
  from: { opacity: 0, transform: 'translateY(14px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});
const lift = keyframes({
  from: { transform: 'translateY(0) scale(1)' },
  to: { transform: 'translateY(-172px) scale(.72)' },
});
const floatIn = keyframes({
  from: { opacity: 0, transform: 'translateY(18px) scale(.97)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
});
const drift = keyframes({
  '0%, 100%': { translate: '0 0' },
  '50%': { translate: '0 -6px' },
});
const typing = keyframes({
  '0%': { opacity: 1, clipPath: 'inset(0 100% 0 0)' },
  '55%': { opacity: 1, clipPath: 'inset(0 0 0 0)' },
  '88%': { opacity: 1, clipPath: 'inset(0 0 0 0)' },
  '100%': { opacity: 0, clipPath: 'inset(0 0 0 0)' },
});
const typingLast = keyframes({
  from: { opacity: 1, clipPath: 'inset(0 100% 0 0)' },
  to: { opacity: 1, clipPath: 'inset(0 0 0 0)' },
});
const lineGrow = keyframes({
  from: { transform: 'scaleX(0)' },
  to: { transform: 'scaleX(1)' },
});
const introOut = keyframes({
  from: { opacity: 1, transform: 'scale(1)' },
  to: { opacity: 0, transform: 'scale(.985)' },
});
const cardIn = keyframes({
  from: { opacity: 0, transform: 'translateY(28px) scale(.97)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
});
const cardOut = keyframes({
  from: { opacity: 1, transform: 'scale(1)' },
  to: { opacity: 0, transform: 'scale(.96)' },
});
const stepIn = keyframes({
  from: { opacity: 0, transform: 'translateX(10px)' },
  to: { opacity: 1, transform: 'translateX(0)' },
});
const pulse = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.35 },
});
const wave = keyframes({
  '0%, 100%': { transform: 'scaleY(.35)' },
  '50%': { transform: 'scaleY(1)' },
});

export const screen = style({
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  color: white,
  fontFamily: sans,
  isolation: 'isolate',
  background: '#11130f',
  selectors: {
    // The native window is transparent: darken the real desktop. CSS cannot
    // blur pixels outside the window, so the dim carries the contrast.
    '&[data-desktop-overlay="true"]': { background: 'transparent' },
  },
});
export const backdrop = style({
  position: 'absolute',
  inset: 0,
  zIndex: -1,
  background: 'rgba(7, 9, 6, .6)',
  backdropFilter: 'blur(22px) saturate(1.15)',
  transition: 'background 900ms ease',
  animation: `${fadeIn} 700ms ease both`,
  selectors: {
    // Lighter dim behind the card so the desktop stays visible.
    [`${screen}[data-phase="setup"] &, ${screen}[data-phase="done"] &`]: {
      background: 'rgba(9, 11, 8, .42)',
    },
  },
});

// Intro
export const intro = style({
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  pointerEvents: 'none',
  selectors: {
    '&[data-leaving="true"]': {
      animation: `${introOut} 520ms ease both`,
    },
  },
});
// The stroke meets where the mark appears (above the wordmark).
const strokeY = 'calc(50% - 31px)';
export const horizon = style({
  position: 'absolute',
  left: '-10%',
  right: '-10%',
  top: strokeY,
  height: 260,
  translate: '0 -50%',
  background:
    'radial-gradient(50% 50% at 50% 50%, rgba(244, 245, 240, .16) 0%, rgba(185, 199, 140, .08) 35%, rgba(185, 199, 140, 0) 100%)',
  opacity: 0,
  animation: `${horizonGlow} 2.3s ease .45s both`,
});
export const stroke = style({
  position: 'absolute',
  top: strokeY,
  height: 2,
  marginTop: -1,
  borderRadius: 2,
  background:
    'linear-gradient(90deg, rgba(244, 245, 240, 0), rgba(214, 226, 184, .75) 45%, #ffffff)',
  boxShadow: '0 0 16px 1px rgba(214, 226, 184, .55)',
  opacity: 0,
  animation: `${penStroke} 2.2s cubic-bezier(.65, 0, .35, 1) .3s both`,
});
// The bright nib at the leading edge of the stroke.
globalStyle(`${stroke}::after`, {
  content: '""',
  position: 'absolute',
  right: -4,
  top: '50%',
  width: 8,
  height: 8,
  marginTop: -4,
  borderRadius: '50%',
  background: '#ffffff',
  boxShadow:
    '0 0 18px 6px rgba(255, 255, 255, .65), 0 0 46px 14px rgba(185, 199, 140, .4)',
});
export const lockup = style({
  gridArea: '1 / 1',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  animation: `${lift} 900ms ${ease} 4s forwards`,
});
export const lockupMark = style({
  width: 76,
  height: 76,
  borderRadius: 18,
  display: 'block',
  boxShadow: '0 12px 48px rgba(185, 199, 140, .35)',
  animation: `${markIn} 700ms ${ease} 2.05s both`,
});
export const lockupWordmark = style({
  fontFamily: serif,
  fontSize: 46,
  lineHeight: 1,
  letterSpacing: 0,
  color: white,
  textShadow: '0 2px 24px rgba(0, 0, 0, .45)',
  opacity: 0,
  animation: `${writeOn} 900ms cubic-bezier(.45, 0, .2, 1) 2.45s both`,
});
export const vignettes = style({
  gridArea: '1 / 1',
  position: 'relative',
  width: 'min(620px, calc(100vw - 48px))',
  height: 340,
  translate: '0 70px',
});
export const askBar = style({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 64,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 14px 0 20px',
  boxSizing: 'border-box',
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, .2)',
  background: 'rgba(255, 255, 255, .1)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 20px 60px rgba(0, 0, 0, .3)',
  animation: `${floatIn} 700ms ${ease} 4.35s both`,
});
export const askText = style({
  position: 'relative',
  flex: 1,
  height: 24,
  fontSize: 18,
  color: white,
});
export const askPhrase = style({
  position: 'absolute',
  inset: 0,
  whiteSpace: 'nowrap',
  opacity: 0,
  animation: `${typing} 1.5s steps(28, end) both`,
  selectors: {
    '&[data-phrase="0"]': { animationDelay: '4.9s' },
    '&[data-phrase="1"]': { animationDelay: '6.4s' },
    '&[data-phrase="2"]': {
      animation: `${typingLast} 900ms steps(28, end) 7.9s both`,
    },
  },
});
export const askSend = style({
  display: 'grid',
  placeItems: 'center',
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: white,
  color: '#141611',
  flexShrink: 0,
});
globalStyle(`${askSend} svg`, { width: 20, height: 20, rotate: '-90deg' });
export const floatPage = style({
  position: 'absolute',
  left: 22,
  bottom: 86,
  width: 270,
  padding: 18,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, .14)',
  background: 'rgba(255, 255, 255, .07)',
  backdropFilter: 'blur(10px)',
  animation: `${floatIn} 700ms ${ease} 5.1s both, ${drift} 5s ease-in-out 5.8s infinite`,
});
export const floatLine = style({
  display: 'block',
  height: 7,
  borderRadius: 4,
  background: 'rgba(255, 255, 255, .26)',
  transformOrigin: 'left center',
  animation: `${lineGrow} 500ms ${ease} both`,
  selectors: {
    '&:nth-child(1)': {
      width: '62%',
      height: 11,
      background: 'rgba(255, 255, 255, .5)',
      animationDelay: '5.4s',
    },
    '&:nth-child(2)': { width: '92%', animationDelay: '5.6s' },
    '&:nth-child(3)': { width: '84%', animationDelay: '5.75s' },
    '&:nth-child(4)': { width: '48%', animationDelay: '5.9s' },
  },
});
export const chip = style({
  position: 'absolute',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  height: 32,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, .16)',
  background: 'rgba(30, 33, 27, .72)',
  backdropFilter: 'blur(10px)',
  color: white,
  fontSize: 13,
  whiteSpace: 'nowrap',
  animation: `${floatIn} 600ms ${ease} both, ${drift} 6s ease-in-out infinite`,
  selectors: {
    '&[data-chip="meeting"]': {
      right: 20,
      bottom: 150,
      animationDelay: '5.6s, 6.2s',
    },
    '&[data-chip="linked"]': {
      right: 64,
      bottom: 98,
      animationDelay: '6.5s, 7.1s',
    },
    '&[data-chip="local"]': {
      left: 300,
      top: 0,
      animationDelay: '7.3s, 7.9s',
    },
  },
});
globalStyle(`${chip} svg`, { width: 16, height: 16, color: accent });
export const recordingDot = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#ef6f5c',
  animation: `${pulse} 1.4s ease-in-out infinite`,
});
export const skip = style({
  position: 'absolute',
  right: 28,
  bottom: 24,
  border: 0,
  borderRadius: 6,
  padding: '6px 10px',
  background: 'transparent',
  color: faint,
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  animation: `${fadeIn} 400ms ease 1s both`,
  selectors: {
    '&:hover': { color: white },
    '&:focus-visible': { outline: `2px solid ${accent}` },
  },
});

// Setup card
export const stage = style({
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  boxSizing: 'border-box',
  '@media': { '(max-width: 640px)': { padding: 12 } },
});
export const card = style({
  vars: {
    [token('text/primary')]: white,
    [token('text/secondary')]: dim,
    [token('text/tertiary')]: faint,
    [token('layer/insideBorder/border')]: line,
    [token('layer/background/primary')]: '#171915',
    [token('layer/background/secondary')]: 'rgba(255, 255, 255, .035)',
    [token('layer/background/hoverOverlay')]: 'rgba(255, 255, 255, .07)',
    [token('status/error')]: '#ff9180',
    '--affine-primary-color': accent,
  },
  colorScheme: 'dark',
  position: 'relative',
  width: 'min(900px, 100%)',
  height: 'min(570px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 8,
  border: `1px solid ${line}`,
  background: cardFill,
  color: white,
  boxShadow: '0 32px 90px rgba(0, 0, 0, .45), 0 4px 16px rgba(0, 0, 0, .22)',
  animation: `${cardIn} 620ms ${ease} both`,
  selectors: {
    '&[data-leaving="true"]': {
      animation: `${cardOut} 420ms ease both`,
    },
  },
});
export const cardProgress = style({
  position: 'relative',
  height: 3,
  flexShrink: 0,
  margin: '14px 20px 0',
  borderRadius: 3,
  background: 'rgba(255, 255, 255, .08)',
  overflow: 'hidden',
});
export const cardProgressFill = style({
  position: 'absolute',
  inset: '0 auto 0 0',
  borderRadius: 3,
  background:
    'linear-gradient(90deg, #7fb7a4, #b9c78c 38%, #e3c46f 68%, #f09a6b)',
  transition: `width 520ms ${ease}`,
});
export const cardBody = style({
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  selectors: {
    '&[data-preview="true"]': {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, .8fr)',
    },
  },
  '@media': {
    '(max-width: 760px)': {
      selectors: {
        '&[data-preview="true"]': { gridTemplateColumns: 'minmax(0, 1fr)' },
      },
    },
  },
});
export const cardMain = style({
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '28px 36px 26px',
  overflowY: 'auto',
  '@media': { '(max-width: 640px)': { padding: '22px 20px 20px' } },
});
export const cardTitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 36,
  marginLeft: -8,
});
export const cardTitle = style({
  margin: 0,
  paddingLeft: 8,
  fontFamily: serif,
  fontSize: 28,
  fontWeight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  color: white,
  selectors: { '&:focus': { outline: 'none' } },
});
export const cardCopy = style({
  margin: '8px 0 20px',
  maxWidth: 460,
  color: dim,
  fontSize: 14,
  lineHeight: 1.55,
});
export const cardStage = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  animation: `${stepIn} 320ms ${ease} both`,
});
// Model and permission steps render their own sections and action rows.
globalStyle(`${cardStage} > section`, {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
});
globalStyle(`${card} ${shared.bottom}`, {
  marginTop: 'auto',
  paddingTop: 18,
});
globalStyle(`${card} ${shared.caption}`, { display: 'none' });
globalStyle(`${card} ${shared.choice}`, { padding: 16 });
globalStyle(`${card} ${shared.primary}`, {
  background: accent,
  color: '#141a0f',
  fontWeight: 600,
});
globalStyle(`${card} ${shared.primary}:hover:not(:disabled)`, {
  background: '#c8d59d',
  filter: 'none',
});
export const enterHint = style({ opacity: 0.6, fontWeight: 400 });

export const features = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});
export const feature = style({
  display: 'grid',
  gridTemplateColumns: '32px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'start',
  fontSize: 13,
  lineHeight: 1.45,
  color: dim,
});
globalStyle(`${feature} strong`, {
  display: 'block',
  color: white,
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 1,
});
export const featureIcon = style({
  display: 'grid',
  placeItems: 'center',
  width: 32,
  height: 32,
  borderRadius: 8,
  background: 'rgba(185, 199, 140, .12)',
  color: accent,
});
globalStyle(`${featureIcon} svg`, { width: 18, height: 18 });

export const options = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  padding: 0,
  border: 0,
  minWidth: 0,
});
export const option = style({
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'start',
  padding: '12px 14px',
  borderRadius: 8,
  border: `1px solid ${line}`,
  background: 'rgba(255, 255, 255, .025)',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1.45,
  color: dim,
  transition: 'border-color 150ms ease, background 150ms ease',
  selectors: {
    '&:has(input:checked)': {
      borderColor: 'rgba(185, 199, 140, .6)',
      background: 'rgba(185, 199, 140, .07)',
    },
    '&:has(input:disabled)': { cursor: 'default', opacity: 0.6 },
    '&:has(input:focus-visible)': {
      outline: `2px solid ${accent}`,
      outlineOffset: 2,
    },
  },
});
globalStyle(`${option} input`, {
  margin: '2px 0 0',
  width: 16,
  height: 16,
  accentColor: accent,
});
globalStyle(`${option} strong`, {
  display: 'block',
  color: white,
  fontSize: 14,
  fontWeight: 600,
});
export const account = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 32,
  color: dim,
  fontSize: 13,
});
export const accountBadge = style({
  display: 'grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: 'rgba(185, 199, 140, .16)',
  color: accent,
});
globalStyle(`${accountBadge} svg`, { width: 16, height: 16 });

// Preview pane: an illustrative window that bleeds off the card edge.
export const preview = style({
  position: 'relative',
  overflow: 'hidden',
  borderLeft: `1px solid ${line}`,
  background:
    'linear-gradient(160deg, rgba(185, 199, 140, .12), rgba(127, 183, 164, .05) 45%, rgba(240, 154, 107, .08))',
  '@media': { '(max-width: 760px)': { display: 'none' } },
});
export const previewWindow = style({
  position: 'absolute',
  top: 46,
  left: 32,
  right: -70,
  bottom: -40,
  borderRadius: 8,
  overflow: 'hidden',
  background: '#f7f6f1',
  color: '#2a2d26',
  boxShadow: '0 24px 70px rgba(0, 0, 0, .45)',
  animation: `${floatIn} 560ms ${ease} 120ms both`,
});
export const previewBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  borderBottom: '1px solid rgba(42, 45, 38, .1)',
  fontSize: 11,
  color: 'rgba(42, 45, 38, .6)',
});
globalStyle(`${previewBar} i`, {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'rgba(42, 45, 38, .16)',
});
export const previewLayout = style({
  display: 'grid',
  gridTemplateColumns: '92px minmax(0, 1fr)',
  height: 'calc(100% - 30px)',
});
export const previewSidebar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: '16px 12px',
  background: '#efeee7',
});
globalStyle(`${previewSidebar} span`, {
  display: 'block',
  height: 6,
  width: '78%',
  borderRadius: 3,
  background: 'rgba(42, 45, 38, .14)',
});
export const previewPage = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 22,
  minWidth: 0,
});
export const previewHeading = style({
  fontFamily: serif,
  fontSize: 19,
  color: '#22251f',
  marginBottom: 2,
});
export const previewLine = style({
  display: 'block',
  height: 6,
  borderRadius: 3,
  background: 'rgba(42, 45, 38, .14)',
  selectors: {
    '&[data-width="l"]': { width: '88%' },
    '&[data-width="m"]': { width: '70%' },
    '&[data-width="s"]': { width: '46%' },
  },
});
export const previewChip = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 9px',
  borderRadius: 6,
  background: 'rgba(111, 127, 84, .14)',
  color: '#4c5a36',
  fontSize: 11,
  fontWeight: 600,
});
globalStyle(`${previewChip} svg`, { width: 14, height: 14 });
export const previewBubble = style({
  alignSelf: 'flex-start',
  maxWidth: '82%',
  padding: '8px 11px',
  borderRadius: 8,
  background: '#ffffff',
  border: '1px solid rgba(42, 45, 38, .1)',
  fontSize: 12,
  lineHeight: 1.45,
  color: '#2a2d26',
  selectors: {
    '&[data-from="me"]': {
      alignSelf: 'flex-end',
      background: '#2a2d26',
      color: '#f7f6f1',
      border: 0,
    },
  },
});
export const previewWave = style({
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  height: 34,
});
globalStyle(`${previewWave} span`, {
  width: 4,
  height: '100%',
  borderRadius: 2,
  background: '#6f7f54',
  animation: `${wave} 1.1s ease-in-out infinite`,
});
for (let index = 1; index <= 16; index++) {
  globalStyle(`${previewWave} span:nth-child(${index})`, {
    animationDelay: `${((index * 0.13) % 1.1).toFixed(2)}s`,
  });
}
export const previewFile = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 11px',
  borderRadius: 6,
  background: '#ffffff',
  border: '1px solid rgba(42, 45, 38, .1)',
  fontSize: 12,
  color: '#2a2d26',
});
globalStyle(`${previewFile} svg`, {
  width: 18,
  height: 18,
  color: '#6f7f54',
});
globalStyle(`${previewFile} small`, {
  marginLeft: 'auto',
  color: 'rgba(42, 45, 38, .5)',
  fontSize: 11,
});

// Ending
export const ready = style({
  vars: {
    [token('text/primary')]: white,
    [token('text/secondary')]: dim,
    [token('status/error')]: '#ff9180',
    '--affine-primary-color': accent,
  },
  colorScheme: 'dark',
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  alignContent: 'center',
  gap: 18,
  padding: 24,
  textAlign: 'center',
});
export const readyTitle = style({
  margin: 0,
  fontFamily: serif,
  fontSize: 38,
  fontWeight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  color: white,
  textShadow: '0 2px 24px rgba(0, 0, 0, .45)',
  animation: `${rise} 700ms ${ease} 300ms both`,
  '@media': { '(max-width: 640px)': { fontSize: 30 } },
});
export const readyError = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  maxWidth: 460,
});

globalStyle(`${screen}[data-reduced-motion="true"] *`, {
  animationDuration: '1ms !important',
  animationDelay: '0ms !important',
  animationIterationCount: '1 !important',
  transitionDuration: '1ms !important',
});
globalStyle('html[data-nota-onboarding-platform="windows"] body', {
  background: '#11130f',
});
globalStyle(`html[data-nota-onboarding-platform="windows"] ${screen}`, {
  background: '#11130f',
});
globalStyle(`html[data-nota-onboarding-platform="windows"] ${backdrop}`, {
  backdropFilter: 'none',
});
