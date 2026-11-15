// v1.67.0 (owner, 15 Nov, R7): the weekly, monthly or custom progress report as an Excel workbook. The Daily, Work,
// Manpower, Delays, Requests and Materials sheets hold the data; the Summary works its figures out with formulas, so a
// change to a row in Excel changes the Summary too. Pure: no store, no page.

import { fromDay } from '../core/util.js';

const N = 400;   // rows the Summary's formulas look at on each data sheet
const day = v => (typeof v === 'number' ? fromDay(v) : v || '');
const num = v => (Number.isFinite(+v) && v !== '' && v != null ? +v : '');
const head = cols => cols.map(b => ({ b }));

/** The reports of the period (approved only when asked), oldest first; a no-work day counts as a day without work. */
export function periodReports(reports, from, to, approvedOnly = true) {
  return (reports || []).filter(r => r.date >= from && r.date <= to && (!approvedOnly || r.review !== 'pending'))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** One row a day: the figures the Summary adds up. */
export function dailyRows(reps, hoursPerDay = 8) {
  return reps.map(r => {
    const f = r.field || {}, crew = (r.manpower || []).reduce((a, m) => a + (+m.count || 0), 0), ot = (r.manpower || []).reduce((a, m) => a + (+m.ot || 0), 0);
    return [r.date, f.no || '', f.nowork ? 'No work' : 'Worked', crew, crew * hoursPerDay + ot, ot,
      (f.delays || []).reduce((a, d) => a + (+d.h || 0), 0), (f.requests || []).length, f.nowork ? '' : f.safety || 'None', r.weather || '', r.by || ''];
  });
}

/**
 * The workbook's sheets for xlsxBytes. p: { project, kind ('weekly' | 'monthly' | 'custom'), title, number, from, to,
 * reports (all of the project), data (reportSnapshot of the period, optional), hoursPerDay, approvedOnly }.
 */
export function periodSheets(p) {
  const reps = periodReports(p.reports, p.from, p.to, p.approvedOnly !== false), d = p.data || {}, hpd = +p.hoursPerDay || 8;
  const daily = dailyRows(reps, hpd);
  // manpower by trade
  const trades = new Map();
  for (const r of reps) for (const m of r.manpower || []) {
    const t = trades.get(m.trade) || [m.trade, 0, 0];
    t[1] += +m.count || 0; t[2] += +m.ot || 0; trades.set(m.trade, t);
  }
  const man = [...trades.values()].sort((a, b) => b[1] - a[1]).map((t, i) => [t[0], t[1], t[2], { f: `B${i + 2}*${hpd}+C${i + 2}` }]);
  const mEnd = man.length + 1;
  // delay hours by cause
  const causes = new Map();
  for (const r of reps) for (const x of r.field?.delays || []) causes.set(x.k, (causes.get(x.k) || 0) + (+x.h || 0));
  const work = (d.work || []).map(e => [e.date, e.task || '', num(e.qty), e.unit || '', e.progress == null ? '' : num(e.progress), e.note || '']);
  const requests = reps.flatMap(r => (r.field?.requests || []).map(q => [r.date, q.priority || '', q.text || q.item || '', num(q.usd)]));
  const received = reps.flatMap(r => (r.field?.received || []).filter(x => x.name).map(x => [r.date, x.name, num(x.qty), x.unit || '', x.note || '']));
  const rows = (d.rows || []).map(x => [x.name || '', day(x.planEs ?? x.es), day(x.planEf ?? x.ef), num(x.progress), x.status || '', num(x.slip)]);
  const r = (label, f) => [label, f];
  const summary = [
    [{ b: p.title || 'Progress report' }, p.number || ''],
    ['Project', p.project?.name || ''],
    ['From', p.from], ['To', p.to],
    [],
    head(['Figure', 'Value']),
    r('Days reported', { f: `COUNTA(Daily!A2:A${N})` }),
    r('Days with no work', { f: `COUNTIF(Daily!C2:C${N},"No work")` }),
    r('Man-days', { f: `SUM(Daily!D2:D${N})` }),
    r('Man-hours', { f: `SUM(Daily!E2:E${N})` }),
    r('Overtime hours', { f: `SUM(Daily!F2:F${N})` }),
    r('Delay hours', { f: `SUM(Daily!G2:G${N})` }),
    r('Requests', { f: `SUM(Daily!H2:H${N})` }),
    r('Safety incidents', { f: `COUNTIFS(Daily!I2:I${N},"<>None",Daily!I2:I${N},"<>")` }),
    r('Quantity entries', { f: `COUNTA(Work!A2:A${N * 5})` }),
    r('Materials received (lines)', { f: `COUNTA(Materials!A2:A${N * 5})` }),
    r('Overall progress %', num(d.progress)),
    r('Planned progress %', num(d.plannedProgress)),
    r('Days behind (+) or ahead (-)', num(d.slip)),
    [],
    ['Hours a working day', hpd],
    ['Made by Central Hub', p.asOf || ''],
  ];
  return [
    { name: 'Summary', rows: summary },
    { name: 'Daily', rows: [head(['Date', 'Report No', 'Day', 'Crew (man-days)', 'Man-hours', 'Overtime hours', 'Delay hours', 'Requests', 'Safety', 'Weather', 'Prepared by']), ...daily] },
    { name: 'Manpower', rows: [head(['Trade', 'Man-days', 'Overtime hours', 'Man-hours']), ...man, ...(man.length ? [['Total', { f: `SUM(B2:B${mEnd})` }, { f: `SUM(C2:C${mEnd})` }, { f: `SUM(D2:D${mEnd})` }]] : [])] },
    { name: 'Work', rows: [head(['Date', 'Task', 'Quantity', 'Unit', 'Progress %', 'Note']), ...work] },
    { name: 'Progress', rows: [head(['Task', 'Plan start', 'Plan finish', 'Progress %', 'Status', 'Slip days']), ...rows] },
    { name: 'Delays', rows: [head(['Cause', 'Hours']), ...[...causes].map(([k, h]) => [k, h]), ...(causes.size ? [['Total', { f: `SUM(B2:B${causes.size + 1})` }]] : []), [], head(['Date', 'Task', 'Delay days', 'Note']), ...(d.delays || []).map(e => [e.date, e.task || '', num(e.delayDays), e.note || ''])] },
    { name: 'Requests', rows: [head(['Date', 'Priority', 'Request', 'USD']), ...requests] },
    { name: 'Materials', rows: [head(['Date', 'Material', 'Quantity', 'Unit', 'Note']), ...received] },
  ];
}

/** The file name: "2026-11-09 MJO Weekly report WR-012.xlsx" (the archive rule). */
export const periodXlsxName = ({ from, code, kind, number }) =>
  [String(from || '').slice(0, 10), code || '', kind === 'monthly' ? 'Monthly report' : kind === 'weekly' ? 'Weekly report' : 'Progress report', number || ''].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, ' ') + '.xlsx';
