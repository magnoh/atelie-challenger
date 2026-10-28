import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createThemeStore, THEME_STORAGE_KEY } from '../client/theme/theme-store.js';

function browser({ saved = null, dark = false, blocked = false } = {}) {
  const windowEvents = new Map(), mediaEvents = new Map();
  const events = map => ({
    addEventListener: (type, handler) => map.set(type, handler),
    removeEventListener: (type, handler) => { if (map.get(type) === handler) map.delete(type); },
  });
  const media = { matches: dark, ...events(mediaEvents) };
  const localStorage = {
    getItem() { if (blocked) throw Error('blocked'); return saved; },
    setItem(key, value) { if (blocked) throw Error('blocked'); saved = value; },
    removeItem() { if (blocked) throw Error('blocked'); saved = null; },
  };
  return {
    ...events(windowEvents), localStorage,
    document: { documentElement: { dataset: {} }, querySelector: () => null },
    matchMedia: () => media,
    system(value) { media.matches = value; mediaEvents.get('change')?.(); },
    storage(value, key = THEME_STORAGE_KEY) { saved = value; windowEvents.get('storage')?.({ key, newValue: value }); },
  };
}

test('system preference follows OS changes and applies the DOM theme', () => {
  const b = browser({ dark: true }), store = createThemeStore(b);
  const stop = store.start();
  assert.deepEqual(store.getSnapshot(), { preference: 'system', theme: 'dark' });
  b.system(false);
  assert.equal(b.document.documentElement.dataset.theme, 'light');
  stop();
  b.system(true);
  assert.equal(store.getSnapshot().theme, 'light');
});

test('manual preference persists, overrides OS, and can return to system', () => {
  const b = browser({ saved: 'light', dark: true }), store = createThemeStore(b);
  store.start();
  assert.equal(store.getSnapshot().theme, 'light');
  store.setPreference('dark');
  assert.equal(b.localStorage.getItem(THEME_STORAGE_KEY), 'dark');
  b.system(false);
  assert.equal(store.getSnapshot().theme, 'dark');
  store.setPreference('system');
  assert.equal(b.localStorage.getItem(THEME_STORAGE_KEY), null);
  assert.equal(store.getSnapshot().theme, 'light');
});

test('cross-tab changes and cleared storage synchronize preferences', () => {
  const b = browser(), store = createThemeStore(b);
  store.start();
  b.storage('dark');
  assert.equal(store.getSnapshot().theme, 'dark');
  b.storage(null, null);
  assert.equal(store.getSnapshot().preference, 'system');
  b.storage('invalid');
  assert.equal(store.getSnapshot().preference, 'system');
});

test('restricted storage does not prevent theme selection', () => {
  const b = browser({ blocked: true, dark: true }), store = createThemeStore(b);
  store.start();
  store.setPreference('light');
  assert.equal(store.getSnapshot().theme, 'light');
  assert.throws(() => store.setPreference('invalid'), TypeError);
});

test('React snapshot stays stable and subscriptions clean up', () => {
  const store = createThemeStore(browser());
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  const first = store.getSnapshot();
  store.setPreference('system');
  assert.equal(store.getSnapshot(), first);
  assert.equal(calls, 0);
  store.setPreference('dark');
  assert.equal(calls, 1);
  unsubscribe();
  store.setPreference('light');
  assert.equal(calls, 1);
});

test('pre-render script agrees with store for saved, system and blocked storage', () => {
  const source = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  for (const options of [{ saved: 'dark' }, { saved: 'light', dark: true }, { dark: true }, { blocked: true, dark: true }, { saved: 'invalid' }]) {
    const b = browser(options);
    runInNewContext(source, { window: b, document: b.document, localStorage: b.localStorage });
    assert.equal(b.document.documentElement.dataset.theme, createThemeStore(b).getSnapshot().theme);
  }
});

test('both palettes meet AA contrast for primary text and status messages', () => {
  const css = readFileSync(new URL('../client/theme/tokens.css', import.meta.url), 'utf8');
  const luminance = hex => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const selector of [':root', ':root[data-theme="dark"]']) {
    const block = css.slice(css.indexOf(selector)).split('{')[1].split('}')[0];
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]+)/gi)].map(m => [m[1], m[2]]));
    for (const [fg, bg] of [['text', 'page'], ['text', 'surface'], ['muted', 'surface'], ['on-accent', 'accent'], ['success-text', 'success-bg'], ['danger-text', 'danger-bg'], ['info-text', 'info-bg'], ['badge-text', 'badge-bg']]) {
      const a = luminance(tokens[fg]), b = luminance(tokens[bg]);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${selector}: ${fg}/${bg}`);
    }
  }
});
