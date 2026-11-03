// v0.67.0 (owner, 3 Nov, Phase D2): the monthly summary of the Field Report ratings. Field Report rates each daily
// report out of 5 (photo times, data strength, engagement, grammar; Field Report 2.18.0 and later); Central Hub keeps
// it on the report (field.rating). Per person who wrote the reports and per month: the average, the days rated and the
// change against the month before. A hint beside the evaluation; it never fills the evaluation in. Pure functions.

export const PARTS = { photos: 'Photo times', data: 'Data strength', engage: 'Engagement', grammar: 'Grammar' };

const low = s => String(s || '').trim().toLowerCase();
const avg = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null);

/** The rating Field Report sent with a report, as Central Hub keeps it. */
export function ratingOf(meta) {
  const v = +meta?.v;
  if (!meta || !Number.isFinite(v)) return null;
  return { v, ...Object.fromEntries(Object.keys(PARTS).filter(k => Number.isFinite(+meta[k])).map(k => [k, +meta[k]])) };
}

/** The month before 'YYYY-MM'. */
export const prevMonth = m => { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; };

const rated = (reports, month) => (reports || []).filter(r => r.source === 'field' && r.review !== 'pending' && r.field?.rating && String(r.date).startsWith(month));
const whoOf = r => r.by || r.field?.preparedBy || 'Site';
const summary = list => list.length ? {
  v: avg(list.map(r => r.field.rating.v)), days: new Set(list.map(r => r.date)).size,
  parts: Object.fromEntries(Object.keys(PARTS).map(k => [k, avg(list.map(r => r.field.rating[k]).filter(Number.isFinite))])),
} : null;

/** One person's month: average, days rated, the four parts, and the change against the month before. */
export function monthRating(reports, person, month) {
  const names = [person?.name, person?.email].filter(Boolean).map(low);
  const mine = m => rated(reports, m).filter(r => names.includes(low(whoOf(r))));
  const now = summary(mine(month));
  if (!now) return null;
  const before = summary(mine(prevMonth(month)));
  return { ...now, prev: before?.v ?? null, trend: before ? Math.round((now.v - before.v) * 10) / 10 : null };
}

/** Everyone who wrote rated reports on a project in a month, best first: to compare the crews. */
export function monthTable(reports, month) {
  const by = new Map();
  for (const r of rated(reports, month)) by.set(low(whoOf(r)), [...(by.get(low(whoOf(r))) || []), r]);
  return [...by.values()].map(list => {
    const name = whoOf(list[0]);
    return { name, ...monthRating(reports, { name }, month) };
  }).sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
}
