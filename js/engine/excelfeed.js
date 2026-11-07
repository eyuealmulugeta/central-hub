// v1.9.0 (owner, 7 Nov, G7): the Excel link. One private read-only link per project, made by the Admin or the GM; Excel's
// Data > From Web opens it and refreshes every table with one click. Money and planning only: no pay, no salaries (G8).

import { billStatus, BILL_WORD } from './bills.js';

export const KEY_RE = /^[A-Za-z0-9]{32}$/;
export const FEED_URL = 'https://europe-west1-amistad-ops.cloudfunctions.net/excelFeed';
export const linkOf = key => (key ? `${FEED_URL}?k=${key}` : '');
/** The Admin and the GM make, renew and turn off links (owner). */
export const mayLink = (role, ranks = []) => role === 'owner' || (ranks || []).includes('general_manager');
export const SECTIONS = ['ledger', 'bills', 'docs', 'tasks', 'reports'];

const num = v => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);
const day = d => String(d || '').slice(0, 10);
const monday = d => { const t = new Date(`${day(d)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

/** Each task's % done and delay from the daily reports: installed quantity over the task's total, else the latest % given. */
export function taskProgress(tasks, reports, until = '9999') {
  const out = {};
  const reps = (reports || []).filter(r => r && day(r.date) <= until).sort((a, b) => day(a.date).localeCompare(day(b.date)));
  for (const t of tasks || []) {
    let qty = 0, pct = null, delay = 0, last = '';
    for (const r of reps) for (const e of r.entries || []) {
      if (e.taskId !== t.id) continue;
      qty += +e.qty || 0; if (e.progress != null && e.progress !== '') pct = +e.progress; delay += +e.delayDays || 0; last = day(r.date);
    }
    const p = +t.totalQty > 0 ? Math.min(100, qty / +t.totalQty * 100) : pct;
    out[t.id] = { pct: p == null ? null : num(p), delay, last, qty: num(qty) };
  }
  return out;
}

/** The tables, as [{ name, rows }] with a header row first. */
export function feedTables({ project = {}, ws = {}, today = '' }) {
  const cur = project.currency || 'ETB';
  const ledger = (ws.ledger || []).filter(e => e && e.date);
  const costs = ledger.map(e => [day(e.date), e.type === 'income' ? 'Income' : 'Expense', e.category || '', e.category === 'labor' ? 'Labour' : e.description || '', e.category === 'labor' ? '' : e.vendor || '', num(e.amount), e.currency || cur, e.estimate ? 'Yes' : ''])
    .sort((a, b) => b[0].localeCompare(a[0]));
  const real = ledger.filter(e => !e.estimate);
  const spent = real.filter(e => e.type !== 'income' && (e.currency || cur) === cur).reduce((s, e) => s + (+e.amount || 0), 0);
  const income = real.filter(e => e.type === 'income' && (e.currency || cur) === cur).reduce((s, e) => s + (+e.amount || 0), 0);
  const inv = (ws.docs || []).filter(d => d && d.type === 'invoice');
  const sent = inv.filter(d => d.status !== 'draft');
  const invoiced = sent.reduce((s, d) => s + (+d.total || 0), 0), outstanding = sent.filter(d => d.status === 'sent').reduce((s, d) => s + (+d.amountDue || 0), 0);
  const bills = ws.bills || [], open = bills.filter(b => !b.paid);

  const flows = {};
  for (const e of real) { const k = `${day(e.date).slice(0, 7)}|${e.currency || cur}`; const f = flows[k] ||= { in: 0, out: 0 }; f[e.type === 'income' ? 'in' : 'out'] += +e.amount || 0; }
  const prog = taskProgress(ws.tasks, ws.reports);
  const weeks = [...new Set((ws.reports || []).filter(r => r && r.date).map(r => monday(r.date)))].sort();
  const progress = [];
  for (const w of weeks) {
    const end = new Date(`${w}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
    const p = taskProgress(ws.tasks, ws.reports, end.toISOString().slice(0, 10));
    for (const t of ws.tasks || []) if (p[t.id].pct != null) progress.push([w, t.name || '', p[t.id].pct]);
  }

  return [
    { name: 'Summary', rows: [['Item', 'Value'], ['Project', project.name || ''], ['Currency', cur], ['Contract value', num(project.contractValue)], ['Budget', num(project.budget)],
      [`Spent (${cur})`, num(spent)], [`Income (${cur})`, num(income)], ['Budget left', num((+project.budget || 0) - spent)],
      ['Invoiced', num(invoiced)], ['Outstanding from the client', num(outstanding)], ['Supplier bills not paid', open.length], ['Updated', today]] },
    { name: 'Costs', rows: [['Date', 'Type', 'Category', 'Description', 'Supplier', 'Amount', 'Currency', 'Estimate'], ...costs] },
    { name: 'Bills', rows: [['Number', 'Supplier', 'Date', 'Due', 'Category', 'Amount', 'Currency', 'Status', 'Paid on'],
      ...bills.map(b => [b.number || '', b.supplier || '', day(b.date), day(b.due), b.category || 'material', num(b.amount), b.currency || cur, BILL_WORD[billStatus(b, today)] || '', b.paid ? day(b.paid.date) : ''])] },
    { name: 'Invoices', rows: [['Number', 'Date', 'Due', 'Status', 'Client', 'Subtotal', 'VAT', 'Retention', 'Total', 'Amount due'],
      ...inv.map(d => [d.number || '', day(d.date), day(d.due), d.status || '', (d.party || {}).name || '', num(d.subtotal), num(d.vat), num(d.retention), num(d.total), num(d.amountDue)])] },
    { name: 'Cash flow', rows: [['Month', 'Currency', 'Money in', 'Money out', 'Net'],
      ...Object.entries(flows).sort().map(([k, f]) => { const [m, c] = k.split('|'); return [m, c, num(f.in), num(f.out), num(f.in - f.out)]; })] },
    { name: 'Tasks', rows: [['Task', 'Planned start', 'Working days', 'Milestone', 'Total quantity', 'Unit', 'Done quantity', '% done', 'Delay days', 'Last report'],
      ...(ws.tasks || []).map(t => { const p = prog[t.id] || {}; return [t.name || '', day(t.start), num(t.duration), t.milestone ? 'Yes' : '', num(t.totalQty), t.unit || '', p.qty || 0, p.pct ?? '', p.delay || 0, p.last || '']; })] },
    { name: 'Progress', rows: [['Week of', 'Task', '% done'], ...progress] },
  ];
}
