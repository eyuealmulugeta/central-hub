// Central Hub backup: pushes a file to Google Drive through the Apps Script web app (Code.gs).
// The endpoint and shared secret are kept in this browser only.

const KEY = 'sf:drive';

export const driveConfig = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  set(cfg) { localStorage.setItem(KEY, JSON.stringify(cfg)); },
};

const toBase64 = text => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** `opts.folder` "2026/11/MJO" puts the file in that folder (v0.51.0, made when missing); `opts.pdf` keeps an HTML page as a PDF. */
export const saveToDrive = (name, text, mimeType = 'application/json', opts = {}) => saveBase64(name, toBase64(text), mimeType, opts);

/** The same for a file already read as base64 (a PDF or photo chosen on this computer). */
export async function saveBase64(name, dataBase64, mimeType, { folder = '', pdf = false } = {}) {
  const { endpoint, token } = driveConfig.get();
  if (!endpoint || !token) throw new Error('Enter the web app URL and shared secret first');
  const res = await fetch(endpoint, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script cannot answer
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, name, mimeType, dataBase64, ...(folder ? { folder } : {}), ...(pdf ? { pdf: true } : {}) }),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'Drive upload failed');
  return out;
}
