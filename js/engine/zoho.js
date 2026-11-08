// v1.18.0 (owner, 8 Nov, G9): the month's books of the UAE company (Amistad Pre Fab Trading FZCO, Zoho Books, AED) as
// one .xlsx in Zoho's import format. Owner: the USD projects plus Trading (shipments, stock sales), crew pay included;
// USD to AED at the fixed peg (3.6725). Amounts go in USD with the exchange rate, so Zoho books them in AED itself; the
// AED amount is shown beside them. Nothing is exported twice: a month marked as sent keeps its records out of later files.
// Pure: the server (functions/zoho.js) gives it the records; the tests read it.

import { convert } from './pricing.js';
import { norm, dueOf } from './partners.js';   // v1.20.0 (G10 T2)

/** AED per USD: the UAE dirham is pegged to the dollar (owner: it does not move). */
export const PEG = 3.6725;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The Admin and the GM make the file; only the Admin marks a month as sent and changes the accounts (owner, G9). */
export const mayExport = (role, ranks = []) => role === 'owner' || (ranks || []).includes('general_manager');

/** The accounts of the UAE chart (imported into Zoho on 7 Nov) a Central Hub figure can go to. */
export const ACCOUNTS = [
  'Contract Revenue - Prefab Buildings', 'Contract Revenue - Site Works and Installation', 'Variation Orders', 'Sales - Prefab Units and Components', 'Trading Sales',
  'Transport and Delivery Income', 'Other Income', 'Materials - Steel and Panels', 'Materials - Other Site Materials', 'Site Labour - Daily Crew', 'Site Staff Salaries',
  'Subcontractors', 'Equipment and Crane Hire', 'Transport to Site', 'Import Duties and Customs Clearing', 'Import Freight and Insurance', 'Factory Overheads',
  'Cost of Trading Goods Sold', 'Site Running Costs', 'Inventory - Raw Materials', 'Inventory - Finished Prefab Units', 'Inventory - Trading Goods', 'Goods in Transit',
  'Office Salaries and Benefits', 'Rent - Office and Yard', 'Utilities', 'Telephone and Internet', 'IT and Software Subscriptions', 'Travel and Per Diem',
  'Vehicle Fuel and Maintenance', 'Professional Fees', 'Licence and Free Zone Fees', 'Marketing and Tenders', 'Bank Charges and LC Commissions', 'Insurance',
  'Repairs and Maintenance', 'Office Supplies and Printing', 'Other Expenses', 'Fines and Penalties',
];
/** Where each Central Hub figure goes unless the Admin chooses otherwise. */
export const DEFAULT_MAP = {
  material: 'Materials - Steel and Panels', labor: 'Site Labour - Daily Crew', crew: 'Site Labour - Daily Crew', equipment: 'Equipment and Crane Hire',
  subcontract: 'Subcontractors', transport: 'Transport to Site', overhead: 'Site Running Costs', income: 'Contract Revenue - Prefab Buildings', otherIncome: 'Other Income',
  tradeSales: 'Trading Sales', tradeGoods: 'Inventory - Trading Goods', projectGoods: 'Materials - Steel and Panels', freight: 'Import Freight and Insurance',
  insurance: 'Import Freight and Insurance', duty: 'Import Duties and Customs Clearing', tax: 'Import Duties and Customs Clearing', clearing: 'Import Duties and Customs Clearing',
  port: 'Import Duties and Customs Clearing', inland: 'Transport to Site', other: 'Other Expenses',
};
export const MAP_WORD = {
  material: 'Costs: material', labor: 'Costs: labour (not crew pay)', crew: 'Crew pay (Payments)', equipment: 'Costs: equipment', subcontract: 'Costs: subcontract',
  transport: 'Costs: transport', overhead: 'Costs: overhead', income: 'Client invoices', otherIncome: 'Other money in (no invoice)', tradeSales: 'Trading: stock sales',
  tradeGoods: 'Trading: goods bought for stock', projectGoods: 'Trading: goods for a project', freight: 'Shipment: freight', insurance: 'Shipment: insurance',
  duty: 'Shipment: customs duty', tax: 'Shipment: import tax', clearing: 'Shipment: clearing agent', port: 'Shipment: port and storage', inland: 'Shipment: inland transport', other: 'Shipment: other',
};
/** The map in force: the Admin's choices over the defaults, only names of the chart. */
export const mapOf = saved => ({ ...DEFAULT_MAP, ...Object.fromEntries(Object.entries(saved || {}).filter(([k, v]) => k in DEFAULT_MAP && ACCOUNTS.includes(v))) });

