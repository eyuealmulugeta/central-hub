// v1.4.0 (owner, 7 Nov, FR R6): purchases and the finance check. One chain per purchase: material request -> purchase
// order (made by the PE or the office from the approved request, out only after the GM+ approval of G4) -> deliveries
// (Field Report Store, Receive against the PO) -> supplier bill (against the PO) -> payment. The three-way check compares
// ordered, received and billed; a flagged bill, a USD bill or one above the PE limit needs the GM before it is paid
// (owner: same limits as expenses, SE 5,000 / PE 20,000 ETB). No automatic withholding (owner). Pure functions.

import { poLeft, itemKey } from '../fr/model/store.js';
import { approvalLimits } from './expenses.js';

export const TOL = 0.01;   // 1% (rounding, transport) before a difference is flagged
const r2 = v => Math.round((+v || 0) * 100) / 100;
const low = s => String(s || '').trim().toLowerCase();
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** A PO that went out (approved and sent); delivered = closed for the phone. */
export const isOut = d => d?.type === 'po' && ['sent', 'delivered'].includes(d.status);

/** What the phone sees of a PO (projects/<id>/poOpen/<id>): no prices. */
export const poPublic = d => ({
  id: d.id, number: d.number || '', supplier: d.party?.name || '', date: d.date || '', due: d.due || '',
  status: d.status === 'sent' ? 'open' : 'closed', reqId: d.reqId || '',
  lines: (d.lines || []).filter(l => String(l.description || '').trim() && +l.qty > 0).map(l => ({ item: String(l.description).trim(), unit: l.unit || '', qty: +l.qty })),
});

/** A draft PO from an approved material request: its lines, no prices yet, needed-by as the delivery date. */
export const poFromRequest = r => ({
  lines: (r.lines || []).filter(l => String(l.description || '').trim()).map(l => ({ description: String(l.description).trim(), qty: +l.qty || 0, unit: l.unit || '', rate: 0, amount: 0 })),
  due: r.neededBy || '', reqId: r.id, notes: `For ${r.number || 'the material request'}.`,
});

/**
 * One PO checked: ordered, received (at the PO prices, with its VAT), billed, paid, what is still to come and the flags.
 * short = billed more than what was received; over = billed above the PO; late = past the delivery date, still to come.
 */
export function poCheck(po, { moves = [], bills = [], today = '' } = {}) {
  const pub = poPublic(po), left = poLeft(pub, moves);
  const vat = 1 + (+po.vatPct || 0) / 100;
  const rate = {};
  (po.lines || []).forEach(l => { if (String(l.description || '').trim()) rate[itemKey(l.description, l.unit)] = +l.rate || 0; });
  const ordered = r2(+po.total || (po.lines || []).reduce((s, l) => s + (+l.amount || 0), 0) * vat);
  const received = r2(left.lines.reduce((s, l) => s + l.got * (rate[l.key] || 0), 0) * vat);
  const bs = bills.filter(b => b.po === po.id);
  const billed = r2(bs.reduce((s, b) => s + (+b.amount || 0), 0)), paid = r2(bs.filter(b => b.paid).reduce((s, b) => s + (+b.amount || 0), 0));
  const flags = [];
  if (billed > received * (1 + TOL) + 1) flags.push({ key: 'short', text: received ? `Billed ${billed.toLocaleString()} but goods received are worth ${received.toLocaleString()}` : 'Billed, but nothing received on site yet' });
  if (billed > ordered * (1 + TOL) + 1) flags.push({ key: 'over', text: `Billed ${billed.toLocaleString()}, above the PO (${ordered.toLocaleString()})` });
  if (po.status === 'sent' && left.open && po.due && today && po.due < today) flags.push({ key: 'late', text: `Delivery late since ${po.due}` });
  return { id: po.id, number: po.number, supplier: pub.supplier, date: po.date, due: po.due, reqId: po.reqId || '', ordered, received, billed, paid, open: r2(billed - paid), toCome: left.lines.filter(l => l.left > 0), flags };
}

/** The flags that hold a bill (late delivery does not). A bill without a PO is not checked. */
export function billFlags(b, { docs = [], moves = [], bills = [] } = {}) {
  if (!b?.po) return [];
  const po = docs.find(d => d.id === b.po);
  if (!po) return [{ key: 'nopo', text: 'Its purchase order was deleted' }];
  return poCheck(po, { moves, bills }).flags.filter(f => f.key !== 'late');
}

