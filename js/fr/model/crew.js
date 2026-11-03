// Attendance and crew. Manpower and man-hours are counted from attendance (owner's answer 2):
// there is no separate Manpower step.

import { sum, hoursBetween } from '../core/util.js';

export const STATES = ['present', 'absent', 'sick', 'leave'];
export const STATE_LETTER = { present: 'P', absent: 'A', sick: 'S', leave: 'L' };

/** Today's attendance rows from the office's crew list, nobody marked yet (2.13.1). Yesterday's overtime is not carried. */
export function rowsFromStaff(staff) {
  return (staff || []).filter(s => s && s.name && s.active !== false)
    .map(s => ({ id: s.id || '', name: s.name, trade: s.trade || '', state: '', ot: 0 }));
}

/**
 * Brings saved rows in line with the office's current list: new people are added unmarked,
 * people the office removed stay only if they were marked today.
 */
export function mergeStaff(rows, staff, gone = []) {
  const off = new Set((gone || []).map(String));   // 2.41.0: deleted from the project: out of today's list even if marked
  const key = r => (r.id || r.name).toLowerCase();
  const have = new Map((rows || []).map(r => [key(r), r]));
  const out = rowsFromStaff(staff).map(r => ({ ...r, ...(have.get(key(r)) || {}), trade: r.trade || (have.get(key(r)) || {}).trade || '' }));
  const inList = new Set(out.map(key));
  for (const r of rows || []) if (!inList.has(key(r)) && !(r.id && off.has(String(r.id))) && (r.state || r.ot || r.added)) out.push(r);
  return out;
}

/** Head count, absentees, man-hours and manpower by trade for the day's working hours. */
export function totals(crew, start, end) {
  const hrs = hoursBetween(start, end) || 8;
  const rows = crew && crew.rows || [];
  const extra = (crew && crew.extra || []).filter(x => x.qty > 0);
  const here = rows.filter(r => r.state === 'present');
  const byTrade = new Map();
  const add = (trade, qty, h) => {
    const t = trade || 'Other';
    const x = byTrade.get(t) || { trade: t, qty: 0, hrs: 0 };
    x.qty += qty; x.hrs += h; byTrade.set(t, x);
  };
  for (const r of here) add(r.trade, 1, hrs + (Number(r.ot) || 0));
  for (const x of extra) add(x.trade, Number(x.qty) || 0, (Number(x.qty) || 0) * hrs);
  const present = here.length + sum(extra, x => x.qty);
  return {
    hrs,
    present,
    away: rows.length - here.length,
    overtime: sum(here, r => r.ot),
    manHours: Math.round(sum([...byTrade.values()], x => x.hrs) * 10) / 10,
    byTrade: [...byTrade.values()].sort((a, b) => b.qty - a.qty),
  };
}

/** The old report's manpower block, so Central Hub keeps reading it: { head, manHours, crew:[{trade, qty, hrs}] }. */
export function manpowerMeta(crew, start, end) {
  const t = totals(crew, start, end);
  return { head: t.present, manHours: t.manHours, crew: t.byTrade.map(x => ({ trade: x.trade, qty: x.qty, hrs: t.hrs })) };
}

