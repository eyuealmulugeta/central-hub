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

export async function saveToDrive(name, text, mimeType = 'application/json') {
  const { endpoint, token } = driveConfig.get();
  if (!endpoint || !token) throw new Error('Enter the web app URL and shared secret first');
  const res = await fetch(endpoint, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script cannot answer
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, name, mimeType, dataBase64: toBase64(text) }),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'Drive upload failed');
  return out;
}
