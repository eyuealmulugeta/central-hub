// The Daily Site Report (v0.21.0): the figures and groupings of the formal report Central Hub makes from a daily
// report (docs/plan-daily-report.md). Only what is worked out lives here; js/ui/dailyreport.js lays it out. Pure.

import { sum } from '../core/util.js';

/** The request types the owner chose on 25 Oct 2026. Older requests keep the type they were filed with. */
export const REQUEST_TYPES = ['Manpower', 'Material', 'Equipment', 'Tool', 'Other'];

/**
 * Lines of today's activities under their headings, words unchanged. "Zone C2 Warehouse: installed …" goes under
 * "Zone C2 Warehouse"; a line that ends in ":" heads the lines after it; lines with no heading stay under "General".
 * @returns [{ zone, lines: [string] }] in the order the headings first appear
 */
export function byZone(lines) {
  const out = new Map();
  const put = (zone, text) => { if (!out.has(zone)) out.set(zone, []); if (text) out.get(zone).push(text); };
  let head = '';
  for (const raw of lines || []) {
    const line = String(raw || '').trim();
    if (!line) continue;
    if (line.endsWith(':')) { head = line.slice(0, -1).trim(); put(head, ''); continue; }
    const m = line.match(/^([^:]{2,40}):\s+(.+)$/);
    if (m && !/^\d+$/.test(m[1])) put(m[1].trim(), m[2]);
    else put(head || 'General', line);
  }
  return [...out].filter(([, l]) => l.length).map(([zone, l]) => ({ zone, lines: l }));
}

/**
 * Today's activities grouped by work type, then zone. Field Report 1 sends free lines (progress) and lines under an
 * activity (extra: [{ activity, items }]).
 */
export function activitiesOf(field = {}) {
  const groups = [];
  if (field.progress?.length) groups.push({ type: '', zones: byZone(field.progress) });
  for (const x of field.extra || []) if ((x.items || []).length) groups.push({ type: x.activity || '', zones: byZone(x.items) });
  return groups;
}

/**
 * Everything the report shows, worked out once.
 * @param r the report record
 * @param ctx { ws, rows: schedule rows, hoursPerDay }
 */
export function dailyModel(r, { ws, rows = [], hoursPerDay = 8 }) {
  const f = r.field || {};
  const crew = r.manpower || [];
  const hrsEach = m => m.hrs ?? (m.count ? hoursPerDay + (m.ot || 0) / m.count : 0);
  const trades = crew.map(m => ({ trade: m.trade, count: +m.count || 0, hours: hrsEach(m), manHours: (+m.count || 0) * hrsEach(m), ot: +m.ot || 0 }));
  const people = sum(trades, t => t.count);
  const manHours = sum(trades, t => t.manHours);
  const equipment = (f.equipment || []).map(e => ({ name: e.name, qty: +e.qty || 0, hrs: +e.hrs || 0, status: e.status || '', machineHours: (+e.qty || 0) * (+e.hrs || 0) }));
  const delays = (f.delayItems?.length ? f.delayItems : (f.delays || []).map(d => ({ cause: d.k, hours: d.h })))
    .map(d => ({ cause: d.cause || 'Delay', party: d.party || '', hours: +(d.hours ?? d.h) || 0, idle: +d.idlePeople || 0, taskId: d.taskId || '', note: d.note || '' }));
  const delayHours = sum(delays, d => d.hours);
  const requests = (f.requests?.length ? f.requests : r.issue ? [{ priority: 'Normal', text: r.issue }] : [])
    .map(x => ({ type: x.category || x.type || 'Other', text: x.text || '', qty: x.qty ?? '', unit: x.unit || '', neededBy: x.neededBy || '', priority: x.priority || 'Normal' }));
  const typeCount = [...new Set([...REQUEST_TYPES, ...requests.map(x => x.type)])].map(t => [t, requests.filter(x => x.type === t).length]).filter(([t, n]) => n || REQUEST_TYPES.includes(t));
  const task = id => rows.find(x => x.id === id) || ws?.tasks?.find(t => t.id === id);
  // work against the schedule: today's amount, and the task's progress before and after today
  // Field Report sends work against tasks; a report typed in Central Hub has the same in its entries
  const against = f.work?.length ? f.work : (r.entries || []).filter(e => +e.qty > 0 || e.progress != null).map(e => ({ taskId: e.taskId, qty: +e.qty || 0, pct: e.progress ?? null, note: e.note || '' }));
  const work = against.map(w => {
    const row = task(w.taskId) || {};
    const total = +row.qtyTotal || 0;
    const before = r.review === 'pending' ? +row.qtyDone || 0 : Math.max(0, (+row.qtyDone || 0) - (+w.qty || 0));
    const pctBefore = total ? Math.min(100, before / total * 100) : null;
    const pctAfter = total ? Math.min(100, (before + (+w.qty || 0)) / total * 100) : w.pct ?? null;
    return { name: row.name || 'Unknown task', qty: +w.qty || 0, pct: w.pct ?? null, unit: row.unit || '', location: w.location || '', note: w.note || '', total, pctBefore, pctAfter };
  });
  // items of work by zone (or by task when the site entered work against tasks), for the chart
  const zones = activitiesOf(f).flatMap(g => g.zones);
  const byZoneCount = new Map();
  for (const z of zones) byZoneCount.set(z.zone, (byZoneCount.get(z.zone) || 0) + z.lines.length);
  const itemsChart = work.length ? work.map(w => [w.name, 1]).reduce((m, [k]) => m.set(k, (m.get(k) || 0) + 1), new Map()) : byZoneCount;
  const items = work.length || sum(zones, z => z.lines.length);
  return {
    no: f.no || '', people, manHours, ot: sum(trades, t => t.ot), trades, equipment, machineHours: sum(equipment, e => e.machineHours),
    delays, delayHours, idle: sum(delays, d => d.idle), requests, typeCount, work, activities: activitiesOf(f), items,
    itemsChart: [...itemsChart].map(([label, n]) => ({ label, n })),
    received: (f.received || []).map(x => ({ name: x.name, qty: x.qty, unit: x.unit || '', note: x.note || '' })),
    plan: byZone(f.plan || []),
    safety: { incident: f.safety && f.safety !== 'None' ? f.safety : '', toolbox: f.toolbox ?? null, notes: f.safetyNotes || [] },
    attendance: (f.attendance || []).map(a => ({ name: a.name, state: a.state || 'present', ot: +a.ot || 0 })),
    photos: +f.photos || 0,
  };
}
