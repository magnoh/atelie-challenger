import React from 'react';
import { useTheme } from './ThemeProvider';
import './theme-switcher.css';

export function ThemeSwitcher() {
  const { preference, theme, setPreference } = useTheme();
  return <label className="theme-switcher">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {theme === 'dark' ? <path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/> : <><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>}
    </svg>
    <span className="sr-only">Tema da interface</span>
    <select value={preference} onChange={event => setPreference(event.target.value)}>
      <option value="system">Sistema</option>
      <option value="light">Claro</option>
      <option value="dark">Escuro</option>
    </select>
  </label>;
}