const r2 = v => Math.round((+v || 0) * 100) / 100;
const day = d => String(d || '').slice(0, 10);
const MODE = { cash: 'Cash', bank: 'Bank Transfer', cheque: 'Check', mobile: 'Others' };
const through = m => (m === 'cash' ? 'Petty Cash' : 'Bank - USD Account');
/** A UAE project: its books are in USD (owner). */
export const isUae = p => !!p && !p.binned && String(p.currency || 'USD').toUpperCase() === 'USD';

/**
 * The file of a month.
 * @param o { projects: [{ project, ws: { ledger, bills, docs } }], company: { shipments, sales }, fx, month, map, sent: Set of keys }
 * @returns { tables, keys, checks, counts }
 */
export function zohoTables({ projects = [], company = {}, fx = null, month, map: saved = {}, sent = new Set() }) {
  const map = mapOf(saved);
  const inMonth = d => day(d).slice(0, 7) === month;
  const checks = [], keys = [];
  const customers = new Map(), vendors = new Map();
  const T = { inv: [], cpay: [], bill: [], vpay: [], exp: [], jrn: [] };
  // v1.20.0 (G10 T2): the partner list's details on the contact sheets; a sale is due after the customer's terms
  const partnerBy = n => (company.partners || []).find(p => norm(p.name) === norm(n)) || null;
  const CONTACT_HEAD = ['Display Name', 'Company Name', 'Currency Code', 'Contact Name', 'EmailID', 'Phone', 'Billing City', 'Billing Country', 'Tax Registration Number', 'Payment Terms', 'Payment Terms Label'];
  const contactRow = n => { const p = partnerBy(n) || {}; return [n, n, 'USD', p.person || '', p.email || '', p.phone || '', p.city || '', p.country || '', p.trn || '', +p.terms || 0, +p.terms ? `Net ${+p.terms}` : 'Due on Receipt']; };
  /** USD of an amount: as it is, at the record's own rate, or at the hub's rates; 0 (and a check) when there is none. */
  const usd = (amount, cur, rate, where) => {
    const c = String(cur || 'USD').toUpperCase(), a = +amount || 0;
    if (c === 'USD') return r2(a);
    if (+rate > 0) return r2(a / +rate);
    const v = fx ? convert(a, c, 'USD', fx) : 0;
    if (!(v > 0) && a) checks.push(['No exchange rate', where, `${a} ${c}: add the rate to USD on the record`]);
    return r2(v);
  };
  let skipped = 0;
  const take = key => { if (sent.has(key)) { skipped++; return false; } keys.push(key); return true; };
  const who = (list, name, where) => { const n = String(name || '').trim(); if (!n) { checks.push(['No name', where, list === customers ? 'Write the client' : 'Write the supplier']); return 'Unknown'; } list.set(n, true); return n; };
  const aed = v => r2(v * PEG);

  for (const { project: p, ws = {} } of projects.filter(x => isUae(x.project))) {
    const pn = p.name || p.id, invLedger = new Set();
    for (const d of (ws.docs || []).filter(x => x?.type === 'invoice' && x.status !== 'draft')) {
      if (d.ledgerId) invLedger.add(d.ledgerId);
      const where = `${pn}, invoice ${d.number || d.id}`;
      if (inMonth(d.date) && take(`${p.id}:inv:${d.id}`, where)) {
        const amt = usd(d.amountDue ?? d.total, p.currency, d.usdRate, where);
        if (!d.number) checks.push(['No invoice number', where, 'Give the invoice a number']);
        T.inv.push([day(d.date), d.number || '', d.status === 'paid' ? 'Paid' : 'Sent', who(customers, d.party?.name, where), day(d.due) || day(d.date), 'USD', PEG, 'Contract work', `${pn}${d.title ? `: ${d.title}` : ''}`, 1, amt, map.income, pn, aed(amt)]);
      }
    }
    for (const e of (ws.ledger || []).filter(x => x && !x.estimate && inMonth(x.date))) {
      const where = `${pn}, Costs ${day(e.date)} ${e.description || e.category || ''}`.trim();
      if (e.type === 'income') {
        const inv = (ws.docs || []).find(d => d.ledgerId === e.id);
        if (inv) {
          if (take(`${p.id}:invpay:${e.id}`, where)) { const amt = usd(e.amount, e.currency, e.usdRate, where); T.cpay.push([day(e.date), who(customers, inv.party?.name || e.vendor, where), inv.number || '', amt, MODE[e.method] || 'Bank Transfer', e.bankRef || '', through(e.method), 'USD', PEG, aed(amt)]); }
        } else if (take(`${p.id}:inc:${e.id}`, where)) {
          const amt = usd(e.amount, e.currency, e.usdRate, where), ref = `CH-${p.id}-${e.id}`.slice(0, 50);
          T.jrn.push([day(e.date), ref, `${pn}: ${e.description || 'money in'}`, through(e.method), amt, '', 'USD', PEG], [day(e.date), ref, `${pn}: ${e.description || 'money in'}`, map.otherIncome, '', amt, 'USD', PEG]);
        }
        continue;
      }
      if (e.billId) continue;   // a supplier bill's payment: in Bills and Vendor payments
      if (!take(`${p.id}:exp:${e.id}`, where)) continue;
      const crew = e.category === 'labor' && /^pay-/.test(e.id || '');
      const acc = crew ? map.crew : map[e.category] || '';
      if (!acc) checks.push(['No account', where, `Category "${e.category || 'none'}": choose its account`]);
      const amt = usd(e.amount, e.currency, e.usdRate, where);
      T.exp.push([day(e.date), acc || map.other, through(e.method), crew ? '' : String(e.vendor || '').trim(), amt, 'USD', PEG, e.bankRef || '', `${pn}: ${crew ? 'Crew pay, ' : ''}${e.description || e.category || ''}`, aed(amt)]);
    }
    for (const b of ws.bills || []) {
      const where = `${pn}, bill ${b.number || b.id} ${b.supplier || ''}`.trim();
      const amt = () => usd(b.amount, b.currency, b.usdRate, where);
      if (inMonth(b.date) && take(`${p.id}:bill:${b.id}`, where)) {
        const a = amt(), acc = map[b.category || 'material'] || map.material;
        T.bill.push([day(b.date), b.number || `CH-${b.id}`.slice(0, 40), who(vendors, b.supplier, where), day(b.due) || day(b.date), 'USD', PEG, acc, `${pn}: ${b.description || b.category || 'supplier bill'}`, 1, a, pn, aed(a)]);
      }
      if (b.paid && inMonth(b.paid.date) && take(`${p.id}:billpay:${b.id}`, where)) {
        const a = amt();
        T.vpay.push([day(b.paid.date), who(vendors, b.supplier, where), b.number || `CH-${b.id}`.slice(0, 40), a, MODE[b.paid.method] || 'Bank Transfer', b.paid.ref || '', through(b.paid.method), 'USD', PEG, aed(a)]);
      }
    }
  }

  // Trading: shipments are supplier bills (goods, then each cost), stock sales are invoices
  for (const s of company.shipments || []) {
    const date = day(s.ordered || s.date || s.etd || s.created);
    const where = `Shipment ${s.ref || s.id}`;
    if (!inMonth(date) || !take(`co:shp:${s.id}`, where)) continue;
    const cur = s.currency || 'USD', vendor = who(vendors, s.supplier, where), num = s.ref || `SHP-${s.id}`;
    for (const l of s.lines || []) {
      const a = usd((+l.qty || 0) * (+l.unitCost || 0), cur, s.usdRate, where), q = +l.qty || 1;
      T.bill.push([date, num, vendor, day(s.eta) || date, 'USD', PEG, s.projectId ? map.projectGoods : map.tradeGoods, l.description || 'Goods', q, r2(a / q), 'Trading', aed(a)]);
    }
    for (const c of s.costs || []) {
      const a = usd(c.amount, c.currency || cur, c.usdRate, where);
      T.bill.push([date, num, vendor, day(s.eta) || date, 'USD', PEG, map[c.kind] || map.other, `${num}: ${c.note || c.kind || 'cost'}`, 1, a, 'Trading', aed(a)]);
    }
  }
  for (const x of company.sales || []) {
    const where = `Sale ${day(x.date)} ${x.customer || ''}`.trim();
    const a = () => usd((+x.qty || 0) * (+x.unitPrice || 0), x.currency, x.usdRate, where), num = x.number || `SALE-${String(x.id).slice(-8)}`;
    if (inMonth(x.date) && take(`co:sale:${x.id}`, where)) { const v = a(); T.inv.push([day(x.date), num, x.paid ? 'Paid' : 'Sent', who(customers, x.customer, where), day(dueOf(x, partnerBy(x.customer))) || day(x.date), 'USD', PEG, 'Trading goods', x.note || 'Stock sale', +x.qty || 1, r2(v / (+x.qty || 1)), map.tradeSales, 'Trading', aed(v)]); }
    const paidOn = day(x.paidOn || (x.paid === true ? x.date : x.paid?.date));
    if (x.paid && inMonth(paidOn) && take(`co:salepay:${x.id}`, where)) { const v = a(); T.cpay.push([paidOn, who(customers, x.customer, where), num, v, MODE[x.method] || 'Bank Transfer', x.ref || '', through(x.method), 'USD', PEG, aed(v)]); }
  }

  const sumOf = (rows, i) => r2(rows.reduce((s, r) => s + (+r[i] || 0), 0));
  const counts = { invoices: T.inv.length, customerPayments: T.cpay.length, bills: T.bill.length, vendorPayments: T.vpay.length, expenses: T.exp.length, journals: T.jrn.length / 2,
    usdIn: r2(T.inv.reduce((t, r) => t + r[9] * r[10], 0)), usdOut: r2(T.bill.reduce((t, r) => t + r[8] * r[9], 0) + sumOf(T.exp, 4)), skipped };
  const tables = [
    { name: 'How to import', rows: [['Step', 'What to do'],
      ['1', 'Zoho Books (Amistad Pre Fab Trading FZCO): Settings, Currencies: USD must be on (rate 3.6725).'],
      ['2', 'Contacts first: Sales, Customers, Import (sheet Customers); Purchases, Vendors, Import (sheet Vendors). Skip names already in Zoho.'],
      ['3', 'Then in this order: Invoices, Customer Payments (Sales); Bills, Vendor Payments, Expenses (Purchases); Journals (Accountant, Manual Journals, Import).'],
      ['4', 'For each: save that sheet alone as CSV (File, Save as, CSV), Import, choose the file, check the matched fields, Import.'],
      ['5', 'Amounts are in USD with exchange rate 3.6725: Zoho books them in AED. The AED amount column is for checking only (do not map it).'],
      ['6', `Month: ${month}. Records already marked as sent are not in this file.`]] },
    { name: 'Customers', rows: [CONTACT_HEAD, ...[...customers.keys()].sort().map(contactRow)] },
    { name: 'Vendors', rows: [CONTACT_HEAD, ...[...vendors.keys()].sort().map(contactRow)] },
    { name: 'Invoices', rows: [['Invoice Date', 'Invoice Number', 'Invoice Status', 'Customer Name', 'Due Date', 'Currency Code', 'Exchange Rate', 'Item Name', 'Item Desc', 'Quantity', 'Item Price', 'Account', 'Notes', 'AED Amount'], ...T.inv] },
    { name: 'Customer Payments', rows: [['Date', 'Customer Name', 'Invoice Number', 'Amount', 'Payment Mode', 'Reference Number', 'Deposit To', 'Currency Code', 'Exchange Rate', 'AED Amount'], ...T.cpay] },
    { name: 'Bills', rows: [['Bill Date', 'Bill Number', 'Vendor Name', 'Due Date', 'Currency Code', 'Exchange Rate', 'Account', 'Description', 'Quantity', 'Rate', 'Notes', 'AED Amount'], ...T.bill] },
    { name: 'Vendor Payments', rows: [['Date', 'Vendor Name', 'Bill Number', 'Amount', 'Payment Mode', 'Reference Number', 'Paid Through', 'Currency Code', 'Exchange Rate', 'AED Amount'], ...T.vpay] },
    { name: 'Expenses', rows: [['Expense Date', 'Expense Account', 'Paid Through', 'Vendor', 'Amount', 'Currency Code', 'Exchange Rate', 'Reference#', 'Description', 'AED Amount'], ...T.exp] },
    { name: 'Journals', rows: [['Journal Date', 'Reference Number', 'Notes', 'Account', 'Debit', 'Credit', 'Currency Code', 'Exchange Rate'], ...T.jrn] },
    { name: 'Checks', rows: [['What', 'Where', 'Fix'], ...checks] },
  ];
  return { tables, keys, checks, counts };
}
