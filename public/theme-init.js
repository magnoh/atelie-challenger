// A blocking, same-origin script applies the theme before CSS and React paint.
// Kept external so the existing script-src 'self' policy remains intact.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('atelie.theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Storage can be unavailable in privacy-restricted browsers. */ }
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference;
})();
