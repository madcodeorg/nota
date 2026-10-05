import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const banner = style({
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(680px, calc(100vw - 32px))',
  padding: 16,
  borderRadius: 12,
  border: `1px solid ${cssVar('borderColor')}`,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  boxShadow: cssVar('shadow3'),
  zIndex: 1000,
});
export const description = style({ margin: '8px 0', fontSize: 14 });
export const detail = style({
  margin: '8px 0',
  fontSize: 12,
  color: cssVar('textSecondaryColor'),
  overflowWrap: 'anywhere',
});
export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
