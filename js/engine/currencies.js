// Central Hub works in three currencies only: ETB, USD and AED. Anything recorded in another currency is converted
// to USD once, at the rate in the Settings table on the day of the conversion, and keeps its original amount and
// currency in a note (fxFrom) on the record. Pure functions: the screen (ui/prices.js) saves what they return.

import { convert } from './pricing.js';

export const ALLOWED = ['ETB', 'USD', 'AED'];
export const isForeign = c => !!c && !ALLOWED.includes(String(c).toUpperCase());

// the number fields that hold money, wherever they appear on a record
const MONEY = ['amount', 'value', 'pay', 'price', 'rate', 'total', 'cost', 'budget', 'contractValue', 'dayRate', 'subtotal', 'vat', 'retention', 'amountDue', 'paid', 'unitPrice', 'landedCost', 'freight', 'duty', 'deposit', 'balance'];
const round2 = v => Math.round(v * 100) / 100;

/** The note kept on a converted record: what it was, and at what rate. */
const noteOf = (from, fx, on, was) => ({ currency: from, ratePerUsd: fx.rates[from] / (fx.rates.USD || 1), on, was });

/** Money fields of one object converted from `from` to USD (and those of its `lines`). Returns null when nothing changed. */
function convertMoney(obj, from, fx) {
  const out = { ...obj }, was = {};
  for (const k of MONEY) if (typeof obj[k] === 'number') { was[k] = obj[k]; out[k] = round2(convert(obj[k], from, 'USD', fx)); }
  if (Array.isArray(obj.lines)) out.lines = obj.lines.map(l => convertMoney(l, from, fx)?.out || l);
  return Object.keys(was).length || out.lines ? { out, was } : null;
}

/** One record that names its own currency (a cost, a contract, a payslip line): converted when that currency is not allowed. */
export function convertRecord(rec, fx, on, fallback = '') {
  const from = rec?.currency || fallback;
  if (!isForeign(from)) return null;
  const m = convertMoney(rec, from, fx) || { out: { ...rec }, was: {} };
  return { ...m.out, currency: 'USD', fxFrom: noteOf(from, fx, on, m.was) };
}

/** The shared settings: price regions and their prices to USD where foreign, then the rate table cut to ETB, USD and AED. */
export function convertGlobal(global, on) {
  const fx = global.fx, changes = [];
  const regions = (global.regions || []).map(r => (isForeign(r.currency) ? (changes.push(`Region ${r.name}: ${r.currency} to USD`), { ...r, currency: 'USD', fxFrom: noteOf(r.currency, fx, on, {}) }) : r));
  const prices = {};
  for (const [rid, row] of Object.entries(global.prices || {})) {
    prices[rid] = {};
    for (const [mid, p] of Object.entries(row || {})) {
      if (isForeign(p?.currency)) { prices[rid][mid] = { price: round2(convert(p.price, p.currency, 'USD', fx)), currency: 'USD' }; changes.push(`Price ${mid} in ${rid}`); }
      else prices[rid][mid] = p;
    }
  }
  // the table: USD becomes the base if it was not; only the allowed currencies stay
  const perUsd = k => fx.rates[k] / (fx.rates.USD || 1);
  const rates = Object.fromEntries(ALLOWED.filter(k => fx.rates[k] > 0).map(k => [k, Math.round(perUsd(k) * 10000) / 10000]));
  const dropped = Object.keys(fx.rates).filter(k => !ALLOWED.includes(k));
  if (dropped.length) changes.push(`Exchange rates removed: ${dropped.join(', ')}`);
  return { global: { ...global, regions, prices, fx: { base: 'USD', rates: { ...rates, USD: 1 } } }, changes };
}

/** A project in a foreign currency, and its workspace: every amount in that currency to USD. Costs that name their own currency are converted on their own terms. */
export function convertProject(project, ws, fx, on) {
  const from = project.currency, foreign = isForeign(from), changes = [];
  let p = project;
  if (foreign) {
    const was = {};
    p = { ...project, currency: 'USD' };
    for (const k of ['budget', 'contractValue']) if (typeof project[k] === 'number') { was[k] = project[k]; p[k] = round2(convert(project[k], from, 'USD', fx)); }
    p.fxFrom = noteOf(from, fx, on, was);
    changes.push(`Project ${project.name}: ${from} to USD`);
  }
  const w = { ...ws };
  const ledger = (ws.ledger || []).map(e => { const c = convertRecord(e, fx, on, from); if (c) changes.push(`Cost ${e.description || e.id}`); return c || e; });
  if (changes.length || ledger.some((e, i) => e !== ws.ledger[i])) w.ledger = ledger;
  if (foreign) {
    const map = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'number' ? round2(convert(v, from, 'USD', fx)) : v]));
    w.laborRates = map(ws.laborRates);
    w.billRates = map(ws.billRates);
    w.measure = (ws.measure || []).map(m => ({ ...m, rate: round2(convert(m.rate || 0, from, 'USD', fx)) }));
    // a milestone given as a % of the contract stays a %; one given as an amount is converted
    if ((project.billing?.method || 'milestone_pct') !== 'milestone_pct') w.payStages = (ws.payStages || []).map(s => ({ ...s, value: round2(convert(s.value || 0, from, 'USD', fx)) }));
    w.docs = (ws.docs || []).map(d => { const m = convertMoney(d, from, fx); return m ? { ...m.out, fxFrom: noteOf(from, fx, on, m.was) } : d; });
    w.team = (ws.team || []).map(t => (typeof t.dayRate === 'number' && t.dayRate ? { ...t, dayRate: round2(convert(t.dayRate, from, 'USD', fx)) } : t));
  }
  return { project: p, ws: w, changes };
}

/** Company records (staff pay, contracts, payroll, shipments, sales): each one that names a foreign currency. */
export function convertCompany(company, fx, on) {
  const out = {}, changes = [];
  for (const [section, list] of Object.entries(company || {})) {
    if (!Array.isArray(list)) continue;
    let touched = false;
    const next = list.map(r => { const c = r && typeof r === 'object' ? convertRecord(r, fx, on) : null; if (c) { touched = true; changes.push(`${section}: ${r.name || r.title || r.number || r.id}`); } return c || r; });
    if (touched) out[section] = next;
  }
  return { sections: out, changes };
}

/** What is still in another currency, for the Settings page: the rate table, regions, prices, projects and company records. */
export function foreignSummary(global, projects, company) {
  const rows = [];
  const rates = Object.keys(global?.fx?.rates || {}).filter(isForeign);
  if (rates.length) rows.push(`Exchange rates: ${rates.join(', ')}`);
  for (const r of global?.regions || []) if (isForeign(r.currency)) rows.push(`Region ${r.name}: ${r.currency}`);
  const prices = Object.values(global?.prices || {}).flatMap(row => Object.values(row || {})).filter(p => isForeign(p?.currency)).length;
  if (prices) rows.push(`${prices} material price${prices > 1 ? 's' : ''}`);
  for (const p of projects || []) if (isForeign(p.currency)) rows.push(`Project ${p.name}: ${p.currency}`);
  for (const [section, list] of Object.entries(company || {})) {
    const n = Array.isArray(list) ? list.filter(r => r && isForeign(r.currency)).length : 0;
    if (n) rows.push(`${n} ${section} record${n > 1 ? 's' : ''}`);
  }
  return rows;
}
