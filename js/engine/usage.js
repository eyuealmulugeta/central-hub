// v1.5.0 (owner, 7 Nov, FR R7): materials used vs work done. Each schedule task may carry how much of each material its
// work should use (task.usage: [{ item, unit, per }]): per unit of the task's quantity when it has one (e.g. bags per m²),
// else for the whole task (spread over its %). Field Report Store issues name the task they were for (taskId). The check
// compares what was issued (approved) with what the work done should have used: over 10% more = overuse, over 10% less =
// work not reported or material still lying on site. Pure functions.

import { deriveActuals } from './gantt.js';
import { itemKey } from '../fr/model/store.js';
import { isOut } from './purchases.js';

export const TOL = 0.10;
const r3 = v => Math.round((+v || 0) * 1000) / 1000;
const r2 = v => Math.round((+v || 0) * 100) / 100;

/** Clean the usage lines a person typed. */
export const cleanUsage = list => (list || []).map(u => ({ item: String(u.item || '').trim().replace(/\s+/g, ' '), unit: String(u.unit || '').trim(), per: Math.max(0, +u.per || 0) }))
  .filter(u => u.item && u.unit && u.per > 0);

/** What the work done so far should have used: { key: qty }. a = deriveActuals' entry for the task. */
export function expectedFor(task, a) {
  const out = {};
  const hasQty = (+task.totalQty || 0) > 0;
  for (const u of cleanUsage(task.usage)) out[itemKey(u.item, u.unit)] = r3(hasQty ? u.per * (a?.qtyDone || 0) : u.per * (a?.progress || 0) / 100);
  return out;
}

/** The latest PO price of each item (per unit, before VAT): { key: rate }. */
export function pricesOf(docs = []) {
  const out = {};
  for (const d of [...docs].filter(isOut).sort((a, b) => String(a.date).localeCompare(String(b.date)))) for (const l of d.lines || []) if (String(l.description || '').trim() && +l.rate > 0) out[itemKey(l.description, l.unit)] = +l.rate;
  return out;
}

/**
 * Per task and item: issued (approved issues for that task), expected, the difference, its % and value, and the flag.
 * Also the issues not linked to any task.
 */
export function usageRows({ tasks = [], reports = [], moves = [], docs = [] } = {}) {
  const act = deriveActuals(tasks, reports), prices = pricesOf(docs);
  const issued = {}, names = {}, unlinked = { count: 0, items: {} };
  for (const m of moves) {
    if (m?.kind !== 'issue' || m.status !== 'approved') continue;
    names[m.key] = { item: m.item, unit: m.unit };
    if (!m.taskId || !tasks.some(t => t.id === m.taskId)) { unlinked.count++; unlinked.items[m.key] = r3((unlinked.items[m.key] || 0) + (+m.qty || 0)); continue; }
    const t = (issued[m.taskId] ||= {});
    t[m.key] = r3((t[m.key] || 0) + (+m.qty || 0));
  }
  const rows = [];
  for (const task of tasks) {
    const exp = expectedFor(task, act.get(task.id)), got = issued[task.id] || {};
    for (const u of cleanUsage(task.usage)) names[itemKey(u.item, u.unit)] ||= { item: u.item, unit: u.unit };
    for (const key of new Set([...Object.keys(exp), ...Object.keys(got)])) {
      const e = exp[key] ?? null, i = got[key] || 0, diff = r3(i - (e || 0));
      const pct = e ? Math.round(diff / e * 100) : null;
      const flag = e == null ? 'nonorm' : !e ? (i > 0 ? 'early' : '') : diff > e * TOL ? 'over' : diff < -e * TOL ? 'under' : '';
      rows.push({ taskId: task.id, task: task.name || '', key, item: names[key]?.item || key.split('|')[0], unit: names[key]?.unit || key.split('|')[1] || '',
        issued: i, expected: e, diff, pct, value: prices[key] != null ? r2(diff * prices[key]) : null, flag, progress: act.get(task.id)?.progress || 0 });
    }
  }
  const ORDER = { over: 0, under: 1, early: 2, nonorm: 3, '': 4 };
  rows.sort((a, b) => ORDER[a.flag] - ORDER[b.flag] || Math.abs(b.value || 0) - Math.abs(a.value || 0) || a.task.localeCompare(b.task));
  return { rows, unlinked };
}
export const FLAG_WORD = { over: 'Overuse', under: 'Less than expected', early: 'Issued, no work reported yet', nonorm: 'No usage set for this task', '': 'OK' };
export const FLAG_TONE = { over: 'bad', under: 'warn', early: 'warn', nonorm: '', '': 'ok' };

/** What goes to the PM each week and to the GM's Sunday summary: overuse and less-than-expected only. */
export const weekFlags = rows => rows.filter(r => r.flag === 'over' || r.flag === 'under');
export const flagLine = (project, flags) => `${project}: ${flags.length} material${flags.length === 1 ? '' : 's'} off the expected use (${flags.slice(0, 3).map(f => `${f.item} on ${f.task} ${f.pct > 0 ? '+' : ''}${f.pct}%`).join(', ')}${flags.length > 3 ? ', …' : ''}).`;

/** One project's flags for the server: b = { project, tasks, reports, storeMoves, docs }. */
export const projectFlags = b => weekFlags(usageRows({ tasks: b.tasks || [], reports: b.reports || [], moves: b.storeMoves || [], docs: b.docs || [] }).rows);

export function csvRows(rows) {
  const out = [['Task', 'Done %', 'Item', 'Unit', 'Issued', 'Expected', 'Difference', 'Difference %', 'Value', 'Check']];
  for (const r of rows) out.push([r.task, r.progress, r.item, r.unit, r.issued, r.expected ?? '', r.diff, r.pct ?? '', r.value ?? '', FLAG_WORD[r.flag]]);
  return out;
}
