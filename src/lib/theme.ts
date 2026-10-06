// 「設定」画面の配色設定。src/index.css 側は既に :root / [data-theme="dark"] / [data-theme="light"] を
// 想定した変数構成になっているため、ここではdocumentElementのdata-theme属性を切り替えるだけでよい。

export type ThemeChoice = "system" | "light" | "dark";

const SETTINGS_KEY = "factoryslot_app_settings_v1";

interface AppSettings {
  theme: ThemeChoice;
}

const DEFAULT_SETTINGS: AppSettings = { theme: "system" };

export function readAppSettings(): AppSettings {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return DEFAULT_SETTINGS;
    const p = JSON.parse(s);
    const theme: ThemeChoice = p.theme === "light" || p.theme === "dark" ? p.theme : "system";
    return { theme };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme }));
  } catch {
    /* noop */
  }
  applyTheme(theme);
}

export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
