// v0.52.0 (Phase C, 21): a whole schedule pasted from Excel or MS Project. The rows are read with their
// columns (Task Name, Duration, Start, Finish, Predecessors, Resource Names, in any order), indented rows
// under a summary row take its name as their group, links keep their MS Project type and lag, and the crew
// ("Welder[400%]" = 4 welders) is kept on each task. Dates are worked out again from the links and the
// project's working days; a task whose finish then differs from the pasted one is pointed out.
// Pure functions; the panel is in ui/schedule.js.

import { toDay, fromDay } from '../core/util.js';
import { schedule } from './gantt.js';

const COLS = {
  name: /^(task\s*)?name$|^task$|^activity$/i, duration: /^dur(ation)?$/i, start: /^start/i, finish: /^finish|^end/i,
  preds: /^pred(ecessors?)?$/i, crew: /^resource|^crew/i, id: /^id$/i,
};
const DEFAULT = ['name', 'duration', 'start', 'finish', 'preds', 'crew'];

/** "26 days", "1 day", "3w", "0 days", "2.5 days?", "16 hrs", "1 mon" -> working days. */
export function parseDuration(text, weekDays = 6) {
  const m = String(text ?? '').trim().replace(/\?$/, '').match(/^(-?[\d.]+)\s*(e?(d|days?|w|wks?|weeks?|h|hrs?|hours?|mo|mons?|months?))?$/i);
  if (!m) return null;
  const n = +m[1];
  const u = (m[3] || 'd').toLowerCase();
  const days = /^w/.test(u) ? n * weekDays : /^h/.test(u) ? n / 8 : /^mo/.test(u) ? n * weekDays * 4 : n;
  return Math.max(0, Math.ceil(days - 1e-9));
}

/** "Mon 10/19/26" (MS Project, month first), "10/19/2026", "19/10/2026" (day first when it must be), "2026-10-19", an Excel day number. */
export function parseDate(text) {
  const s = String(text ?? '').trim().replace(/^[a-z]{2,9}\.?,?\s+/i, '');
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromDay(toDay('1899-12-30') + Math.floor(+s));   // Excel's day number
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    return a > 12 ? iso(y, b, a) : iso(y, a, b);
  }
  const d = new Date(s);
  return isNaN(d) ? '' : iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
const iso = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');

/** "2", "12,9", "2SS", "3FS+2 days", "4FF-1d" -> [{ row, type, lag }] (bad parts in `bad`). */
export function parseLinks(text, weekDays = 6) {
  const links = [], bad = [];
  for (const part of String(text ?? '').split(/[,;]/).map(p => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(.+))?$/i);
    const lag = m?.[4] != null ? parseDuration(m[4], weekDays) : 0;
    if (!m || lag == null) { bad.push(part); continue; }
    links.push({ row: +m[1], type: (m[2] || 'FS').toUpperCase(), lag: m[3] === '-' ? -lag : lag });
  }
  return { links, bad };
}

/** "Welder[400%],Labourer[200%],Painter" -> [{ trade: 'Welder', n: 4 }, { trade: 'Labourer', n: 2 }, { trade: 'Painter', n: 1 }] */
export function parseCrew(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/([^,;[\]]+?)\s*(?:\[\s*([\d.]+)\s*%?\s*\])?\s*(?:[,;]|$)/g)) {
    const trade = m[1].trim();
    if (!trade) continue;
    const n = m[2] != null ? Math.max(1, Math.round(+m[2] / 100)) : 1;
    const had = out.find(x => x.trade.toLowerCase() === trade.toLowerCase());
    if (had) had.n += n; else out.push({ trade, n });
  }
  return out;
}

const indentOf = s => (String(s).match(/^[\s ]*/)[0].replace(/\t/g, '    ').length);

