// v0.91.0 (owner, 5 Nov, R1): the executive Home page (design "Option A revised"). Pure helpers: what each box shows,
// and which boxes have something to show. A box with nothing in it is left out and the page closes up.

import { tierOfPosition, normRole, ROLES } from './positions.js';

import { summarise } from './evaluation.js';
import { convert } from './pricing.js';

/** Seniority behind the scenes: the position's level, then its place in the list of positions. Never shown. */
const seniority = role => { const w = normRole(role).toLowerCase(), i = ROLES.findIndex(x => x.toLowerCase() === w); return (tierOfPosition(role) || 9) * 1000 + (i < 0 ? 999 : i); };

/** Box keys in their rows: the wide row, the three small boxes, the bottom row, the planning row. */
// v0.94.0 (owner, 5 Nov): the fixed Dashboard of design A revised; This week and Waiting on others are not on it
export const ROWS = [['today', 'money'], ['action', 'spot', 'requests'], ['book', 'people']];

/** v0.92.0: every box in its usual order, and the names the Arrange list shows. */
export const BOXES = ROWS.flat();
export const BOX_LABELS = { today: 'Today at a glance', money: 'Financials & progress', action: 'Needs your action', spot: 'Spotlight', requests: 'Site requests', book: 'Signed site book', people: 'On site now' };
export const HOME_ORDER = 'sf:homeOrder';
/** The boxes in the person's order (boxes they never placed keep their usual place after). */
export const boxOrder = (order = []) => [...order.filter(k => BOXES.includes(k)), ...BOXES.filter(k => !order.includes(k))];
/** Rows for that order: a wide row of two, a row of three small boxes, then rows of two. The usual order gives ROWS. */
export function rowsFor(order = []) {
  const keys = boxOrder(order), out = [];
  for (const n of [2, 3, 2]) out.push(keys.splice(0, n));
  return out.filter(r => r.length);
}

/** The rows with only the boxes that have something to show; an empty row is dropped. */
export const rowsOf = (has, rows = ROWS) => rows.map(r => r.filter(k => has[k])).filter(r => r.length);

/** Today's site photos from the field reports, taken with the camera (an office upload from the gallery is left out). */
export function todayMedia(reports = [], today) {
  return reports.filter(r => r.source === 'field' && r.date === today && r.field?.pdf)
    .flatMap(r => (r.field.photoFiles || []).filter(p => p && p.id && !p.gallery).map(p => ({ r, p })))
    .sort((a, b) => String(b.p.time || '').localeCompare(String(a.p.time || '')));
}

/**
 * v0.94.0: the day the photo box shows: today when today has photos or videos, else the latest day that has some
 * (the site may not have sent today's report yet). Returns { day, photos, videos } with photos newest first.
 */
export function latestMedia(reports = [], videos = [], today) {
  const days = new Set([...todayDays(reports), ...videos.map(v => v.date).filter(Boolean)]);
  const day = days.has(today) ? today : [...days].filter(d => d <= today).sort().pop() || '';
  return { day, photos: day ? todayMedia(reports, day) : [], videos: videos.filter(v => v.date === day).sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))) };
}
const todayDays = reports => reports.filter(r => r.source === 'field' && r.field?.pdf && (r.field.photoFiles || []).some(p => p && p.id && !p.gallery)).map(r => r.date);

