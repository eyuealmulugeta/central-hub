// v0.25.0 (Phase A2): Central Hub keeps its books in USD only: contracts, costs, invoices and payments to the
// company. Staff pay is the one exception: each person is paid in USD or ETB (their HR agreement, or the project's
// pay currency for day rates), and each ETB pay keeps its own ETB-to-USD rate, typed with that pay.
// Anything else in another currency is converted to USD once, at the rate saved on the record (usdRate) or else the
// rate in the Settings table, and keeps its original amount and currency in a note (fxFrom). Pure functions: the
// screen (ui/prices.js) shows the list of what would change, and saves what they return only once the Admin agrees.

export const ALLOWED = ['USD'];
/** The currencies a person may be paid in. */
export const PAY_CURRENCIES = ['USD', 'ETB'];
export const BOOK_OPTIONS = [['USD', 'USD']];
export const PAY_OPTIONS = PAY_CURRENCIES.map(k => [k, k]);
export const isForeign = c => !!c && !ALLOWED.includes(String(c).toUpperCase());
const isPay = c => PAY_CURRENCIES.includes(String(c || '').toUpperCase());

/** Units of `cur` per 1 USD: the rate saved on the record, else the table. */
const rateFor = (rec, cur, fx) => (+rec?.usdRate > 0 ? +rec.usdRate : (fx.rates[cur] || 0) / (fx.rates.USD || 1));
const toUsd = (v, rate) => (rate > 0 ? v / rate : v);
/** An amount in another currency, in USD, at a pay's own rate (ETB per 1 USD). 0 when the rate is missing. */
export const usdOf = (amount, currency, usdRate) => (String(currency || 'USD').toUpperCase() === 'USD' ? +amount || 0 : +usdRate > 0 ? (+amount || 0) / +usdRate : 0);
const fmt = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
/** One line of the list shown before converting: what, from what amount to what, and at which rate. */
const said = (what, from, was, now, rate, own) => ({ what, from, was, usd: now, rate, own: !!own,
  text: `${what}: ${was === null ? `${from} → USD, ` : `${fmt(was)} ${from} → ${fmt(now)} USD, `}at ${fmt(rate)} ${from} per USD${own ? ' (rate on the record)' : ''}` });

// the number fields that hold money, wherever they appear on a record
const MONEY = ['amount', 'value', 'pay', 'price', 'rate', 'total', 'cost', 'budget', 'contractValue', 'dayRate', 'subtotal', 'vat', 'retention', 'amountDue', 'paid', 'unitPrice', 'landedCost', 'freight', 'duty', 'deposit', 'balance'];
const round2 = v => Math.round(v * 100) / 100;

/** The note kept on a converted record: what it was, and at what rate. */
const noteOf = (from, rate, on, was) => ({ currency: from, ratePerUsd: rate, on, was });
const firstMoney = was => { const k = Object.keys(was)[0]; return k ? was[k] : null; };

/** Money fields of one object converted from `from` to USD (and those of its `lines`). Returns null when nothing changed. */
function convertMoney(obj, from, rate) {
  const out = { ...obj }, was = {};
  for (const k of MONEY) if (typeof obj[k] === 'number') { was[k] = obj[k]; out[k] = round2(toUsd(obj[k], rate)); }
  if (Array.isArray(obj.lines)) out.lines = obj.lines.map(l => convertMoney(l, from, rate)?.out || l);
  return Object.keys(was).length || out.lines ? { out, was } : null;
}

/** One record that names its own currency (a cost, a contract, a payslip line): converted when that currency is not allowed. */
export function convertRecord(rec, fx, on, fallback = '') {
  const from = rec?.currency || fallback;
  if (!isForeign(from)) return null;
  const rate = rateFor(rec, from, fx);
  const m = convertMoney(rec, from, rate) || { out: { ...rec }, was: {} };
  const out = { ...m.out, currency: 'USD', fxFrom: noteOf(from, rate, on, m.was) };
  delete out.usdRate;
  const was = firstMoney(m.was);
  return Object.defineProperty(out, 'said', { value: (what) => said(what, from, was, was === null ? null : round2(toUsd(was, rate)), rate, +rec?.usdRate > 0), enumerable: false });
}
const tellOf = (c, what) => c.said(what);

