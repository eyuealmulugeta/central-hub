// v1.10.0 (owner, 7 Nov, G7b): Excel to Central Hub. The owner keeps one Excel file per project in Google Drive; the server reads
// it every hour (or on Sync now) through the Field Report script, and lists what is new, changed or removed. Nothing enters
// Central Hub before the Admin or the GM approves it; nothing is deleted on its own. Each row has a Ref, so a row is matched again.

export const SHEETS = [
  { name: 'Costs', section: 'ledger', cols: ['Ref', 'Date', 'Category', 'Description', 'Supplier', 'Amount', 'Currency'], money: true },
  { name: 'Ledger', section: 'ledger', cols: ['Ref', 'Date', 'Type', 'Category', 'Description', 'Supplier', 'Amount', 'Currency'], money: true },
  { name: 'Supplier bills', section: 'bills', cols: ['Ref', 'Number', 'Supplier', 'Date', 'Due', 'Category', 'Amount', 'Currency', 'Paid on'], money: true },
  { name: 'Invoices', section: 'docs', cols: ['Ref', 'Number', 'Date', 'Due', 'Client', 'Description', 'Amount', 'VAT %', 'Retention %', 'Status'], money: true },
  { name: 'Quotations', section: 'docs', cols: ['Ref', 'Number', 'Date', 'Valid until', 'Client', 'Description', 'Amount', 'VAT %', 'Status'], money: true },
  { name: 'Payments', section: 'ledger', cols: ['Ref', 'Date', 'Direction', 'Party', 'Amount', 'Currency', 'Method', 'For'], money: true },
  { name: 'Tasks', section: 'tasks', cols: ['Ref', 'Task', 'Start', 'Working days', 'Total quantity', 'Unit', 'Milestone'] },
  { name: 'Progress', section: 'xlProgress', cols: ['Ref', 'Date', 'Task', '% done', 'Quantity done', 'Note'] },
];
export const CATEGORIES = ['labor', 'material', 'equipment', 'subcontract', 'transport', 'overhead'];
export const MAX_CHANGES = 300;
const SLUG = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
export const idOf = (sheet, ref) => `xl_${SLUG(sheet)}_${String(ref).replace(/[^A-Za-z0-9-]/g, '_').slice(0, 60)}`;

/** A Drive link or id -> the file id, or ''. */
export const fileIdOf = link => { const s = String(link || '').trim(); const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || s.match(/^([A-Za-z0-9_-]{20,})$/); return m ? m[1] : ''; };

/** An Excel date (day number, 2026-11-07, 07/11/2026) -> 2026-11-07, or ''. */
export function dateOf(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
const numOf = v => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/[, ]/g, ''); return s === '' ? null : (Number.isFinite(+s) ? +s : NaN); };
const txt = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const yes = v => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());
const r2 = n => Math.round(n * 100) / 100;

/** The template: each sheet's header row, and a Help sheet. */
export function templateSheets() {
  return [
    { name: 'Help', rows: [['How to fill this file'], ['Every row needs a Ref that never changes (e.g. C-001). A new Ref is a new row; the same Ref with other values is a change.'],
      ['Dates: 2026-11-07 or 07/11/2026. Amounts: numbers only. Currency: ETB, USD, AED… (empty = the project currency).'],
      ['Category: labor, material, equipment, subcontract, transport or overhead. Ledger Type: Expense or Income. Payments Direction: Paid or Received.'],
      ['Invoice Status: draft, sent or paid. Quotation Status: draft, sent or accepted. Milestone: Yes or empty. Progress Task: the task\'s Ref or its name.'],
      ['Central Hub checks the file every hour; the Admin or the GM approves each change before it enters Central Hub. Deleting a row only proposes its removal.']] },
    ...SHEETS.map(s => ({ name: s.name, rows: [s.cols] })),
  ];
}

