import { registerPlugin } from '@capacitor/core';

import type { NotaThemePlugin } from './definitions';

const NotaTheme = registerPlugin<NotaThemePlugin>('NotaTheme');

export * from './definitions';
export { NotaTheme };
