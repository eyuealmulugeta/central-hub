// Contracts: the register of agreements with clients, suppliers and
// subcontractors, with their values, terms and key dates.

import { store } from '../core/store.js';
import { KINDS, STATUS_LABEL, kindLabel, isIncome, nextRef, contractsSummary } from '../engine/contracts.js';
import { uid, money, fmtFull, clamp } from '../core/util.js';
import { html, options, field, chip } from './dom.js';
import { currentDivision, stamp, TRADING } from '../core/division.js';
import { pageHtml } from '../sync/mail.js';
import { openMail, emailIn } from './maildialog.js';
import * as sign from './sign.js';

let selected = null;
let filter = 'all';   // all | client | out
let notice = '';

/** Select a contract from outside this screen (search, quick links). */
export const focusOn = id => { selected = id; filter = 'all'; };

const STATUS_CLS = { draft: 'warn', active: 'ok', ended: 'high', completed: '', terminated: '' };
const TEXT = new Set(['title', 'party', 'contact', 'paymentTerms', 'link', 'notes']);
const NUMBERS = new Set(['value', 'noticeDays']);
const find = company => company.contracts.find(x => x.id === selected);
const isLink = v => /^https?:\/\//i.test(v || '');

export function render(c) {
  const { company, global } = c;
  const cur = global.fx.base;
  const currencies = Object.keys(global.fx.rates).map(k => [k, k]);
  const sum = contractsSummary(company.contracts, global.fx, c.today, cur);
  const shown = sum.rows.filter(r => filter === 'all' || (filter === 'client' ? isIncome(r.c.kind) : !isIncome(r.c.kind)));
  const row = sum.rows.find(r => r.c.id === selected);
  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;
  const projectName = id => store.projects.find(p => p.id === id)?.name || '';

  // an open contract takes the whole page; "Contracts" at the top goes back to the list
  if (row) {
    return html`
      <div class="toolbar wide">
        <button class="btn ghost" data-act="back">&larr; Contracts</button>
        <span class="muted">${row.c.ref} ${row.c.title || 'Untitled contract'}</span>
      </div>
      <section class="card wide">${detail(row, c, currencies)}</section>`;
  }

  return html`
    <section class="kpis">
      ${kpi('Contracts in force', sum.active, 'Signed and not closed')}
      ${kpi('With clients', money(sum.income, cur), 'Value of client contracts in force')}
      ${kpi('With suppliers', money(sum.committed, cur), 'Suppliers, subcontractors, leases, services')}
      ${kpi('Retention held by clients', money(sum.retentionHeld, cur), 'At the retention % of each client contract')}
      ${kpi('Needs attention', sum.alerts, sum.urgent ? `${sum.urgent} date${sum.urgent > 1 ? 's' : ''} already passed` : 'Dates coming up, unsigned contracts', sum.urgent ? 'bad' : '')}
    </section>

    <section class="card wide">
      <div class="toolbar"><h2>Contracts</h2><span class="grow"></span><button class="btn primary" data-act="add">New contract</button></div>
      <div class="seg">
        ${[['all', 'All'], ['client', 'Clients'], ['out', 'Suppliers and others']].map(([k, label]) => html`<button class="${filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${label}</button>`)}
      </div>
      ${shown.length ? html`<ul class="list">${shown.map(({ c: x, status, alerts: all, value }) => {
        // the status chip already says "Not signed"
        const alerts = all.filter(a => a.text !== 'Not signed yet');
        return html`
        <li><button class="row pick ${x.id === selected ? 'sel' : ''}" data-act="select" data-id="${x.id}">
          <span class="row-main">
            <b>${x.ref} ${x.title || 'Untitled contract'}</b>
            <span class="muted">${[kindLabel(x.kind), x.party, projectName(x.projectId)].filter(Boolean).join(', ')}</span>
            <span>${chip(STATUS_LABEL[status], STATUS_CLS[status])} ${sign.waiting(company, x.id, c.today) ? chip('Out for signature', 'info') : ''} ${alerts.length ? chip(alerts[0].text, alerts[0].sev) : ''}${alerts.length > 1 ? html` <span class="muted">+${alerts.length - 1} more</span>` : ''}</span>
          </span>
          <span class="row-end"><span>${money(value, cur)}</span><span class="btn small">Open</span></span>
        </button></li>`; })}</ul>` : html`<p class="empty">${company.contracts.length ? 'No contract of this kind.' : 'No contracts yet. Add the first one with "New contract".'}</p>`}
    </section>`;
}

function detail({ c: x, status, alerts }, c, currencies) {
  const base = c.global.fx.base;
  const closed = status === 'completed' || status === 'terminated';
  const input = (label, f, fk, type = 'text', extra = '') => html`<label>${label} <input type="${type}" data-chg="set" data-f="${f}" data-fk="${fk}" value="${x[f] ?? ''}" ${extra}></label>`;
  const retention = (+x.value || 0) * (+x.retentionPct || 0) / 100;

  return html`
    <div class="toolbar">
      <h2>${x.ref}</h2>
      ${chip(STATUS_LABEL[status], STATUS_CLS[status])}
      <span class="grow"></span>
      <span class="muted">${notice}</span>
      <button class="btn" data-act="email" title="Send a summary of this contract by email, as a PDF">Email</button>
      ${closed ? html`<button class="btn" data-act="close" data-k="">Reopen</button>` : html`
        <button class="btn" data-act="close" data-k="completed">Mark as completed</button>
        <button class="btn" data-act="close" data-k="terminated">Mark as terminated</button>`}
      <button class="btn danger" data-act="remove">Delete</button>
    </div>
    ${alerts.length ? html`<ul class="plain">${alerts.map(a => html`<li>${chip(a.sev === 'high' ? 'Overdue' : 'Soon', a.sev)} ${a.text}</li>`)}</ul>` : ''}

    <div class="form">
      ${input('Title', 'title', 'ct-title', 'text', html`placeholder="e.g. Design and build of steel warehouse"`)}
      <div class="grid3">
        <label>Kind <select data-chg="set" data-f="kind" data-fk="ct-kind">${options(KINDS, x.kind || 'client')}</select></label>
        ${input(isIncome(x.kind) ? 'Client' : 'Other party', 'party', 'ct-party', 'text', html`list="contract-parties"`)}
        ${input('Their contact', 'contact', 'ct-contact', 'text', html`placeholder="Name, phone or email"`)}
        ${currentDivision() === TRADING ? '' : html`<label>Project <select data-chg="set" data-f="projectId" data-fk="ct-project">
          <option value="">No project</option>${options(store.projects.map(p => [p.id, p.name]), x.projectId || null)}</select></label>`}
        ${input('Contract value', 'value', 'ct-value', 'number', html`min="0" step="any"`)}
        <label>Currency <select data-chg="set" data-f="currency" data-fk="ct-cur">${options(currencies, x.currency || base)}</select></label>
        ${input('Signed on', 'signedOn', 'ct-signed', 'date')}
        ${input('Starts', 'start', 'ct-start', 'date')}
        ${input('Ends', 'end', 'ct-end', 'date')}
        ${input('Notice period, days', 'noticeDays', 'ct-notice', 'number', html`min="0"`)}
        ${input('Retention %', 'retentionPct', 'ct-ret', 'number', html`min="0" max="100" step="any"`)}
        ${input('Retention released on', 'retentionRelease', 'ct-retrel', 'date')}
        ${input('Defects liability ends', 'defectsEnd', 'ct-defects', 'date')}
      </div>
      <datalist id="contract-parties">${[...new Set(c.company.contracts.map(k => k.party).filter(Boolean))].map(n => html`<option value="${n}"></option>`)}</datalist>
      ${retention > 0 ? html`<p class="muted">Retention of ${money(retention, x.currency || base)} ${isIncome(x.kind) ? 'is held by the client' : 'is held by you'} until it is released.</p>` : ''}
      <label>Payment terms <textarea data-chg="set" data-f="paymentTerms" data-fk="ct-pay" rows="2" placeholder="e.g. 30% advance, 60% on progress, 10% on handover; 30 days from invoice">${x.paymentTerms || ''}</textarea></label>
      <label>Link to the signed contract <input data-chg="set" data-f="link" data-fk="ct-link" value="${x.link || ''}" placeholder="Paste the Google Drive link of the signed file"></label>
      ${isLink(x.link) ? html`<a href="${x.link}" target="_blank" rel="noopener">Open the signed contract</a>` : ''}

      <h3>Key dates and obligations</h3>
      ${x.dates?.length ? html`<ul class="list">${[...x.dates].sort((a, b) => (a.date || '9').localeCompare(b.date || '9')).map(d => html`
        <li class="row ${d.done ? 'closed' : ''}">
          <label class="check"><input type="checkbox" data-chg="dateDone" data-id="${d.id}" ${d.done ? 'checked' : ''} aria-label="Done"></label>
          <span class="row-main"><b>${d.what}</b><span class="muted">${d.date ? fmtFull(d.date) : 'No date'}</span></span>
          <button class="btn ghost small" data-act="dropDate" data-id="${d.id}">Remove</button>
        </li>`)}</ul>` : html`<p class="muted">Add what the contract obliges on a date: a bond to renew, insurance to provide, a handover, a price review, a renewal decision.</p>`}
      <form data-form="date" class="entry">
        <input name="what" placeholder="e.g. Performance bond expires" required aria-label="What is due" class="wide">
        <input type="date" name="date" required aria-label="Date">
        <button class="btn">Add date</button>
      </form>

      ${sign.block(x, c)}

      <label>Notes <textarea data-chg="set" data-f="notes" data-fk="ct-notes" rows="3" placeholder="Special conditions, penalties, variations agreed, who signed">${x.notes || ''}</textarea></label>
    </div>`;
}

/** One page summarising a contract, for the PDF attached to an email. */
function summaryPage(x, c, status) {
  const co = c.global.company || {};
  const cur = x.currency || c.global.fx.base;
  const row = (k, v) => (v || v === 0 ? html`<tr><td class="muted" style="width:32%">${k}</td><td>${v}</td></tr>` : '');
  const project = store.projects.find(p => p.id === x.projectId)?.name;
  const inner = html`
    <div class="p-head">
      <div class="p-block"><span class="p-company">${co.name || 'Amistad Prefab'}</span><span class="pre">${co.address || ''}</span></div>
      <div class="p-title"><h2>Contract summary</h2><span>${x.ref}</span></div>
    </div>
    <h3>${x.title || 'Untitled contract'}</h3>
    <table>
      ${row('Kind', kindLabel(x.kind))}
      ${row(isIncome(x.kind) ? 'Client' : 'Other party', x.party)}
      ${row('Project', project)}
      ${row('Contract value', x.value ? money(x.value, cur, 2) : '')}
      ${row('Status', STATUS_LABEL[status])}
      ${row('Signed on', x.signedOn && fmtFull(x.signedOn))}
      ${row('Starts', x.start && fmtFull(x.start))}
      ${row('Ends', x.end && fmtFull(x.end))}
      ${row('Notice period', x.noticeDays ? `${x.noticeDays} days` : '')}
      ${row('Retention', x.retentionPct ? `${x.retentionPct}%${x.retentionRelease ? `, released on ${fmtFull(x.retentionRelease)}` : ''}` : '')}
      ${row('Defects liability ends', x.defectsEnd && fmtFull(x.defectsEnd))}
      ${row('Payment terms', x.paymentTerms)}
      ${row('Signed contract', x.link)}
    </table>
    ${x.dates?.length ? html`<h3>Key dates and obligations</h3>
      <table>${[...x.dates].sort((a, b) => (a.date || '9').localeCompare(b.date || '9')).map(d => html`<tr><td class="nowrap" style="width:32%">${d.date ? fmtFull(d.date) : ''}</td><td>${d.what}</td><td>${d.done ? 'Done' : 'Open'}</td></tr>`)}</table>` : ''}
    <p class="muted p-notes">This is a summary prepared on ${fmtFull(c.today)}. The signed contract is the governing document.</p>`;
  return pageHtml(String(inner), `Contract ${x.ref}`);
}

export const actions = {
  ...sign.actions,
  select(el) { selected = el.dataset.id; notice = ''; },
  back() { selected = null; notice = ''; },
  /** Email a one-page summary of the contract. Internal notes are not included. */
  email(el, c) {
    const x = find(c.company);
    if (!x) return;
    const status = contractsSummary([x], c.global.fx, c.today, c.global.fx.base).rows[0].status;
    const sender = c.global.company?.name || 'Amistad Prefab';
    openMail({
      to: emailIn(x.contact),
      subject: `Contract ${x.ref}: ${x.title || kindLabel(x.kind)}`,
      message: `Dear ${x.party || 'Sir or Madam'},\n\nPlease find attached a summary of contract ${x.ref}${x.title ? `, ${x.title}` : ''}.\n\nPlease let us know if anything in it differs from your records.\n\nKind regards,\n${store.signature}\n${sender}`,
      filename: `Contract ${x.ref}`,
      getHtml: async () => summaryPage(x, c, status),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
  filter(el) { filter = el.dataset.k; },
  add(el, c) {
    const trading = currentDivision() === TRADING;
    const client = c.project.client || {};
    const x = {
      id: uid('ct'), ref: nextRef(store.company.contracts), title: '', ...stamp(), kind: filter === 'out' ? 'supplier' : 'client',
      party: trading || filter === 'out' ? '' : client.name || '', contact: trading || filter === 'out' ? '' : client.contact || '',
      projectId: trading ? '' : c.project.id, value: trading || filter === 'out' ? 0 : c.project.contractValue || 0, currency: trading ? c.global.fx.base : c.project.currency,
      signedOn: '', start: '', end: '', noticeDays: 0, retentionPct: filter === 'out' ? 0 : c.bill.retention || 0,
      retentionRelease: '', defectsEnd: '', paymentTerms: '', link: '', dates: [], notes: '', closed: '', created: c.today,
    };
    store.updateCompany(co => co.contracts.push(x));
    selected = x.id;
  },
  close(el) { store.updateCompany(co => { const x = find(co); if (x) x.closed = el.dataset.k; }); },
  remove(el, c) {
    const x = find(c.company);
    if (!x || !confirm(`Delete contract ${x.ref}${x.title ? `, ${x.title}` : ''}? To keep the record of a finished contract, use "Mark as completed" instead.`)) return;
    store.updateCompany(co => { co.contracts = co.contracts.filter(k => k.id !== x.id); });
    selected = null;
  },
  dropDate(el) { store.updateCompany(co => { const x = find(co); x.dates = x.dates.filter(d => d.id !== el.dataset.id); }); },
};

export const changes = {
  ...sign.changes,
  set(el) {
    const f = el.dataset.f;
    const value = f === 'retentionPct' ? clamp(field(el), 0, 100) : NUMBERS.has(f) ? Math.max(0, field(el)) : TEXT.has(f) ? el.value.trim() : el.value;
    store.updateCompany(co => { const x = find(co); if (x) x[f] = value; });
  },
  dateDone(el) { store.updateCompany(co => { const d = find(co)?.dates.find(k => k.id === el.dataset.id); if (d) d.done = el.checked; }); },
};

export const submits = {
  ...sign.submits,
  date(fd, c) {
    const what = fd.get('what').trim();
    if (!what || !find(c.company)) return false;
    store.updateCompany(co => find(co).dates.push({ id: uid('kd'), what, date: fd.get('date'), done: false }));
  },
};
