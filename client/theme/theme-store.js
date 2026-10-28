export const THEME_STORAGE_KEY = 'atelie.theme';
const preferences = ['system', 'light', 'dark'];
const normalize = value => preferences.includes(value) ? value : 'system';

// Browser concerns live here; components only consume the provider's public API.
export function createThemeStore(browser = window) {
  let media;
  try { media = browser.matchMedia('(prefers-color-scheme: dark)'); } catch { media = null; }
  const read = () => {
    try { return normalize(browser.localStorage.getItem(THEME_STORAGE_KEY)); }
    catch { return 'system'; }
  };
  const resolve = preference => preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
  let snapshot = Object.freeze({ preference: read(), theme: null });
  snapshot = Object.freeze({ ...snapshot, theme: resolve(snapshot.preference) });
  const listeners = new Set();

  const apply = () => {
    const root = browser.document.documentElement;
    root.dataset.theme = snapshot.theme;
    root.dataset.themePreference = snapshot.preference;
    const color = browser.getComputedStyle?.(root).getPropertyValue('--page').trim();
    if (color) browser.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  };
  const update = preference => {
    const theme = resolve(preference);
    if (preference !== snapshot.preference || theme !== snapshot.theme) {
      snapshot = Object.freeze({ preference, theme });
      apply();
      listeners.forEach(listener => listener());
    } else apply();
  };
  const onSystemChange = () => { if (snapshot.preference === 'system') update('system'); };
  const onStorage = event => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) update(normalize(event.newValue));
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setPreference(preference) {
      if (!preferences.includes(preference)) throw new TypeError('Preferência de tema inválida.');
      try {
        if (preference === 'system') browser.localStorage.removeItem(THEME_STORAGE_KEY);
        else browser.localStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch { /* Restricted storage must not prevent changing the theme. */ }
      update(preference);
    },
    start() {
      browser.addEventListener('storage', onStorage);
      media?.addEventListener('change', onSystemChange);
      update(read());
      return () => {
        browser.removeEventListener('storage', onStorage);
        media?.removeEventListener('change', onSystemChange);
      };
    },
  };
}
