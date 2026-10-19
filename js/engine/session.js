// One signed-in device per person. A device claims `sessions/<email>` when someone signs in and
// the database refuses a second device while the first one holds it. The first device lets go by
// signing out (it marks the record released) or when the Admin resets it. Silence never frees it:
// a site engineer may be offline for a day or two and must find their session still theirs. The
// Admin is never locked. It is a house rule for people working on site, not a defence against the
// account owner: firestore.rules enforces the same lines.

export const HEARTBEAT_MS = 60 * 1000;   // keeps "last seen" fresh for the Admin; it never frees a session

export const sessionPath = email => `sessions/${email}`;

/** A short name for the device from its browser string, for the message on the other device. */
export function deviceName(ua = '') {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone or iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'a device';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'a browser';
  return `${browser} on ${os}`;
}

/** What this device may do about the record on file. */
export function decide(rec, deviceId, now) {
  if (!rec) return { action: 'claim' };
  if (rec.deviceId === deviceId) return { action: 'resume' };
  if (rec.released) return { action: 'claim' };
  return { action: 'blocked', by: rec };
}

/** The record is no longer ours: another device took it, or the Admin reset it. */
export const isEnded = (rec, token) => !rec || rec.token !== token || rec.released === true;

const randomToken = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
export const newDeviceId = randomToken;

const denied = err => /permission/i.test(`${err?.code} ${err?.message}`);

/**
 * Try to become the one signed-in device of `email`. `db` offers get(path) and set(path, data).
 * Resolves { ok: true, record } or { ok: false, by } (someone else holds it), and never throws:
 *   unchecked  the database has no rules for sessions yet, so nobody is locked out by a missing rule
 *   pending    the database could not be reached; the device carries on and is checked when it is back
 */
export async function claim(db, { email, deviceId, device, token = '', now = Date.now() }) {
  const path = sessionPath(email);
  let rec;
  try {
    rec = await db.get(path);
  } catch (err) {
    return denied(err) ? { ok: true, unchecked: true } : { ok: true, pending: true };
  }
  const verdict = decide(rec, deviceId, now);
  if (verdict.action === 'blocked') return { ok: false, by: verdict.by };
  const record = verdict.action === 'resume' && rec.token && !rec.released
    ? { ...rec, device, lastSeen: now }
    : { email, deviceId, device, token: token || randomToken(), startedAt: now, lastSeen: now, released: false };
  try {
    await db.set(path, record);
  } catch (err) {
    if (!denied(err)) return { ok: true, pending: true };
    // another device wrote first: the database refused the second write
    let now2;
    try { now2 = await db.get(path); } catch { return { ok: true, unchecked: true }; }
    const again = decide(now2, deviceId, now);
    return again.action === 'blocked' ? { ok: false, by: again.by } : { ok: true, unchecked: true };
  }
  return { ok: true, record };
}

/** "Chrome on Android, since 14 Oct 08:10, last seen 2 hours ago", for the Admin and for the blocked device. */
export function describe(rec, now = Date.now()) {
  if (!rec) return '';
  const when = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const ago = ms => {
    const m = Math.max(0, Math.round((now - ms) / 60000));
    return m < 2 ? 'just now' : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
  };
  return `${rec.device || 'a device'}, since ${when(+rec.startedAt || 0)} UTC, last seen ${ago(+rec.lastSeen || 0)}`;
}
