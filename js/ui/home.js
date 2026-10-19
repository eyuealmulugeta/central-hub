// Home: the whole company on one screen. One tile per section with its headline
// figure and what needs attention, then every project. Figures for projects that
// are not open come from the summary saved the last time each was opened.

import { store } from '../core/store.js';
import { tradeSummary, stockAndSales } from '../engine/trade.js';
import { contractsSummary } from '../engine/contracts.js';
import { hrSummary } from '../engine/hr.js';
import { typeLabel } from '../core/seed.js';
import { money } from '../core/util.js';
import { html, meter, chip, icon } from './dom.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Amounts are never added across currencies: one figure per currency, side by side. */
const perCurrency = (byCur, empty = '0') => {
  const parts = Object.entries(byCur).filter(([, v]) => Math.round(v) !== 0).map(([cur, v]) => money(v, cur));
  return parts.length ? parts.join(' · ') : empty;
};
const add = (byCur, cur, v) => { byCur[cur] = (byCur[cur] || 0) + (v || 0); };
const groupBy = (list, key) => list.reduce((g, x) => ((g[key(x)] ||= []).push(x), g), {});

export function render(c) {
  const { global, company, summaries, can } = c;
  const trading = c.division === 'trading';   // Trading sees no project, no construction figures
  const cur = global.fx.base;   // only for counting things that carry no money on this screen
  const tiles = [];
  const tile = (page, name, iconName, figure, sub, alerts, alertText) => tiles.push(html`
    <a class="tile" href="#${page}">
      <span class="tile-head">${icon(iconName)}<b>${name}</b>${alerts ? html`<em title="${alertText}">${alerts}</em>` : ''}</span>
      <strong>${figure}</strong>
      <span class="muted">${sub}</span>
    </a>`);

  // Projects
  const behind = summaries.filter(s => s.basis !== 'none' && s.slip > 0).length;
  const unseen = summaries.reduce((n, s) => n + (s.unseen || 0), 0);
  if (!trading && can('dashboard')) {
    tile('dashboard', 'Projects', 'dashboard', plural(summaries.length, 'project'),
      behind ? `${behind} behind plan` : 'All on plan', unseen, `${plural(unseen, 'alert')} not opened yet`);
  }

  // Shipments: for the projects in Installation; stock for resale in Trading
  if (can('trade')) {
    // each shipment is valued in its own currency; the currencies are shown separately
    let open = 0, late = 0;
    const stockValue = {}, unpaid = {};
    for (const [shipCur, ships] of Object.entries(groupBy(company.shipments, s => s.currency || cur))) {
      const ids = new Set(ships.map(s => s.id));
      const ship = tradeSummary(ships, global.fx, c.today, shipCur);
      const stock = stockAndSales({ ...company, shipments: ships, sales: (company.sales || []).filter(x => ids.has(x.shipmentId)) }, global.fx, shipCur);
      open += ship.open; late += ship.late;
      add(stockValue, shipCur, stock.stockValue); add(unpaid, shipCur, stock.unpaid);
    }
    const unpaidText = perCurrency(unpaid, '');
    if (trading) {
      tile('trade', 'Trading', 'trade', `${plural(open, 'shipment')} on the way`,
        `Stock worth ${perCurrency(stockValue)}${unpaidText ? `, ${unpaidText} of sales unpaid` : ''}`, late, `${plural(late, 'shipment')} past the expected arrival`);
    } else {
      tile('trade', 'Shipments', 'trade', `${plural(open, 'shipment')} on the way`, 'Bought for the projects', late, `${plural(late, 'shipment')} past the expected arrival`);
    }
  }

  // Trading's own money: stock, sales and what is owed
  if (trading && c.money && can('finance')) {
    const st = stockAndSales(company, global.fx, global.fx.base);
    tile('tradesummary', 'Finance', 'finance', money(st.profit, global.fx.base), `Trading profit. ${money(st.unpaid, global.fx.base)} of sales unpaid`, 0, '');
  }

  // Finance, from each project's saved figures
  const withMoney = summaries.filter(s => s.money);
  const total = f => withMoney.reduce((by, s) => (add(by, s.money.currency, f(s.money)), by), {});
  const showMoney = !trading && c.money && withMoney.length > 0;
  if (showMoney && (can('finance') || can('ledger') || can('docs'))) {
    const cash = total(x => x.received - x.spent);
    const owed = perCurrency(total(x => x.owed), '');
    tile(can('finance') ? 'finance' : can('ledger') ? 'ledger' : 'docs', 'Finance', 'finance', perCurrency(cash),
      `Cash position on projects. ${owed ? `${owed} owed to you` : 'Nothing awaiting payment'}`, 0, '');
  }

  // People and contracts
  if (can('contracts') || can('hr')) {
    const con = can('contracts') ? contractsSummary(company.contracts, global.fx, c.today, cur) : null;
    const hr = can('hr') ? hrSummary(company.staff, global.fx, c.today, cur) : null;
    const alerts = (con?.alerts || 0) + (hr?.alerts || 0);
    tile(con ? 'contracts' : 'hr', 'People and contracts', 'hr',
      con ? `${plural(con.active, 'contract')} in force` : `${plural(hr.active, 'person', 'people')} working`,
      [con && hr ? `${plural(hr.active, 'person', 'people')} on staff` : '', alerts ? `${plural(alerts, 'date')} coming up or passed` : 'Nothing due soon'].filter(Boolean).join('. '),
      alerts, 'Contract dates and staff papers needing attention');
  }

  return html`
    <section class="tiles">${tiles}</section>
    ${trading ? '' : html`<section class="card">
      <div class="toolbar"><h2>Projects</h2><span class="muted">Click a project to open it${showMoney ? '. Each project in its own currency' : ''}</span></div>
      ${summaries.length ? html`<table class="table">
        <thead><tr><th>Project</th><th>Progress</th><th>Status</th>${showMoney ? html`<th class="r">Invoiced</th><th class="r">Received</th><th class="r">Spent</th><th class="r">Cash</th>` : ''}<th class="r">Alerts</th></tr></thead>
        <tbody>${summaries.map(s => {
          const x = s.money;
          const cash = x ? x.received - x.spent : 0;
          const m = v => money(v, x.currency);
          return html`
          <tr class="click" data-act="openProject" data-id="${s.project.id}">
            <td><button class="link" type="button">${s.project.name}</button><span class="muted note">${typeLabel(s.project.type)}</span></td>
            <td class="nowrap">${s.basis === 'none' ? html`<span class="muted">No schedule or invoices yet</span>`
              : html`${Math.round(s.progress)}%${s.basis === 'billed' ? html` <span class="muted">invoiced</span>` : ''} ${meter(s.progress, s.slip > 0 && s.basis === 'work' ? 'bad' : '')}`}</td>
            <td>${s.basis !== 'work' ? chip('No schedule') : s.progress >= 100 ? chip('Complete', 'ok') : s.slip > 0 ? chip(`${s.slip} d behind`, 'high') : chip('On plan', 'ok')}</td>
            ${showMoney ? (x ? html`
              <td class="r nowrap">${m(x.invoiced)}</td><td class="r nowrap">${m(x.received)}</td>
              <td class="r nowrap">${m(x.spent)}</td><td class="r nowrap ${cash < 0 ? 'bad' : ''}">${m(cash)}</td>`
              : html`<td class="r muted" colspan="4">Open the project once to load its figures</td>`) : ''}
            <td class="r">${s.unseen ? html`<em class="count">${s.unseen}</em>` : ''}</td>
          </tr>`;
        })}</tbody>
      </table>` : html`<p class="empty">No projects yet.</p>`}
      ${store.cloud ? html`<p class="muted">The open project is live. The others show the figures saved the last time someone opened them.</p>` : ''}
    </section>`}`;
}

export const actions = {
  /** Open a project on its Overview. */
  openProject(el) {
    store.switchTo(el.dataset.id);
    location.hash = '#dashboard';
  },
};
