import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

const narrowViewport = 'viewport (width <= 640px)';
const heroFade = 'linear-gradient(to bottom, #000 45%, transparent 100%)';

export const briefCover = style({
  position: 'relative',
  width: '100%',
  color: cssVar('textPrimaryColor'),
});

export const hero = style({
  position: 'relative',
  width: '100%',
  height: 'clamp(200px, 40vh, 380px)',
  '@container': {
    [narrowViewport]: {
      height: 'clamp(160px, 30vh, 240px)',
    },
  },
  '@media': {
    print: {
      display: 'none',
    },
  },
});

// Masking (instead of a color overlay) fades the art into whatever the page
// background is, in both light and dark themes.
export const heroArt = style({
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  backgroundColor: cssVarV2.layer.background.secondary,
  maskImage: heroFade,
  WebkitMaskImage: heroFade,
});

export const heroImage = style({
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center 40%',
  userSelect: 'none',
});

export const heroGradient = style({
  width: '100%',
  height: '100%',
});

export const heroRepositioning = style({
  cursor: 'ns-resize',
  touchAction: 'none',
});

export const heroActions = style({
  position: 'absolute',
  top: 16,
  right: 16,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const heroAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 32,
  height: 32,
  padding: 0,
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 8,
  background: 'rgba(18, 18, 18, 0.42)',
  color: '#fff',
  fontSize: 16,
  cursor: 'pointer',
  backdropFilter: 'blur(8px)',
  transition: 'background 0.2s ease',
  selectors: {
    '&:hover': {
      background: 'rgba(18, 18, 18, 0.64)',
    },
    '&:focus-visible': {
      outline: '2px solid #fff',
      outlineOffset: 2,
    },
  },
});

export const heroActionLabel = style([
  heroAction,
  {
    gap: 6,
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 500,
  },
]);

export const repositionBar = style({
  position: 'absolute',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 12px',
  borderRadius: 999,
  background: 'rgba(18, 18, 18, 0.74)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  color: '#fff',
  fontSize: 12,
  whiteSpace: 'nowrap',
  backdropFilter: 'blur(10px)',
});

export const repositionSlider = style({
  width: 110,
  accentColor: '#fff',
  cursor: 'pointer',
});

export const repositionButton = style({
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid rgba(255, 255, 255, 0.2)',
  background: 'rgba(255, 255, 255, 0.16)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.28)',
    },
  },
});

export const coverPicker = style({
  width: 320,
  maxWidth: 'calc(100vw - 32px)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  color: cssVarV2.text.primary,
});

export const coverTabs = style({
  display: 'flex',
  gap: 4,
  borderBottom: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  paddingBottom: 8,
});

export const coverTab = style({
  padding: '4px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: cssVarV2.text.secondary,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
      color: cssVarV2.text.primary,
    },
    '&[data-active="true"]': {
      background: cssVarV2.layer.background.secondary,
      color: cssVarV2.text.primary,
    },
  },
});

export const presetGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 6,
});

export const presetSwatch = style({
  height: 36,
  borderRadius: 6,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  cursor: 'pointer',
  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
  selectors: {
    '&:hover': {
      transform: 'scale(1.03)',
    },
    '&[data-active="true"]': {
      boxShadow: `0 0 0 2px ${cssVarV2.button.primary}`,
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2.button.primary}`,
      outlineOffset: 1,
    },
  },
});

export const pickerSecondaryButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  height: 32,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.secondary,
  color: cssVarV2.text.primary,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
    '&:disabled': {
      opacity: 0.5,
      cursor: 'default',
    },
  },
});

export const pickerForm = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const pickerInput = style({
  width: '100%',
  height: 32,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.primary,
  color: cssVarV2.text.primary,
  fontSize: 12,
  boxSizing: 'border-box',
});

export const pickerHint = style({
  fontSize: 11,
  color: cssVarV2.text.secondary,
  margin: 0,
});

export const pickerError = style({
  fontSize: 11,
  color: cssVarV2.status.error,
  margin: 0,
});

export const credit = style({
  position: 'absolute',
  right: 16,
  bottom: '14%',
  zIndex: 1,
  maxWidth: 240,
  padding: '8px 10px',
  borderRadius: 6,
  background: 'rgba(255, 255, 255, 0.92)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
  color: '#141414',
  fontSize: 12,
  lineHeight: 1.35,
  '@container': {
    [narrowViewport]: {
      display: 'none',
    },
  },
});

export const creditTitle = style({
  fontSize: 13,
  fontWeight: 700,
});

export const creditSource = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  color: 'rgba(20, 20, 20, 0.62)',
  fontSize: 10.5,
  textDecoration: 'none',
  selectors: {
    '&[href]:hover': {
      textDecoration: 'underline',
    },
  },
});

export const titleArea = style({
  width: '100%',
  maxWidth: cssVar('editorWidth'),
  margin: '0 auto',
  padding: `8px ${cssVar('editorSidePadding', '24px')} 24px`,
  boxSizing: 'border-box',
  selectors: {
    [`${briefCover}[data-cover-hidden="true"] &`]: {
      paddingTop: 56,
    },
  },
  '@container': {
    [narrowViewport]: {
      paddingLeft: 24,
      paddingRight: 24,
    },
  },
  '@media': {
    print: {
      padding: 0,
    },
  },
});

export const headerTools = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
  selectors: {
    '&:empty': {
      display: 'none',
    },
  },
  '@media': {
    print: {
      display: 'none',
    },
  },
});

const chipLook = {
  height: 28,
  padding: '0 10px',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  borderRadius: 8,
  background: cssVarV2.layer.background.secondary,
} as const;

export const chip = style({
  ...chipLook,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: cssVarV2.text.secondary,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: cssVarV2.text.primary,
    },
  },
});

export const dateLine = style({
  marginTop: 12,
  color: cssVarV2.text.secondary,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontVariantNumeric: 'tabular-nums',
});

globalStyle(`${briefCover} .doc-icon-container`, {
  width: 'auto',
  maxWidth: 'none',
  margin: 0,
  // Overrides the inline bottom padding set by DocIconPicker.
  padding: '0 !important',
});

globalStyle(
  `${headerTools} .doc-icon-container[data-has-icon="false"] button`,
  chipLook
);

globalStyle(`${briefCover} doc-title`, {
  display: 'block',
});

globalStyle(`${briefCover} .doc-title-container`, {
  position: 'relative',
  maxWidth: 'none',
  margin: 0,
  padding: 0,
  fontFamily: 'var(--affine-font-serif-family)',
  fontSize: 'clamp(36px, 5vw, 52px)',
  fontWeight: 600,
  lineHeight: 1.15,
  overflowWrap: 'anywhere',
  '@media': {
    print: {
      fontSize: 40,
    },
  },
});

globalStyle(`${briefCover} .doc-title-container-empty::before`, {
  content: '"Untitled"',
});
