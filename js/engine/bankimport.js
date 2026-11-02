// v0.62.0 (owner, 2 Nov, Phase B2): a bank statement, read from the bank's CSV or Excel file, matched to the Ledger.
// Ethiopian banks have no open link, so the statement is imported: the columns are recognised (date, description,
// debit, credit, reference) and can be corrected once per bank; each line is matched to a Ledger entry by the bank
// reference, else by the same amount within 5 days. Matched entries are marked "In bank". Pure functions.

/** Rows of a CSV (comma, semicolon or tab; quotes allowed), as arrays of trimmed text. */
export function parseCSV(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const WORDS = {
  date: /^(transaction |trans\.? |value |posting |book(ing)? )?date$|^date\b/i,
  text: /description|narration|particular|details|remark|transaction details|memo/i,
  debit: /debit|withdraw|paid out|money out|^dr\b|outflow/i,
  credit: /credit|deposit|paid in|money in|^cr\b|inflow/i,
  amount: /^amount$|^amount \(|transaction amount/i,
  ref: /reference|^ref\b|ref\.? ?no|cheque|check no|transaction id|txn|ft ?no/i,
};
export const FIELDS = [['date', 'Date'], ['text', 'Description'], ['debit', 'Money out (debit)'], ['credit', 'Money in (credit)'], ['amount', 'Amount (+ in, − out)'], ['ref', 'Reference']];

/** Where the header row is (the first row naming a date and an amount or debit column) and which column is which. */
export function detectColumns(rows) {
  for (let h = 0; h < Math.min(rows.length, 25); h++) {
    const head = rows[h].map(x => String(x || '').trim());
    const map = {};
    for (const [k, re] of Object.entries(WORDS)) {
      const i = head.findIndex((x, j) => x && re.test(x) && !Object.values(map).includes(j));
      if (i >= 0) map[k] = i;
    }
    if (map.date != null && (map.debit != null || map.credit != null || map.amount != null)) return { header: h, map };
  }
  return { header: 0, map: {} };
}

/** A key for a bank's layout, so the columns chosen once are used again for its next statement. */
export const layoutKey = head => head.map(x => String(x || '').trim().toLowerCase()).join('|');

/** 1,234.50 / (1,234.50) / -1234,5 / "ETB 1 234" -> a number; '' -> 0. */
export function amountOf(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-|-$/.test(s.replace(/[^\d.,()-]/g, ''));
  s = s.replace(/[^\d.,]/g, '');
  if (/,\d{1,2}$/.test(s) && s.lastIndexOf('.') < s.lastIndexOf(',')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');   // 1.234,5 = 1234.5
  const n = parseFloat(s) || 0;
  return neg ? -n : n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
/** A statement date (2026-11-02, 02/11/2026, 2-Nov-2026, 02 Nov 26, or an Excel day number) as YYYY-MM-DD; '' when unclear. */
export function dateOf(v) {
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{2,4})/);
  if (m) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);   // day first, as Ethiopian and most statements print it
  if (m) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return '';
}

/** The statement's lines: { id, date, text, ref, out, in } (out and in positive), header and empty rows left out. */
export function linesOf(rows, { header = 0, map = {} } = {}) {
  const out = [];
  rows.slice(header + 1).forEach((r, i) => {
    const date = dateOf(r[map.date]);
    if (!date) return;
    let o = map.debit != null ? Math.abs(amountOf(r[map.debit])) : 0;
    let n = map.credit != null ? Math.abs(amountOf(r[map.credit])) : 0;
    if (map.amount != null && !o && !n) { const a = amountOf(r[map.amount]); if (a < 0) o = -a; else n = a; }
    if (!o && !n) return;
    out.push({ id: `b${i}`, date, text: String(r[map.text] ?? '').trim(), ref: String(r[map.ref] ?? '').trim(), out: Math.round(o * 100) / 100, in: Math.round(n * 100) / 100 });
  });
  return out;
}

const dayNo = d => Math.round(Date.parse(`${d}T00:00:00Z`) / 864e5);
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Each statement line matched to a Ledger entry of the same currency and direction (an expense = money out):
 * 'matched' when the reference is the entry's bank reference (or in its description) and the amount is the same,
 * 'maybe' when only the amount is the same within `days` days, else 'none'. An entry is used once; one already
 * marked in the bank is not used again.
 */
export function matchLines(lines, ledger, { currency = 'ETB', days = 5 } = {}) {
  const used = new Set();
  const pool = (ledger || []).filter(e => (e.currency || '') === currency && !e.bank);
  const amt = (l, e) => Math.abs((e.type === 'income' ? l.in : l.out) - +e.amount) < 0.01;
  const res = lines.map(l => ({ line: l, status: 'none', entryId: '' }));
  // first the sure ones (reference), then the rest by amount and the nearest date
  for (const r of res) {
    const ref = norm(r.line.ref);
    if (ref.length < 4) continue;
    const e = pool.find(x => !used.has(x.id) && amt(r.line, x) && (norm(x.bankRef) === ref || norm(x.description).includes(ref) || norm(r.line.text).includes(norm(x.bankRef) || '\u0000')));
    if (e) { used.add(e.id); Object.assign(r, { status: 'matched', entryId: e.id }); }
  }
  for (const r of res) {
    if (r.status !== 'none') continue;
    const near = pool.filter(x => !used.has(x.id) && amt(r.line, x) && Math.abs(dayNo(x.date) - dayNo(r.line.date)) <= days)
      .sort((a, b) => Math.abs(dayNo(a.date) - dayNo(r.line.date)) - Math.abs(dayNo(b.date) - dayNo(r.line.date)));
    if (near[0]) { used.add(near[0].id); Object.assign(r, { status: 'maybe', entryId: near[0].id }); }
  }
  return res;
}

/** The Ledger entry for a statement line nobody entered (money out = a cost, money in = a payment received). */
export const entryOfLine = (l, id, currency, category = 'overhead') => ({
  id, date: l.date, type: l.in > 0 ? 'income' : 'expense', category, description: l.text || 'From the bank statement', vendor: '',
  amount: l.in > 0 ? l.in : l.out, currency, bankRef: l.ref, bank: { date: l.date, ref: l.ref },
});
