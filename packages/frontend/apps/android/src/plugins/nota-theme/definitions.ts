export interface NotaThemePlugin {
  onThemeChanged(options: { darkMode: boolean }): Promise<void>;
  getSystemNavBarHeight(): Promise<{ height: number }>;
}