/** One row -> { rec } or { err }. ctx: { cur, tasks (existing, by ref and name) } */
function recordOf(sheet, v, ctx, at) {
  const cur = (txt(v.Currency, 3) || ctx.cur).toUpperCase(), ref = txt(v.Ref, 60), id = idOf(sheet.name, ref), xl = { sheet: sheet.name, ref };
  const date = k => dateOf(v[k]), need = [];
  const amount = numOf(v.Amount);
  if (sheet.money && (amount == null || Number.isNaN(amount) || amount < 0)) need.push('Amount is not a number');
  if (sheet.money && !/^[A-Z]{3}$/.test(cur)) need.push('Currency is not like ETB or USD');
  const cat = txt(v.Category, 20).toLowerCase() || 'material';
  if ('Category' in v && v.Category !== '' && !CATEGORIES.includes(cat)) need.push(`Category "${v.Category}" is not known`);
  switch (sheet.name) {
    case 'Costs': case 'Ledger': {
      if (!date('Date')) need.push('Date is missing or wrong');
      const type = sheet.name === 'Costs' ? 'expense' : /^inc/i.test(txt(v.Type)) ? 'income' : /^exp/i.test(txt(v.Type)) ? 'expense' : '';
      if (!type) need.push('Type must be Expense or Income');
      if (need.length) return { err: need.join('; ') };
      return { rec: { id, date: date('Date'), type, category: type === 'income' ? 'income' : cat, description: txt(v.Description), vendor: txt(v.Supplier, 80), amount: r2(amount), currency: cur, xl } };
    }
    case 'Payments': {
      if (!date('Date')) need.push('Date is missing or wrong');
      const dir = /^rec/i.test(txt(v.Direction)) ? 'income' : /^paid|^pay/i.test(txt(v.Direction)) ? 'expense' : '';
      if (!dir) need.push('Direction must be Paid or Received');
      if (need.length) return { err: need.join('; ') };
      return { rec: { id, date: date('Date'), type: dir, category: dir === 'income' ? 'income' : 'material', description: `${dir === 'income' ? 'Payment received' : 'Payment'}${txt(v.For) ? ` for ${txt(v.For, 60)}` : ''}`, vendor: txt(v.Party, 80), amount: r2(amount), currency: cur, method: txt(v.Method, 30), xl } };
    }
    case 'Supplier bills': {
      if (!txt(v.Supplier)) need.push('Supplier is missing');
      if (!date('Date')) need.push('Date is missing or wrong');
      if (v.Due !== '' && v.Due != null && !date('Due')) need.push('Due date is wrong');
      if (need.length) return { err: need.join('; ') };
      const paid = date('Paid on');
      return { rec: { id, number: txt(v.Number, 40), supplier: txt(v.Supplier, 80), date: date('Date'), due: date('Due'), category: cat, amount: r2(amount), currency: cur, paid: paid ? { date: paid, method: '', ref: '' } : null, xl } };
    }
    case 'Invoices': case 'Quotations': {
      const quote = sheet.name === 'Quotations';
      if (!txt(v.Number)) need.push('Number is missing');
      if (!date('Date')) need.push('Date is missing or wrong');
      const st = txt(v.Status).toLowerCase() || 'draft', ok = quote ? ['draft', 'sent', 'accepted'] : ['draft', 'sent', 'paid'];
      if (!ok.includes(st)) need.push(`Status must be ${ok.join(', ')}`);
      const vatP = numOf(v['VAT %']) || 0, retP = quote ? 0 : numOf(v['Retention %']) || 0;
      if (need.length) return { err: need.join('; ') };
      const vat = r2(amount * vatP / 100), total = r2(amount + vat), retention = r2(amount * retP / 100);
      return { rec: { id, type: quote ? 'quote' : 'invoice', number: txt(v.Number, 40), date: date('Date'), due: date(quote ? 'Valid until' : 'Due'), status: st, party: { name: txt(v.Client, 80), address: '', contact: '', taxId: '' },
        lines: [{ description: txt(v.Description) || (quote ? 'Quotation' : 'Invoice'), qty: 1, unit: '', rate: r2(amount), amount: r2(amount) }], subtotal: r2(amount), vat, total, retention, amountDue: st === 'paid' ? 0 : r2(total - retention), period: null, xl } };
    }
    case 'Tasks': {
      if (!txt(v.Task)) need.push('Task is missing');
      if (!date('Start')) need.push('Start is missing or wrong');
      const d = numOf(v['Working days']);
      if (!(d > 0)) need.push('Working days must be a number above 0');
      const q = numOf(v['Total quantity']);
      if (Number.isNaN(q)) need.push('Total quantity is not a number');
      if (need.length) return { err: need.join('; ') };
      return { rec: { id, name: txt(v.Task, 120), start: date('Start'), duration: Math.round(d), totalQty: q || 0, unit: txt(v.Unit, 12), milestone: yes(v.Milestone), deps: [], xl } };
    }
    case 'Progress': {
      if (!date('Date')) need.push('Date is missing or wrong');
      const key = txt(v.Task, 120), t = ctx.taskByRef[key] || ctx.taskByName[key.toLowerCase()];
      if (!t) need.push(`Task "${key}" is not in the schedule or the Tasks sheet`);
      const p = numOf(v['% done']), q = numOf(v['Quantity done']);
      if ((p == null && q == null) || Number.isNaN(p) || Number.isNaN(q) || (p != null && (p < 0 || p > 100))) need.push('% done (0-100) or Quantity done is needed');
      if (need.length) return { err: need.join('; ') };
      return { rec: { id, date: date('Date'), by: 'Excel', entries: [{ taskId: t.id, progress: p == null ? null : r2(p), qty: q || 0, delayDays: 0, note: txt(v.Note) }], xl } };
    }
  }
  return { err: 'Unknown sheet' };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const WORD = { date: 'Date', type: 'Type', category: 'Category', description: 'Description', vendor: 'Supplier', amount: 'Amount', currency: 'Currency', method: 'Method', number: 'Number', supplier: 'Supplier', due: 'Due', paid: 'Paid', status: 'Status', party: 'Client', lines: 'Description / amount', subtotal: 'Amount', vat: 'VAT', total: 'Total', retention: 'Retention', amountDue: 'Amount due', name: 'Task', start: 'Start', duration: 'Working days', totalQty: 'Total quantity', unit: 'Unit', milestone: 'Milestone', entries: 'Progress' };
const show = v => (v == null ? '' : typeof v === 'object' ? (v.name ?? v.date ?? JSON.stringify(v)) : String(v));
export function lineOf(rec) {
  if (!rec) return '';
  if (rec.entries) return `${rec.date} · ${rec.entries.map(e => `${e.progress != null ? `${e.progress}%` : ''}${e.qty ? ` ${e.qty} done` : ''}`).join(', ')}`;
  if (rec.name) return `${rec.name} · from ${rec.start}, ${rec.duration} working days`;
  if (rec.type === 'invoice' || rec.type === 'quote') return `${rec.number} · ${rec.date} · ${rec.party?.name || ''} · ${rec.total}`;
  if (rec.supplier) return `${rec.number || 'Bill'} · ${rec.supplier} · ${rec.amount} ${rec.currency}`;
  return `${rec.date} · ${rec.description || rec.vendor || ''} · ${rec.amount} ${rec.currency}`;
}

/**
 * sheets: { name: rows } from the file; existing: { section: records }; -> { changes, errors }.
 * A change: { id, kind: new|changed|removed, sheet, ref, section, before, after, text, diffs: [[field, old, new]] }.
 */
export function diffOf({ sheets = {}, existing = {}, cur = 'ETB' }) {
  const errors = [], wanted = [];
  const tasks = existing.tasks || [];
  const taskByRef = {}, taskByName = {};
  for (const t of tasks) { if (t.xl?.ref) taskByRef[t.xl.ref] = t; if (t.name) taskByName[String(t.name).toLowerCase()] = t; }
  const present = new Set();
  // tasks first, so Progress may name a task that is new in the same file
  const order = [...SHEETS].sort((a, b) => (a.name === 'Tasks' ? -1 : b.name === 'Tasks' ? 1 : 0));
  for (const sh of order) {
    const rows = sheets[sh.name];
    if (!rows) continue;
    present.add(sh.name);
    const head = (rows[0] || []).map(h => txt(h, 40));
    const missing = sh.cols.filter(c => !head.includes(c));
    if (missing.length) { errors.push({ sheet: sh.name, row: 1, ref: '', text: `Columns missing: ${missing.join(', ')}` }); continue; }
    const seen = new Set();
    rows.slice(1).forEach((r, i) => {
      const v = Object.fromEntries(head.map((h, k) => [h, r[k] ?? '']));
      if (sh.cols.every(c => v[c] === '' || v[c] == null)) return;
      const ref = txt(v.Ref, 60);
      if (!ref) return errors.push({ sheet: sh.name, row: i + 2, ref: '', text: 'Ref is missing' });
      if (seen.has(ref)) return errors.push({ sheet: sh.name, row: i + 2, ref, text: 'The same Ref is used twice' });
      seen.add(ref);
      const out = recordOf(sh, v, { cur, taskByRef, taskByName });
      if (out.err) return errors.push({ sheet: sh.name, row: i + 2, ref, text: out.err });
      if (sh.name === 'Tasks') { taskByRef[ref] = out.rec; taskByName[out.rec.name.toLowerCase()] = taskByRef[ref]; }
      wanted.push({ sh, rec: out.rec });
    });
  }
  const changes = [], ids = new Set();
  for (const { sh, rec } of wanted) {
    ids.add(rec.id);
    const old = (existing[sh.section] || []).find(x => x.id === rec.id);
    const base = { id: rec.id, sheet: sh.name, ref: rec.xl.ref, section: sh.section, after: rec, text: lineOf(rec) };
    if (!old) { changes.push({ ...base, kind: 'new', before: null, diffs: [] }); continue; }
    const diffs = Object.keys(rec).filter(k => k !== 'xl' && k !== 'id' && !same(rec[k], old[k])).map(k => [WORD[k] || k, show(old[k]), show(rec[k])]);
    if (diffs.length) changes.push({ ...base, kind: 'changed', before: old, after: { ...old, ...rec }, diffs });
  }
  for (const sh of SHEETS) {
    if (!present.has(sh.name)) continue;   // a sheet left out of the file proposes nothing
    for (const old of existing[sh.section] || []) {
      if (old.xl?.sheet === sh.name && !ids.has(old.id)) changes.push({ id: old.id, kind: 'removed', sheet: sh.name, ref: old.xl.ref, section: sh.section, before: old, after: null, text: lineOf(old), diffs: [] });
    }
  }
  return { changes: changes.slice(0, MAX_CHANGES), errors: errors.slice(0, 200), more: Math.max(0, changes.length - MAX_CHANGES) };
}

/** The sections a sync compares with. */
export const SECTIONS = [...new Set(SHEETS.map(s => s.section))];
export const KIND_WORD = { new: 'New', changed: 'Changed', removed: 'Removed in Excel' };