/** Pasted text -> rows: { no (the MS Project ID: the row's place), name, indent, duration, start, finish, preds, crew }. */
export function readRows(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const cells = lines.map(l => l.split('\t'));
  const head = cells[0].map(c => Object.keys(COLS).find(k => COLS[k].test(c.trim())) || '');
  const hasHead = head.includes('name');
  const cols = hasHead ? head : DEFAULT;
  return (hasHead ? cells.slice(1) : cells).map((row, i) => {
    const get = k => { const at = cols.indexOf(k); return at < 0 ? '' : row[at] ?? ''; };
    const raw = get('name');
    return { no: +get('id') || i + 1, name: raw.trim(), indent: indentOf(raw), duration: get('duration'), start: get('start'), finish: get('finish'), preds: get('preds'), crew: get('crew') };
  }).filter(r => r.name && (r.duration || r.start || r.finish));   // a note under the table is not a task
}

/**
 * The tasks a paste makes. `firstStart`: the day the schedule starts (blank = the earliest pasted start).
 * Returns { tasks, problems: [{ no, text }], differ: [{ no, name, pasted, worked }], start, end }.
 */
export function importSchedule(text, { firstStart = '', workDays, newId }) {
  const rows = readRows(text);
  const weekDays = workDays?.length || 6;
  const problems = [];
  // a row followed by a more indented one is a summary: its name becomes the group of the rows under it
  const summary = new Set(rows.filter((r, i) => rows[i + 1] && rows[i + 1].indent > r.indent).map(r => r.no));
  const starts = rows.filter(r => !summary.has(r.no)).map(r => parseDate(r.start)).filter(Boolean).sort();
  const begin = parseDate(firstStart) || starts[0] || '';
  if (!begin) problems.push({ no: 0, text: 'No start date: enter the day the schedule starts.' });
  const ids = new Map(rows.filter(r => !summary.has(r.no)).map(r => [r.no, newId()]));
  const groups = [];
  const tasks = [];
  for (const r of rows) {
    while (groups.length && groups.at(-1).indent >= r.indent) groups.pop();
    if (summary.has(r.no)) { groups.push({ indent: r.indent, name: r.name }); continue; }
    const duration = parseDuration(r.duration, weekDays);
    if (duration == null) problems.push({ no: r.no, text: `${r.name}: duration "${r.duration}" not understood, 1 day used.` });
    const { links, bad } = parseLinks(r.preds, weekDays);
    if (bad.length) problems.push({ no: r.no, text: `${r.name}: link "${bad.join(', ')}" not understood, left out.` });
    const deps = [];
    for (const l of links) {
      if (summary.has(l.row)) { problems.push({ no: r.no, text: `${r.name}: linked to summary row ${l.row}, left out.` }); continue; }
      if (!ids.has(l.row)) { problems.push({ no: r.no, text: `${r.name}: there is no task ${l.row}, link left out.` }); continue; }
      if (l.row === r.no) continue;
      deps.push({ id: ids.get(l.row), ...(l.lag ? { lag: l.lag } : {}), ...(l.type !== 'FS' ? { type: l.type } : {}) });
    }
    const own = parseDate(r.start);
    const crew = parseCrew(r.crew);
    tasks.push({
      id: ids.get(r.no), name: r.name, duration: duration ?? 1, milestone: duration === 0,
      // a task with links is placed by them; one without keeps its own start (MS Project's constraint)
      start: deps.length ? begin : own && own > begin ? own : begin,
      deps, ...(crew.length ? { crew } : {}), ...(groups.length ? { group: groups.map(g => g.name).join(' › ') } : {}),
      _no: r.no, _finish: parseDate(r.finish),
    });
  }
  // dates worked out again, then compared with what MS Project said
  const plan = begin ? schedule(tasks, [], { today: begin, workDays }) : null;
  if (plan?.cyclic.length) problems.push({ no: 0, text: `${plan.cyclic.length} tasks are linked in a loop; check their links.` });
  const differ = [];
  if (plan) for (const row of plan.rows) {
    const worked = fromDay(row.planEf);
    if (row._finish && worked !== row._finish) differ.push({ no: row._no, name: row.name, pasted: row._finish, worked });
  }
  return {
    tasks: tasks.map(({ _no, _finish, ...t }) => t),
    problems, differ, start: begin,
    end: plan?.rows.length ? fromDay(plan.planEnd) : '',
  };
}
