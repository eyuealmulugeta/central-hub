// v1.4.0 (owner, 7 Nov, FR R6): Money > Purchases. Per PO and per supplier: ordered, received on site (Field Report Store),
// billed, paid, owed and how old; the problems (short delivery, over-billing, late, no PO, cash with no store receipt);
// Excel; the accountant marks the month checked. See engine/purchases.js.

import { store } from '../core/store.js';
import { html, chip } from './dom.js';
import { toCSV, downloadText, todayISO, money } from '../core/util.js';
import { isOut, poCheck, supplierRows, problems, PROBLEM_WORD, monthOf, mayMarkMonth, checkedMonth, csvRows } from '../engine/purchases.js';

let tab = 'pos';   // pos | suppliers | problems
const cur = () => (store.project?.currency === 'USD' ? 'USD' : 'ETB');
const m = v => money(+v || 0, cur());

function data(c) {
  const ws = c.ws || store.ws, today = c.today || todayISO();
  const docs = ws.docs || [], bills = ws.bills || [], moves = ws.storeMoves || [], requests = ws.requests || [];
  const checks = docs.filter(isOut).map(po => poCheck(po, { moves, bills, today })).sort((a, b) => b.flags.length - a.flags.length || String(b.date).localeCompare(String(a.date)));
  return { ws, today, checks, suppliers: supplierRows({ docs, bills, moves, today }), probs: problems({ docs, bills, moves, requests, today }) };
}

export function render(c) {
  const { ws, today, checks, suppliers, probs } = data(c);
  const month = monthOf(today), done = checkedMonth(ws.purchChecks, month);
  const tot = k => checks.reduce((s, x) => s + x[k], 0);
  const owed = suppliers.reduce((s, x) => s + x.owed, 0);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Purchases</h2><span class="muted">Request → PO (GM approves before it goes) → delivered on site (Field Report Store) → supplier bill → paid.</span><span class="grow"></span>
      <button type="button" class="btn" data-act="puCsv" ${checks.length || suppliers.length ? '' : 'disabled'}>Excel</button></div>
    <div class="actions left">
      ${chip(`Ordered ${m(tot('ordered'))}`, '')} ${chip(`Received ${m(tot('received'))}`, '')} ${chip(`Billed ${m(tot('billed'))}`, '')} ${chip(`Owed to suppliers ${m(owed)}`, owed ? 'warn' : 'ok')}
      ${done ? chip(`${month} checked by ${done.byName || done.by}`, 'ok') : mayMarkMonth({ role: store.role, ranks: store.ranks }) ? html`<button type="button" class="btn" data-act="puMonth" data-v="${month}">Mark ${month} checked</button>` : chip(`${month} not checked yet`, 'warn')}
    </div>
    <div class="actions left">
      <button type="button" class="btn ${tab === 'pos' ? 'primary' : ''}" data-act="puTab" data-v="pos">Purchase orders · ${checks.length}</button>
      <button type="button" class="btn ${tab === 'suppliers' ? 'primary' : ''}" data-act="puTab" data-v="suppliers">Suppliers · ${suppliers.length}</button>
      <button type="button" class="btn ${tab === 'problems' ? 'primary' : ''}" data-act="puTab" data-v="problems">Problems · ${probs.length}</button>
    </div>
    ${tab === 'pos' ? (checks.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>PO</th><th>Supplier</th><th>Deliver by</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Billed</th><th class="num">Paid</th><th>Still to come</th><th>Check</th></tr></thead>
      <tbody>${checks.map(x => html`<tr><td><b>${x.number}</b></td><td>${x.supplier || '—'}</td><td>${x.due || ''}</td><td class="num">${m(x.ordered)}</td><td class="num">${m(x.received)}</td><td class="num">${m(x.billed)}</td><td class="num">${m(x.paid)}</td>
        <td class="small">${x.toCome.map(l => `${l.item} ${l.left} ${l.unit}`).join(', ') || 'All delivered'}</td>
        <td>${x.flags.length ? x.flags.map(f => html`${chip(PROBLEM_WORD[f.key], 'bad')} `) : chip('OK', 'ok')}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">No purchase order has gone out yet. Make one from an approved material request (Requests), then send it after the GM approves.</p>`) : ''}
    ${tab === 'suppliers' ? (suppliers.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Supplier</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Owed</th><th class="num">0-30 days</th><th class="num">31-60</th><th class="num">Over 60</th><th class="num">Oldest</th></tr></thead>
      <tbody>${suppliers.map(s => html`<tr><td><b>${s.supplier}</b>${s.flags ? html` ${chip(`${s.flags} problem${s.flags > 1 ? 's' : ''}`, 'bad')}` : ''}</td><td class="num">${m(s.ordered)}</td><td class="num">${m(s.received)}</td><td class="num">${m(s.billed)}</td><td class="num">${m(s.paid)}</td><td class="num"><b>${m(s.owed)}</b></td>
        <td class="num">${s.age.d30 ? m(s.age.d30) : ''}</td><td class="num">${s.age.d60 ? m(s.age.d60) : ''}</td><td class="num">${s.age.older ? m(s.age.older) : ''}</td><td class="num">${s.owed ? `${s.oldest} d` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">No supplier yet.</p>`) : ''}
    ${tab === 'problems' ? (probs.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Problem</th><th>Ref</th><th>Supplier</th><th>What</th></tr></thead>
      <tbody>${probs.map(p => html`<tr><td>${chip(PROBLEM_WORD[p.kind] || p.kind, p.kind === 'late' || p.kind === 'nopo' ? 'warn' : 'bad')}</td><td>${p.ref}</td><td>${p.supplier || '—'}</td><td>${p.text}</td></tr>`)}</tbody></table></div>
      <p class="muted small">A bill on a PO with a short delivery or over-billing needs the GM's approval before it is paid (Costs, Supplier bills).</p>`
      : html`<p class="empty">No problem found.</p>`) : ''}
  </section>`;
}

export const actions = {
  puTab(el) { tab = el.dataset.v; },
  puMonth(el) {
    const month = el.dataset.v;
    if (!mayMarkMonth({ role: store.role, ranks: store.ranks }) || !confirm(`Mark ${month} checked? Say so only after the problems are cleared or explained.`)) return;
    const who = { by: (store.user?.email || '').toLowerCase(), byName: store.profile?.name || store.user?.name || '' };
    store.update(ws => { (ws.purchChecks ||= []).push({ id: month, month, ...who, at: new Date().toISOString() }); });
    store.logActivity?.({ action: 'approve', channel: 'Purchases', doc: `Month ${month} checked` });
  },
  puCsv(el, c) {
    const { checks, suppliers } = data(c || {});
    downloadText(`Purchases ${store.project?.name || ''} ${todayISO()}.csv`, toCSV(csvRows(checks, suppliers)));
  },
};