/** Who approves paying a bill: 1 SE (up to 5,000 ETB), 2 PE (up to 20,000 ETB), 3 GM (above, USD, or flagged). */
export function payLevel(b, flags = [], settings) {
  if (flags.length || (b.currency || 'ETB') !== 'ETB') return 3;
  const L = approvalLimits(settings), a = +b.amount || 0;
  return a <= (+L.site_engineer.ETB || 0) ? 1 : a <= (+L.project_manager.ETB || 0) ? 2 : 3;
}
/** May this person approve the payment: high enough, and not the person who entered it (the GM may). */
export const mayOkBill = (b, { level = 0, me = '' } = {}, need = 3) => !b.paid && !(b.ok && b.ok.level >= need) && level >= need && (level === 3 || low(b.by) !== low(me));
/** Approved by someone high enough (a bill changed after approval, or newly flagged, needs it again). */
export const payable = (b, need) => !!b.ok && +b.ok.level >= need && +b.ok.amount === +b.amount;

/** Per supplier: ordered, received, billed, paid, owed, the oldest unpaid bill in days, owed by age. */
export function supplierRows({ docs = [], bills = [], moves = [], today = '' } = {}) {
  const out = {};
  const row = name => (out[low(name) || '—'] ||= { supplier: String(name || '').trim() || '—', ordered: 0, received: 0, billed: 0, paid: 0, owed: 0, oldest: 0, age: { d30: 0, d60: 0, older: 0 }, flags: 0, pos: 0 });
  for (const po of docs.filter(isOut)) {
    const c = poCheck(po, { moves, bills, today }), x = row(c.supplier);
    x.ordered += c.ordered; x.received += c.received; x.flags += c.flags.length; x.pos++;
  }
  for (const b of bills) {
    const x = row(b.supplier), a = +b.amount || 0;
    x.billed += a;
    if (b.paid) { x.paid += a; continue; }
    x.owed += a;
    const d = b.date && today ? Math.max(0, days(b.date, today)) : 0;
    x.oldest = Math.max(x.oldest, d);
    x.age[d <= 30 ? 'd30' : d <= 60 ? 'd60' : 'older'] += a;
  }
  return Object.values(out).map(x => ({ ...x, ordered: r2(x.ordered), received: r2(x.received), billed: r2(x.billed), paid: r2(x.paid), owed: r2(x.owed) }))
    .sort((a, b) => b.owed - a.owed || a.supplier.localeCompare(b.supplier));
}

/** Everything that needs a look: flagged POs, material bills with no PO, cash material purchases with no store receipt. */
export function problems({ docs = [], bills = [], moves = [], requests = [], today = '' } = {}) {
  const out = [];
  for (const po of docs.filter(isOut)) for (const f of poCheck(po, { moves, bills, today }).flags) out.push({ kind: f.key, ref: po.number, supplier: po.party?.name || '', text: f.text });
  for (const b of bills) if (!b.po && (b.category || 'material') === 'material' && !b.paid) out.push({ kind: 'nopo', ref: b.number || '', supplier: b.supplier, text: 'Material bill without a purchase order' });
  const got = new Set(moves.filter(m => m.kind === 'receive' && m.reqId && ['approved', 'waiting'].includes(m.status)).map(m => m.reqId));
  for (const r of requests) {
    if (r.kind !== 'expense' || (r.category || '') !== 'material' || !['approved', 'paid'].includes(r.status) || got.has(r.id)) continue;
    out.push({ kind: 'cash', ref: r.number || '', supplier: r.vendor || '', text: 'Cash material purchase not received in the site store' });
  }
  return out;
}
export const PROBLEM_WORD = { short: 'Short delivery', over: 'Over-billed', late: 'Late delivery', nopo: 'No PO', cash: 'Cash, no receipt' };

/** The month-end check (owner: the accountant marks the month checked). */
export const monthOf = d => String(d || '').slice(0, 7);
export const mayMarkMonth = ({ role, ranks } = {}) => role === 'owner' || (ranks || []).some(r => ['accountant', 'general_manager'].includes(r));
export const checkedMonth = (checks, month) => (checks || []).find(x => x.id === month) || null;

/** Excel rows: per PO, then per supplier. */
export function csvRows(checks, suppliers) {
  const rows = [['PO', 'Supplier', 'Date', 'Deliver by', 'Ordered', 'Received', 'Billed', 'Paid', 'Owed', 'Still to come', 'Problems']];
  for (const c of checks) rows.push([c.number, c.supplier, c.date, c.due || '', c.ordered, c.received, c.billed, c.paid, c.open, c.toCome.map(l => `${l.item} ${l.left} ${l.unit}`).join('; '), c.flags.map(f => f.text).join('; ')]);
  rows.push([], ['Supplier', 'POs', 'Ordered', 'Received', 'Billed', 'Paid', 'Owed', 'Owed 0-30 days', 'Owed 31-60 days', 'Owed over 60 days', 'Oldest unpaid (days)']);
  for (const s of suppliers) rows.push([s.supplier, s.pos, s.ordered, s.received, s.billed, s.paid, s.owed, s.age.d30, s.age.d60, s.age.older, s.oldest]);
  return rows;
}
