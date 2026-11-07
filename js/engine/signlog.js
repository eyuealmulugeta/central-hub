// v0.98.0 (owner, 7 Nov, Phase G2): sign-in history of Central Hub and Field Report, like the Bete app.
// One record per session in signlog/<id>: who (email, name, position, projects), app (CH / FR), device, installed
// app or browser, start, last seen (every minute while the app is open and in front), end (signed out) and the
// approximate place (filled by the server function signPlace from the caller's IP). A session is over when it was
// signed out, or when it has not been seen for STALE_MS (the app was closed or put away): it ends at its last time.
// Read by the Admin and Tier 1 (GM, Owner, CEO, Board); kept 12 months.

export const BEAT_MS = 60 * 1000;
export const STALE_MS = 3 * 60 * 1000;
export const KEEP_DAYS = 365;
export const TOP_RANKS = ['general_manager', 'owner', 'ceo', 'board_member'];
export const APPS = { CH: 'Central Hub', FR: 'Field Report' };

/** Who opens Sign-in history: the Admin and Tier 1. */
export const seesSignins = (role, ranks = []) => role === 'owner' || (ranks || []).some(r => TOP_RANKS.includes(r));

const rand = () => Math.random().toString(36).slice(2, 8);
export const entryId = (app, now) => `${app}_${now.toString(36)}_${rand()}`;

/** A new session record (the shape firestore.rules accepts). */
export function newEntry({ app, email, name = '', position = '', projects = [], device = '', mode = '', now = Date.now(), id }) {
  return {
    id: id || entryId(app, now), app, email: String(email || '').toLowerCase(), name: String(name || '').slice(0, 80), position: String(position || '').slice(0, 60),
    projects: (projects || []).map(String).slice(0, 20), device: String(device || '').slice(0, 80), mode: mode === 'app' || mode === 'browser' ? mode : '',
    start: now, last: now, end: 0, how: '', act: 0,
  };
}

/**
 * v1.7.0 (owner, 7 Nov, G3): active minutes. Each minute the app is in front counts only when the person tapped, typed or
 * scrolled in the last IDLE_MS; a session kept open without use does not add up. Sessions from before have no act.
 */
export const IDLE_MS = 5 * 60 * 1000;
export const activeOf = (e, now) => (e.act != null ? Math.min(+e.act || 0, minutesOf(e, now)) : minutesOf(e, now));
/** The input clock of one page: busy(now) says whether the person used it in the last IDLE_MS. */
export function inputClock(doc, start = Date.now()) {
  let at = start;
  const mark = () => { at = Date.now(); };
  if (doc && doc.addEventListener) for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) doc.addEventListener(ev, mark, { passive: true, capture: true });
  return { busy: now => now - at < IDLE_MS, mark };
}

/** Is this session still going (seen in the last few minutes, not signed out)? */
export const isOnline = (e, now) => !e.end && now - (+e.last || 0) < STALE_MS;
/** When it ended: signed out, or its last time once it went quiet; 0 while it goes on. */
export const endOf = (e, now) => (e.end ? +e.end : isOnline(e, now) ? 0 : +e.last || +e.start);
/** Minutes of one session (up to now while it goes on). */
export const minutesOf = (e, now) => Math.max(0, Math.round(((endOf(e, now) || now) - (+e.start || 0)) / 60000));

const dayOf = ms => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);   // Addis Ababa time (UTC+3)
export const day = dayOf;

/** One row per person and day: { day, email, name, position, projects, apps, sessions, minutes, first, last, online }. */
export function perDay(list, now) {
  const m = new Map();
  for (const e of list || []) {
    const k = `${dayOf(+e.start)}|${e.email}`;
    const r = m.get(k) || { day: dayOf(+e.start), email: e.email, name: e.name || e.email, position: e.position || '', projects: new Set(), apps: new Set(), sessions: 0, minutes: 0, first: +e.start, last: 0, online: false };
    (e.projects || []).forEach(p => r.projects.add(p));
    r.apps.add(e.app); r.sessions++; r.minutes += minutesOf(e, now); r.active = (r.active || 0) + activeOf(e, now);
    r.first = Math.min(r.first, +e.start); r.last = Math.max(r.last, endOf(e, now) || now); r.online ||= isOnline(e, now);
    if (e.name) r.name = e.name; if (e.position) r.position = e.position;
    m.set(k, r);
  }
  return [...m.values()].map(r => ({ ...r, projects: [...r.projects], apps: [...r.apps] }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.minutes - a.minutes);
}

/** The people online now, one row each (their newest session). */
export function onlineNow(list, now) {
  const m = new Map();
  for (const e of list || []) if (isOnline(e, now) && (!m.has(e.email) || +m.get(e.email).last < +e.last)) m.set(e.email, e);
  return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** "2 h 05 min" */
export const hm = min => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`);

/**
 * The presence loop of one app: a session starts when the app is in front and signed in, is kept fresh every minute,
 * and a new one starts after the app was away longer than STALE_MS. io: { create(entry), touch(id, last), close(id, end),
 * place(id) }. Returns { tick(now), hide(now), signOut(now), current() }.
 */
export function presence(make, io, busy = null) {
  let cur = null;
  return {
    tick(now = Date.now()) {
      if (!cur || now - cur.last > STALE_MS) {
        cur = make(now);
        Promise.resolve(io.create(cur)).then(() => io.place && io.place(cur.id)).catch(() => {});
      } else if (now - cur.last >= BEAT_MS - 5000) {
        if (busy && busy(now)) cur.act = (cur.act || 0) + 1;   // v1.7.0 (G3)
        cur.last = now; Promise.resolve(io.touch(cur.id, now, cur.act)).catch(() => {});
      }
    },
    hide(now = Date.now()) { if (cur && now - cur.last <= STALE_MS) { cur.last = now; Promise.resolve(io.touch(cur.id, now)).catch(() => {}); } },
    async signOut(now = Date.now()) { const c = cur; cur = null; if (c) await Promise.resolve(io.close(c.id, now)).catch(() => {}); },
    current: () => cur,
  };
}
