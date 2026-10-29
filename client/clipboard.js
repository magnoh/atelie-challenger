// Prefer the secure API. The legacy fallback supports the HTTP demo deployment.
export async function copyText(text, browser = window) {
  if (browser.isSecureContext && browser.navigator.clipboard?.writeText) {
    try { await browser.navigator.clipboard.writeText(text); return true; } catch { /* Try the HTTP-compatible fallback. */ }
  }
  const doc = browser.document, previousFocus = doc.activeElement;
  const field = doc.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  doc.body.appendChild(field);
  try {
    field.select();
    return doc.execCommand?.('copy') === true;
  } catch { return false; }
  finally { field.remove(); previousFocus?.focus({ preventScroll: true }); }
}