/** The shared settings: price regions and their prices to USD where foreign, then the rate table cut to ETB, USD and AED. */
export function convertGlobal(global, on) {
  const fx = global.fx, changes = [];
  const perUsd = k => (fx.rates[k] || 0) / (fx.rates.USD || 1);
  const regions = (global.regions || []).map(r => (isForeign(r.currency) ? (changes.push(said(`Country ${r.name}: its currency ${r.currency} is no longer used`, r.currency, null, null, perUsd(r.currency))), { ...r, currency: 'USD', fxFrom: noteOf(r.currency, perUsd(r.currency), on, {}) }) : r));
  const prices = {};
  for (const [rid, row] of Object.entries(global.prices || {})) {
    prices[rid] = {};
    for (const [mid, p] of Object.entries(row || {})) {
      if (isForeign(p?.currency)) { const now = round2(toUsd(p.price, perUsd(p.currency))); prices[rid][mid] = { price: now, currency: 'USD' }; changes.push(said(`Price ${mid} in ${rid}`, p.currency, p.price, now, perUsd(p.currency))); }
      else prices[rid][mid] = p;
    }
  }
  // the table: USD becomes the base if it was not; USD and ETB stay (ETB suggests the rate of an ETB pay)
  const rates = Object.fromEntries(PAY_CURRENCIES.filter(k => fx.rates[k] > 0).map(k => [k, Math.round(perUsd(k) * 10000) / 10000]));
  const dropped = Object.keys(fx.rates).filter(k => !PAY_CURRENCIES.includes(k));
  if (dropped.length) changes.push({ what: 'Exchange rates', text: `Exchange rates removed: ${dropped.join(', ')}` });
  return { global: { ...global, regions, prices, fx: { base: 'USD', rates: { ...rates, USD: 1 } } }, changes };
}

/** A project in a foreign currency, and its workspace: every amount in that currency to USD. Costs that name their own currency are converted on their own terms. */
export function convertProject(project, ws, fx, on) {
  const from = project.currency, foreign = isForeign(from), changes = [];
  const rate = (fx.rates[from] || 0) / (fx.rates.USD || 1);
  const conv = v => round2(toUsd(v, rate));
  const tag = `${project.name}: `;
  let p = project;
  if (foreign) {
    const was = {};
    p = { ...project, currency: 'USD' };
    for (const k of ['budget', 'labourBudget', 'contractValue']) if (typeof project[k] === 'number') { was[k] = project[k]; p[k] = conv(project[k]); }
    p.fxFrom = noteOf(from, rate, on, was);
    // day rates are pay: an ETB project keeps paying its crew in ETB, each pay at its own rate
    if (isPay(from)) p.payCurrency = from.toUpperCase();
    changes.push(said(`${tag}contract value (the project's currency becomes USD)`, from, project.contractValue || 0, p.contractValue || 0, rate));
    if (project.budget) changes.push(said(`${tag}budget`, from, project.budget, p.budget, rate));
  }
  const w = { ...ws };
  const ledger = (ws.ledger || []).map(e => { const c = convertRecord(e, fx, on, from); if (c) changes.push(tellOf(c, `${tag}cost ${e.description || e.id}`)); return c || e; });
  if (changes.length || ledger.some((e, i) => e !== ws.ledger[i])) w.ledger = ledger;
  const paycosts = (ws.paycosts || []).map(e => { const c = convertRecord(e, fx, on, from); if (c) changes.push(tellOf(c, `${tag}crew pay cost ${e.description || e.id}`)); return c || e; });
  if (paycosts.some((e, i) => e !== ws.paycosts[i])) w.paycosts = paycosts;
  // pay already made in ETB stays in ETB; one with no rate of its own gets the table's, so it can be shown in USD
  const payments = (ws.payments || []).map(x => (isPay(x.currency) && x.currency !== 'USD' && !(+x.usdRate > 0) ? (changes.push(said(`${tag}payment to ${x.name} on ${x.date} keeps ${x.currency}, rate added`, x.currency, null, null, (fx.rates[x.currency] || 0) / (fx.rates.USD || 1))), { ...x, usdRate: (fx.rates[x.currency] || 0) / (fx.rates.USD || 1) }) : x));
  if (payments.some((x, i) => x !== ws.payments[i])) w.payments = payments;
  if (foreign) {
    const map = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'number' ? conv(v) : v]));
    if (!isPay(from)) { w.laborRates = map(ws.laborRates); w.crewRates = (ws.crewRates || []).map(r => (+r.dayRate ? { ...r, dayRate: conv(r.dayRate) } : r)); }
    w.billRates = map(ws.billRates);
    w.measure = (ws.measure || []).map(m => ({ ...m, rate: conv(m.rate || 0) }));
    // a milestone given as a % of the contract stays a %; one given as an amount is converted
    if ((project.billing?.method || 'milestone_pct') !== 'milestone_pct') w.payStages = (ws.payStages || []).map(s => ({ ...s, value: conv(s.value || 0) }));
    w.docs = (ws.docs || []).map(d => { const m = convertMoney(d, from, rate); if (m) changes.push(said(`${tag}${d.type || 'document'} ${d.number || d.id}`, from, firstMoney(m.was), firstMoney(m.was) === null ? null : conv(firstMoney(m.was)), rate)); return m ? { ...m.out, fxFrom: noteOf(from, rate, on, m.was) } : d; });
  }
  return { project: p, ws: w, changes };
}

