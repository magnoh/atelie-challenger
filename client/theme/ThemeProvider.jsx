import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createThemeStore } from './theme-store';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [store] = useState(() => createThemeStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  const value = useMemo(() => ({ ...snapshot, setPreference: store.setPreference }), [snapshot, store]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme deve ser usado dentro de ThemeProvider.');
  return theme;
}
