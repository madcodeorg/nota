import { cssVar } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';

export const briefCover = style({
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '72px minmax(0, 920px) 72px',
  justifyContent: 'center',
  alignItems: 'center',
  columnGap: 16,
  width: '100%',
  minHeight: 430,
  padding: '42px 24px 36px',
  boxSizing: 'border-box',
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  '@media': {
    print: {
      background: 'transparent',
      color: 'inherit',
      minHeight: 'auto',
      padding: 0,
      display: 'block',
    },
    '(max-width: 860px)': {
      gridTemplateColumns: '1fr',
      minHeight: 320,
      padding: '28px 18px 30px',
      background: 'transparent',
      color: '#ebe4d5',
    },
  },
});

export const coverColumn = style({
  width: '100%',
  minWidth: 0,
});

export const coverFrame = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  aspectRatio: '2.18 / 1',
  overflow: 'hidden',
  border: '1px solid rgba(38, 39, 49, 0.1)',
  borderRadius: 12,
  background: cssVar('backgroundPrimaryColor'),
  boxShadow: '0 14px 34px rgba(31, 28, 46, 0.14)',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      pointerEvents: 'none',
      background:
        'linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.22) 38%, rgba(255, 255, 255, 0.86) 70%, var(--affine-background-primary-color) 100%)',
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      pointerEvents: 'none',
      background:
        'linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 34%, rgba(2, 8, 40, 0.08))',
    },
  },
  '@media': {
    print: {
      aspectRatio: 'auto',
      background: 'transparent !important',
      boxShadow: 'none',
      overflow: 'visible',
    },
    '(max-width: 860px)': {
      borderColor: 'rgba(207, 197, 169, 0.18)',
      background: 'rgba(22, 23, 20, 0.84)',
      boxShadow: '0 20px 48px rgba(0, 0, 0, 0.32)',
    },
  },
});

export const coverImage = style({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center 34%',
  zIndex: 0,
  filter: 'saturate(1.02) contrast(1.02)',
  '@media': {
    print: {
      display: 'none',
    },
  },
});

export const coverIcon = style({
  flex: '0 0 auto',
  width: 96,
  minWidth: 96,
  minHeight: 78,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.98,
  '@media': {
    print: {
      display: 'none',
    },
    '(max-width: 860px)': {
      width: 82,
      minWidth: 82,
      minHeight: 60,
    },
  },
});

export const titleStack = style({
  position: 'absolute',
  left: '50%',
  bottom: '13%',
  zIndex: 2,
  display: 'flex',
  width: 'min(88%, 820px)',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  transform: 'translateX(-50%)',
  textAlign: 'left',
  '@media': {
    '(max-width: 860px)': {
      bottom: '12%',
      width: 'min(90%, 560px)',
      gap: 10,
    },
  },
});

const sideLabelBase = {
  color: 'var(--affine-text-primary-color)',
  fontFamily: 'var(--affine-font-serif-family)',
  fontSize: 'clamp(30px, 3.9vw, 48px)',
  fontStyle: 'italic',
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  textShadow: '0 1px 8px rgba(0, 0, 0, 0.18)',
  '@media': {
    print: {
      display: 'none',
    },
    '(max-width: 860px)': {
      position: 'static',
      justifySelf: 'center',
      transform: 'none',
      fontSize: 14,
      fontFamily: 'var(--affine-font-number-family)',
      fontStyle: 'normal',
      fontWeight: 700,
      color: 'rgba(235, 228, 213, 0.52)',
    },
  },
} as const;

export const sideDate = style({
  ...sideLabelBase,
  justifySelf: 'center',
  transform: 'rotate(-90deg)',
});

export const sideTime = style({
  ...sideLabelBase,
  justifySelf: 'center',
  transform: 'rotate(90deg)',
});

globalStyle(`${briefCover} doc-title`, {
  display: 'block',
  flex: '1 1 auto',
  width: 'min(100%, 720px)',
  minWidth: 0,
});

globalStyle(`${briefCover} .doc-title-container`, {
  position: 'relative',
  width: '100%',
  maxWidth: 'none',
  minHeight: '1.08em',
  margin: 0,
  padding: 0,
  color: '#fff227',
  caretColor: '#fff9a8',
  fontFamily: 'var(--affine-font-serif-family)',
  fontSize: 'clamp(34px, 5vw, 58px)',
  fontWeight: 700,
  lineHeight: 1.04,
  overflowWrap: 'anywhere',
  textWrap: 'balance',
  textAlign: 'left',
  textShadow: '0 4px 24px rgba(0, 0, 0, 0.42)',
  '@media': {
    print: {
      color: 'inherit',
      textShadow: 'none',
      fontSize: 40,
      textAlign: 'left',
    },
    '(max-width: 860px)': {
      fontSize: 'clamp(30px, 10vw, 46px)',
      color: '#fff227',
      textShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },
});

globalStyle(`${briefCover} .doc-title-container-empty::before`, {
  content: '"Title"',
  right: 0,
  left: 0,
  color: 'rgba(255, 242, 39, 0.78)',
  opacity: 1,
  textAlign: 'left',
});

globalStyle(`${coverIcon} .doc-icon-container`, {
  width: 78,
  maxWidth: 'none',
  margin: 0,
  padding: '0 !important',
});

globalStyle(`${coverIcon} .doc-icon-container[data-has-icon="false"]`, {
  width: 'auto',
});

globalStyle(`${coverIcon} [data-icon-type="emoji"]`, {
  width: 78,
  height: 78,
  fontSize: 72,
});

globalStyle(`${coverIcon} [data-icon-type="nota-icon"]`, {
  width: 78,
  height: 78,
  fontSize: 72,
});

globalStyle(`${coverIcon} .doc-icon-container[data-has-icon="false"] button`, {
  minWidth: 96,
  height: 36,
  padding: '0 12px',
  borderRadius: 18,
  background: 'rgba(16, 17, 14, 0.34)',
  color: 'rgba(255, 255, 255, 0.84)',
  backdropFilter: 'blur(10px)',
});

globalStyle(`${coverIcon} .doc-icon-container[data-has-icon="false"] svg`, {
  width: 18,
  height: 18,
});

globalStyle(`${coverIcon} .doc-icon-container[data-has-icon="false"] span`, {
  fontSize: 13,
  fontWeight: 650,
});
