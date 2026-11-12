// 2.11.0 (release 2, the report PDF): what goes where, as plain data, so the layout rules are tested in node.
// The top boxes and their red states, the manpower rows by tier and the equipment order.

import { totals } from './crew.js';

const sum = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** The four boxes at the top, in order: { key, title, value, label, red } (Attention has its own red box under them). */
export function topBoxes(r) {
  const s = r.safety || {}, st = r.start || {};
  const t = totals(r.crew, st.start, st.end);
  const near = !!(s.incident && s.kind === 'Near miss');
  const incident = !!(s.incident && s.kind !== 'Near miss');
  const yes = v => (v ? 'Yes' : 'No');
  return [
    { key: 'manpower', title: 'Manpower', value: String(t.present), label: 'Present', red: false },
    { key: 'equipment', title: 'Equipment', value: String(sum(r.equipment || [], e => e.qty)), label: 'On site', red: false },
    { key: 'near', title: 'Near miss', value: yes(near), label: near ? 'Reported' : 'None', red: near },
    { key: 'incident', title: 'Incident', value: yes(incident), label: incident ? s.kind || 'Reported' : 'None', red: incident },
  ];
}

/** The tier of a trade or position (Shared prompt: T1 management to T5 security); labourers last within T4. */
export function tierOf(trade) {
  const t = String(trade || '').toLowerCase();
  if (/general manager|\bgm\b|ceo|owner|board/.test(t)) return 1;
  if (/project (engineer|manager|coordinator)|accountant|\bhr\b/.test(t)) return 2;
  if (/engineer|architect|draft|\bqs\b|quantity|procurement|logistic|foreman|supervis|hse/.test(t)) return 3;
  if (/security|guard/.test(t)) return 5;
  return /labou?r/.test(t) ? 4.5 : 4;
}

/** Manpower rows (trade, qty, man-hours) by tier, top to bottom; the same tier keeps the larger crew first. */
export function manpowerRows(r) {
  const st = r.start || {};
  return totals(r.crew, st.start, st.end).byTrade.slice().sort((a, b) => tierOf(a.trade) - tierOf(b.trade) || b.qty - a.qty);
}

const EQ_ORDER = { Active: 0, Idle: 1, Breakdown: 2 };
/** Equipment: active first, then idle, then down. */
export const equipmentRows = r => (r.equipment || []).slice().sort((a, b) => (EQ_ORDER[a.status] ?? 1) - (EQ_ORDER[b.status] ?? 1));

/** Which body sections have something to show (an empty one is left out of the PDF). */
export function sectionsOf(r, { progress = [], plan = [], requests = [] } = {}) {
  const s = r.safety || {};
  return {
    progress: progress.length > 0,
    plan: plan.length > 0,
    delays: (r.delays || []).length > 0,
    materials: (r.received || []).length > 0,
    requests: requests.length > 0,
    manpower: manpowerRows(r).length > 0,
    equipment: (r.equipment || []).length > 0,
    safety: !!s.toolbox || !!s.incident,
    notes: !!String(r.notes || '').trim(),
    instructions: !!String(r.instructions || '').trim(),
  };
}

/**
 * 2.96.0 (owner R7, layout A): the PDF's progress chart. Each task of Central Hub's schedule (setup.tasks, still open,
 * and setup.finished, done) against its total amount of work: done before today and done today (this report's work
 * items against the task). A task kept in percent has a total of 100 and the unit '%'.
 */
export function progressRows(setup = {}, items = []) {
  const today = new Map();
  for (const i of items || []) if (i && i.taskId && Number(i.qty) > 0) today.set(i.taskId, (today.get(i.taskId) || 0) + Number(i.qty));
  const row = (t, done) => {
    const pct = !(Number(t.total) > 0), total = pct ? 100 : Number(t.total);
    const before = Math.min(total, Math.max(0, Number(done) || 0));
    return { name: String(t.name || ''), unit: pct ? '%' : String(t.unit || ''), total, before, now: Math.min(total - before, today.get(t.id) || 0) };
  };
  return [
    ...((setup || {}).finished || []).filter(t => t && t.name).map(t => row(t, Number(t.total) > 0 ? t.total : 100)),
    ...((setup || {}).tasks || []).filter(t => t && t.name).map(t => row(t, t.done)),
  ];
}

/**
 * 2.99.0 (owner, 12 Nov: "add option to select the pictures to send to the client. the total picture should be 12. all
 * the rest pictures taken should be shared to office and in dashboard"): with 12 photos or fewer, all go to the client;
 * with more, the 12 ticked "For client". `pick` is the list the PE or GM set in Central Hub before approval; it wins.
 * With nothing ticked (an older report) 12 are spread over the day.
 */
export const CLIENT_PHOTOS = 12;
export function spreadIds(ids, n = CLIENT_PHOTOS) {
  if (ids.length <= n) return [...ids];
  return Array.from({ length: n }, (_, i) => ids[Math.round((i * (ids.length - 1)) / (n - 1))]);
}
export function clientIds(photos = [], pick = null) {
  const ids = photos.map(p => p.id);
  // 3.0.2: a report from before the exact-12 rule with 12 or fewer photos and nothing ticked keeps them all
  if (ids.length <= CLIENT_PHOTOS && !photos.some(p => p.client) && !Array.isArray(pick)) return ids;
  const chosen = Array.isArray(pick) ? pick : photos.filter(p => p.client).map(p => p.id);
  const keep = ids.filter(id => chosen.includes(id));
  return keep.length ? keep.slice(0, CLIENT_PHOTOS) : spreadIds(ids);
}
/**
 * 3.0.2 (owner, 12 Nov: "Only 12 photos should be selected in the pdf for the client for the pdf to finalize. Reject any
 * amount more or less than 12"): what still stops the report. { take: photos still to take, tick: still to tick,
 * untick: too many ticked }; all 0 = exactly 12 chosen.
 */
export function clientNeed(photos = []) {
  const n = photos.filter(p => p.client).length;
  return { take: Math.max(0, CLIENT_PHOTOS - photos.length), tick: Math.max(0, CLIENT_PHOTOS - n), untick: Math.max(0, n - CLIENT_PHOTOS) };
}
/** The line that stops the report ('' = exactly 12 chosen). */
export function clientProblem(photos = []) {
  const x = clientNeed(photos), s = k => (k > 1 ? 's' : '');
  if (x.take) return `Take ${x.take} more photo${s(x.take)}: the client's report needs exactly ${CLIENT_PHOTOS}`;
  if (x.untick) return `Untick ${x.untick} photo${s(x.untick)}: exactly ${CLIENT_PHOTOS} go to the client`;
  if (x.tick) return `Choose ${x.tick} more photo${s(x.tick)} for the client (exactly ${CLIENT_PHOTOS})`;
  return '';
}
/** How many more to tick (kept for older callers). */
export const clientLeft = (photos = []) => clientNeed(photos).tick;
