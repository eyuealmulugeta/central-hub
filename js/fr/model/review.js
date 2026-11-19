// 2.6.0: the kind of account. A reporter (Site engineer) writes the day's report; a reviewer (Project engineer, Admin)
// approves, sends back and comments, and gives the crew their wages; a viewer only reads. Central Hub's access rules
// decide the rest on the script.

// 2.66.0 (owner): a technician only shares photos of the work done
export const kindOf = role => (role === 'technician' ? 'technician' : role === 'coordinator' || role === 'admin' ? 'reviewer' : role === 'viewer' || role === 'exec' ? 'viewer' : 'reporter');
export const KIND_WORD = { reporter: 'Site', reviewer: 'Approve, send back, comment', viewer: 'View only', technician: 'Share photos from crews' };

// 3.4.0 (owner, 15 Nov): one Review hub: Pending, Approved, Rejected (sent back), Requests (reports with material requests), All
export const REVIEW_FILTERS = [['submitted', 'Pending'], ['approved', 'Approved'], ['changes', 'Rejected'], ['req', 'Requests'], ['', 'All']];
/** The reports of one project, newest first, by status (or 'req'), on one day, and matching a search (number, name, date). */
export const reviewRows = (list, code, f, { day = '', q = '' } = {}) => {
  const t = String(q || '').trim().toLowerCase();
  return (list || []).filter(x => (!code || String(x.name || '').includes(`_${code}_`))
      && (!f || (f === 'req' ? Number(x.requests) > 0 : (x.status || 'submitted') === f))
      && (!day || x.date === day)
      && (!t || [x.no, String(Number(x.no)), x.date, x.preparedBy, x.uploadedBy, x.reviewedBy, x.name].some(v => String(v || '').toLowerCase().includes(t))))
    .sort((a, b) => String(b.date + b.no).localeCompare(String(a.date + a.no)));
};
export const waitingCount = (list, code) => reviewRows(list, code, 'submitted').length;

/** The wages a reviewer gives: each ticked person's typed wage, else the one the site list holds, else their trade's. */
export function crewWages(wait, picks, typed = {}) {
  const out = {};
  for (const x of wait || []) {
    if (!picks[x.id]) continue;
    const t = Number(typed[x.id]), w = t > 0 ? t : Number(x.wage) > 0 ? Number(x.wage) : Number(x.tradeWage) || 0;
    if (w > 0) out[x.id] = w;
  }
  return out;
}

/* ---------- 3.9.0 (owner, 18 Nov): Review by month and week, one month loaded at a time; search by activity or milestone ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const plus = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
/** "2026-11" one month earlier (or later with n > 0). */
export const monthShift = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
export const monthTitle = m => `${MONTH_FULL[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** The ISO week number (weeks run Monday to Sunday). */
export function isoWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z'), day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
/** The Monday of the week of a day. */
export const monday = iso => plus(iso, -((dow(iso) + 6) % 7));
const short = iso => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
/** "Week 47, 16-22 Nov" (the days of the week inside the month). */
export const weekTitle = (w, from, to) => `Week ${w}, ${from === to ? short(to) : from.slice(5, 7) === to.slice(5, 7) ? `${Number(from.slice(8))}-${short(to)}` : `${short(from)}-${short(to)}`}`;
/**
 * The weeks of a month, newest first, each with its reports (newest first) and its counts.
 * opt: { today, nwDow:[0], off:[dates], nowork:[dates], noact:[dates], start (first day a report is due) }; missing counts only working days
 * 3.10.0: a No activity day is not missing; it is counted on its own (noact).
 * before today, from `start`, with no report and no no-work notice. rows: the reports shown (after the filters).
 */
export function monthWeeks(month, rows, all, opt = {}) {
  const today = opt.today || '9999-12-31', last = month === today.slice(0, 7) ? today : plus(monthShift(month, 1) + '-01', -1);
  const first = month + '-01', weeks = [];
  if (last < first) return weeks;
  const sent = new Set((all || []).map(x => x.date)), nw = new Set(opt.nowork || []), na = new Set(opt.noact || []), off = new Set(opt.off || []), nwDow = opt.nwDow || [0];
  for (let mon = monday(last); mon >= monday(first); mon = plus(mon, -7)) {
    const from = mon < first ? first : mon, sun = plus(mon, 6), to = sun > last ? last : sun;
    const inWeek = x => x.date >= from && x.date <= to;
    const mine = (all || []).filter(inWeek);
    let missing = 0, noact = 0;
    for (let d = from; d <= to; d = plus(d, 1)) if (d <= today && (!opt.start || d >= opt.start) && !nwDow.includes(dow(d)) && !off.has(d) && !sent.has(d) && !nw.has(d)) { if (na.has(d)) noact++; else if (d < today) missing++; }
    weeks.push({ key: `${month}|${mon}`, title: weekTitle(isoWeek(mon), from, sun > plus(monthShift(month, 1) + '-01', -1) ? plus(monthShift(month, 1) + '-01', -1) : sun), from, to,
      rows: (rows || []).filter(inWeek), sent: mine.length, approved: mine.filter(x => x.status === 'approved').length, missing, noact });
  }
  return weeks;
}
/** The month's counts: the sum of its weeks. */
export const monthCounts = weeks => weeks.reduce((a, w) => ({ sent: a.sent + w.sent, approved: a.approved + w.approved, missing: a.missing + w.missing, noact: a.noact + (w.noact || 0) }), { sent: 0, approved: 0, missing: 0, noact: 0 });
/** May an older month still be loaded? No once the two oldest loaded months are both empty, or before 2025. */
export const moreMonths = months => {
  const keys = Object.keys(months || {}).sort(), [a, b] = keys;
  return !(a && (a < '2025-01' || (b && !(months[a] || []).length && !(months[b] || []).length)));
};
/** The activities and milestones to search by: the schedule's milestones, then its tasks (open and finished). */
export const findChoices = setup => {
  const s = setup || {}, seen = new Set(), out = [];
  for (const [list, kind] of [[s.milestones, 'Milestone'], [s.tasks, 'Activity'], [s.finished, 'Activity']]) for (const t of list || []) if (t && t.id && !seen.has(t.id)) { seen.add(t.id); out.push({ id: t.id, name: t.name || t.id, kind }); }
  return out;
};
/** The reports with a work line of that task or milestone: [{ x, line, hit }], newest first, and the first and last of them. */
export function findReports(list, id, name = '') {
  const hits = [];
  for (const x of list || []) {
    const ws = (x.w || []).filter(w => w[0] === id || w[1] === id);
    if (!ws.length) continue;
    const w = ws[0];
    hits.push({ x, hit: w[2] || name, line: [w[3], w[2] || name, w[4]].filter(Boolean).join(' · '), more: ws.length - 1 });
  }
  hits.sort((a, b) => String(b.x.date + b.x.no).localeCompare(String(a.x.date + a.x.no)));
  return { hits, first: hits[hits.length - 1] || null, last: hits[0] || null };
}