/** v1.24.0 (owner, "A Revised"): the last day a video is kept (30 days after it was taken), '' once saved for good. */
export const keptUntil = v => (v.kept || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || '') ? '' : new Date(Date.parse(`${v.date}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10));
/** The viewer's list: videos first, then photos, as { kind, key | fileId, label }. */
export const viewerItems = (proj, photos, videos) => [
  ...videos.map(v => ({ kind: 'video', id: v.id, proj, fileId: v.fileId, kept: !!v.kept, until: keptUntil(v), label: [v.time, v.gal ? 'Video from gallery' : 'Video', v.byName].filter(Boolean).join(' · ') })),
  ...photos.map(({ r, p }) => ({ kind: 'photo', key: `${proj}|${r.field.pdf}|${p.id}`, label: [p.time, p.zone || p.task, p.caption].filter(Boolean).join(' · ') })),
];

/** v0.95.0 (owner, 5 Nov): the days of this week, Monday to Sunday, as YYYY-MM-DD. */
export function weekDays(today) {
  const t = new Date(`${today}T00:00:00Z`), back = (t.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(t.getTime() + (i - back) * 864e5).toISOString().slice(0, 10));
}
/** The photos the site sent for a day before its report is posted (script dayPhotos), in the shape of a report's photos. */
export const livePhotos = (list = []) => list.filter(x => x && x.id && x.report)
  .map(x => ({ r: { field: { pdf: x.report } }, p: { id: x.id, time: x.time, caption: x.caption, zone: x.zone, task: x.task } }));
/** The next place in a list of n, going round at either end. */
export const stepIn = (i, d, n) => (n ? ((i + d) % n + n) % n : 0);

const PENDING = ['requested', 'gm'], APPROVED = ['approved'], TRANSIT = ['arranging'];

/** Site requests by stage: Pending, Approved, In transit (being arranged); with the next ones to watch. */
export function requestBoard(requests = []) {
  const list = requests.filter(r => !['draft', 'deleted'].includes(r.status));
  const of = st => list.filter(r => st.includes(r.status));
  const stage = r => (TRANSIT.includes(r.status) ? 'transit' : APPROVED.includes(r.status) ? 'approved' : 'pending');
  const lines = [...of(TRANSIT), ...of(PENDING), ...of(APPROVED)]
    .sort((a, b) => String(a.neededBy || '9999').localeCompare(String(b.neededBy || '9999')))
    .map(r => ({ r, stage: stage(r) }));
  const pending = of(PENDING).length, approved = of(APPROVED).length, transit = of(TRANSIT).length;
  return { pending, approved, transit, open: pending + approved + transit, lines };
}

/** The money still asked for: expenses waiting for approval or approved but not paid, in the project's currency. */
export const requestedAmount = (requests = [], currency, fx) => requests
  .filter(r => r.kind === 'expense' && [...PENDING, ...APPROVED].includes(r.status) && +r.amount > 0)
  .reduce((s, r) => s + (fx ? convert(+r.amount, r.currency || currency, currency, fx) : +r.amount), 0);

/** Budget split into Paid, Requested and Remaining, as amounts and whole percentages of the budget. */
export function moneySplit({ budget = 0, spent = 0, requested = 0 }) {
  const b = Math.max(0, +budget || 0);
  if (!b) return null;
  const paid = Math.max(0, +spent || 0), asked = Math.max(0, +requested || 0);
  const remaining = Math.max(0, b - paid - asked);
  const pct = v => Math.round(Math.min(100, v / b * 100));
  return { budget: b, paid, requested: asked, remaining, paidPct: pct(paid), requestedPct: pct(asked), remainingPct: pct(remaining), over: paid + asked > b };
}

/** Signed site book: the latest instructions sent to the consultant (not drafts), newest first. */
export const bookLog = (list = [], n = 3) => list.filter(x => x.status && x.status !== 'draft')
  .sort((a, b) => String(b.consultant?.at || b.sentAt || b.date || '').localeCompare(String(a.consultant?.at || a.sentAt || a.date || '')))
  .slice(0, n);

/**
 * Who is on site today: present in today's field report. Most senior first (by position, behind the scenes; the
 * level is never shown), then by name. Stars from the latest evaluation, else the feedback notes, when allowed.
 */
export function onSite({ reports = [], team = [], staff = [], evaluations = null, today }) {
  const r = reports.find(x => x.date === today && (x.field?.attendance || []).length);
  if (!r) return [];
  const seen = new Set();
  return r.field.attendance.filter(a => (a.state || 'present') === 'present').map(a => {
    const m = team.find(t => t.id && t.id === a.id) || team.find(t => t.name && t.name === a.name) || {};
    const role = m.role || a.trade || a.role || '';
    const person = staff.find(s => s.id && (s.id === m.personId || s.id === m.staffId));
    let stars = null;
    if (evaluations && m.id) {
      const s = summarise(evaluations, m.id);
      stars = s.latest?.overall ?? s.stars ?? null;
    }
    return { key: m.id || a.id || a.name, name: m.name || a.name || 'Unnamed', role, photo: String(person?.photo || '').length > 200 ? person.photo : '', rank: seniority(role), stars: stars == null || Number.isNaN(stars) ? null : Math.round(stars * 2) / 2 };
  }).filter(p => !seen.has(p.key) && seen.add(p.key))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