/** The office attendance block the Apps Script and Central Hub take: [{ id, name, trade, state, ot }]. */
export const attendanceRows = crew => (crew && crew.rows || []).filter(r => r.state).map(r => ({   // 2.13.1: unmarked people are not sent
  id: r.id || '', name: r.name, trade: r.trade || '', state: r.state, ot: r.state === 'present' ? Number(r.ot) || 0 : 0,
  ...(r.markAt > 1e12 ? { at: new Date(r.markAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Addis_Ababa', hour: '2-digit', minute: '2-digit' }) } : {}),   // 2.21.0: when it was marked, for the engagement score in Central Hub
}));

export const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** 2.5.0: the morning crew photo. Until the start hour it is on time, until 15 minutes after it late attendance, after that
 *  the camera is closed (2.7.0: the start hour is the project's, set by the PM or GM; 08:00 when none).
 *  The server's clock decides when there is a connection; without one the phone's clock is used and the photo says so.
 *  A phone clock more than 5 minutes away from the server's makes the time doubtful. No limit on how many. */
export const CREW_ON_TIME = '08:00', LATE_MIN = 15, DOUBT_MIN = 5;
/** The last minute of late attendance: the start hour + 15 minutes. */
export function crewCloses(start = CREW_ON_TIME) {
  const [h, m] = String(/^\d{2}:\d{2}$/.test(start) ? start : CREW_ON_TIME).split(':').map(Number), t = Math.min(h * 60 + m + LATE_MIN, 1439);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
export const CREW_CLOSES = crewCloses();
export const CREW_ST_WORD = { ontime: 'On time', late: 'Late attendance', closed: 'Closed' };
export function crewPhotoState(time, { offline = false, skewMin = 0, start = CREW_ON_TIME } = {}) {
  const on = /^\d{2}:\d{2}$/.test(start) ? start : CREW_ON_TIME;
  const st = time <= on ? 'ontime' : time <= crewCloses(on) ? 'late' : 'closed';
  const tags = [];
  if (offline) tags.push('Taken offline');
  if (Math.abs(skewMin) > DOUBT_MIN) tags.push('Time doubtful');
  return { st, tags };
}

/** 2.5.0: a wage typed for one person that is not the daily wage of their trade: Central Hub flags it for review. */
export function wageDiffers(person, trades) {
  const t = (trades || []).find(x => x.trade === person.trade);
  return Number(person.wage) > 0 && !!t && Number(t.wage) > 0 && Number(person.wage) !== Number(t.wage);
}

/**
 * 2.13.0: the project's crew as Central Hub's team says right now: names and trades corrected there or on a phone,
 * people taken off left out, people the site added and Central Hub approved added before the next list arrives.
 */
// 2.14.2: the same office roles Central Hub leaves out of a site's crew (Central Hub js/sync/fieldreport.js OFFICE_ROLE)
const OFFICE_ROLE = /\b(gm|admin|administrator|owner|general manager|managing director|office engineer|coordinator|accountant|procurement|logistics|cashier|secretary|human resources|hr)\b/i;
export function withTeam(p, team) {
  if (!p || !team) return p;
  const by = new Map(team.map(m => [m.id, m]));
  // 2.17.0: only the crew Central Hub has on the project (owner, 1 Nov): anyone else leaves every device
  const staff = (p.staff || []).filter(s => s.id && by.has(s.id) && by.get(s.id).active !== false)
    .map(s => { const m = by.get(s.id); return { ...s, name: m.name || s.name, trade: normTrade(m.role || s.trade), fromSite: !!m.fromSite, dropAsk: m.dropAsk || null }; });
  const have = new Set(staff.map(s => s.id));
  // 2.14.2: anyone ticked in Central Hub's Allocated crew joins at once (office roles stay out, as in Central Hub)
  for (const m of team) if (m.active !== false && !have.has(m.id) && m.name && (m.fromSite || !OFFICE_ROLE.test(m.role || ''))) staff.push({ id: m.id, name: m.name, trade: normTrade(m.role), active: true, level: 'crew', fromSite: !!m.fromSite, dropAsk: m.dropAsk || null });
  // 2.16.0: someone approved in Central Hub leaves the waiting list on every device at once, not at the next check
  const approved = new Set(team.filter(m => m.fromSite && m.active !== false).map(m => String(m.name || '').trim().toLowerCase()));
  const crewWait = (p.crewWait || []).filter(w => !approved.has(String(w.name || '').trim().toLowerCase()));
  return { ...p, staff, crewWait, gone: team.filter(m => m.active === false).map(m => m.id) };
}

/** 2.15.0: positions the owner merged: shown as the one they became (Central Hub js/engine/positions.js OLD_ROLES). */
const OLD_TRADES = { 'steel structure foreman': 'Foreman', 'general foreman': 'Foreman', 'container house technician': 'Technician', 'daily labourer': 'Daily labor', 'semi-skilled labourer': 'Semi-skilled labor' };
export const normTrade = t => OLD_TRADES[String(t || '').trim().toLowerCase()] || String(t || '').trim();

/** 2.15.0: the key a person's mark is shared under (their Central Hub id, else their name). */
export const markKey = r => String(r.id || r.name || '').toLowerCase().replace(/[.\/\[\]#$~*`]/g, '_');

/**
 * 2.33.0 (owner, 3 Nov, Phase G2): the reporter confirms that today's attendance is correct; Central Hub shows it on
 * its sheet. 'none' (not confirmed), 'ok', or 'changed' (a mark was changed after the confirmation).
 */
export function dayConfirm(marks, confirmed) {
  if (!confirmed) return 'none';
  return Object.values(marks || {}).some(x => Number(x.at) > Number(confirmed.at)) ? 'changed' : 'ok';
}

/** 2.15.0: today's marks from the project's other phones and computers: a newer mark wins, person by person. */
export function applyMarks(rows, marks) {
  if (!marks) return rows;
  return rows.map(r => {
    const m = marks[markKey(r)];
    return m && Number(m.at) > Number(r.markAt || 0) ? { ...r, state: m.state || '', ot: m.state === 'present' ? Number(m.ot) || 0 : 0, markAt: Number(m.at) } : r;
  });
}