/** Company records (staff pay, contracts, payroll, shipments, sales): each one that names a foreign currency. */
export function convertCompany(company, fx, on) {
  const out = {}, changes = [];
  for (const [section, list] of Object.entries(company || {})) {
    if (!Array.isArray(list)) continue;
    let touched = false;
    const next = list.map(r => {
      // staff pay: an agreement in a currency nobody is paid in any more is converted; USD and ETB stay
      const a = r?.agreement;
      if (a && a.currency && !isPay(a.currency) && typeof a.pay === 'number') {
        const rate = rateFor(a, a.currency, fx); touched = true;
        changes.push(said(`${section}: pay of ${r.name}`, a.currency, a.pay, round2(toUsd(a.pay, rate)), rate, +a.usdRate > 0));
        return { ...r, agreement: { ...a, pay: round2(toUsd(a.pay, rate)), currency: 'USD', fxFrom: noteOf(a.currency, rate, on, { pay: a.pay }) } };
      }
      const c = r && typeof r === 'object' && section !== 'payroll' ? convertRecord(r, fx, on) : null;
      if (c) { touched = true; changes.push(tellOf(c, `${section}: ${r.name || r.title || r.number || r.id}`)); }
      return c || r;
    });
    if (touched) out[section] = next;
  }
  return { sections: out, changes };
}

/** What is still in another currency, for the Settings page: the rate table, regions, prices, projects and company records. */
export function foreignSummary(global, projects, company) {
  const rows = [];
  const rates = Object.keys(global?.fx?.rates || {}).filter(k => !PAY_CURRENCIES.includes(k));
  if (rates.length) rows.push(`Exchange rates: ${rates.join(', ')}`);
  for (const r of global?.regions || []) if (isForeign(r.currency)) rows.push(`Region ${r.name}: ${r.currency}`);
  const prices = Object.values(global?.prices || {}).flatMap(row => Object.values(row || {})).filter(p => isForeign(p?.currency)).length;
  if (prices) rows.push(`${prices} material price${prices > 1 ? 's' : ''}`);
  for (const p of projects || []) if (isForeign(p.currency)) rows.push(`Project ${p.name}: ${p.currency}`);
  for (const [section, list] of Object.entries(company || {})) {
    const n = Array.isArray(list) && section !== 'payroll' ? list.filter(r => r && (isForeign(r.currency) || (r.agreement?.currency && !isPay(r.agreement.currency)))).length : 0;
    if (n) rows.push(`${n} ${section} record${n > 1 ? 's' : ''}`);
  }
  return rows;
}
