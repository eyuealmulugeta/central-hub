// Small per-person settings that should follow the person to every device: what they marked as read.
// Kept in this browser (the fast copy) and, when signed in, in prefs/<email>, which only that person may read
// or write. Values are merged both ways: a list keeps what either side has, a number map keeps the larger count.

const DOC = email => `prefs/${email}`;
let api = null;
let email = '';
let cache = {};
let timer = null;

const readLocal = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } };

/** What two copies of one setting become together. Pure. */
export function mergePref(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  if (Array.isArray(a) && Array.isArray(b)) return [...new Set([...a, ...b])];
  if (typeof a === 'object' && typeof b === 'object') {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = typeof v === 'number' && typeof out[k] === 'number' ? Math.max(v, out[k]) : v;
    return out;
  }
  return b;
}

/** The saved document holds a list of [key, value] pairs: keys such as "sf:seen:p1" are not used as field names. */
export const toDoc = map => ({ items: Object.entries(map).map(([k, v]) => [k, JSON.stringify(v)]), at: Date.now() });
export function fromDoc(doc) {
  const out = {};
  for (const [k, v] of doc?.items || []) { try { out[k] = JSON.parse(v); } catch { /* a damaged entry is skipped */ } }
  return out;
}

export const prefs = {
  /** After signing in: bring the person's saved copy into this browser, and this browser's into it. */
  attach(adapter, who, doc) {
    api = adapter; email = who;
    cache = fromDoc(doc);
    for (const [k, v] of Object.entries(cache)) { const both = mergePref(readLocal(k), v); cache[k] = both; writeLocal(k, both); }
  },
  detach() { clearTimeout(timer); api = null; email = ''; cache = {}; },
  get(key) { return readLocal(key); },
  /** Saves at once in this browser; to the account a moment later, all changes together. A refusal leaves the browser copy. */
  set(key, value) {
    writeLocal(key, value);
    if (!api || !email) return;
    cache[key] = value;
    clearTimeout(timer);
    timer = setTimeout(() => { api.set(DOC(email), toDoc(cache)).catch(() => { /* rules not published yet, or offline: the browser keeps it */ }); }, 1500);
  },
};
export const prefsPath = DOC;
