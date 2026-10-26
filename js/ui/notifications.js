// v0.23.0: Notifications, the Admin's page under Today. One block per kind (new sign-ins to Field Report, requests from
// site, field reports to review, what Field Report sent the Admin), each line Pending or Done. Field requests can be
// approved or rejected here (new fields on the follow-up: decision, decidedBy, decidedAt); devices are decided in the
// Field Report script (see fieldusers.js). Nothing new is stored for the page itself.

import { store } from '../core/store.js';
import * as fieldusers from './fieldusers.js';
import { html } from './dom.js';
import { fmtDate } from '../core/util.js';

const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['done', 'Done']];
const DONE_DAYS = 14;   // decided or closed lines stay this long under Done
let filter = 'pending';

const recent = (iso, today) => !iso || (new Date(today) - new Date(String(iso).slice(0, 10))) / 864e5 <= DONE_DAYS;
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const state = done => (done ? html`<span class="chip ok">Done</span>` : html`<span class="chip warn">Pending</span>`);

/** The lines of each block: { pending: [...], done: [...] }. Pure, for the tests. */
export function blocksOf({ ws, devices = [], inbox = [], today }) {
  const items = (ws?.items || []).filter(i => i.type === 'site_request');
  const reports = (ws?.reports || []).filter(r => r.source === 'field' && !r.field?.nowork);
  return {
    devices: { pending: devices.filter(d => d.st === 'wait'), done: devices.filter(d => d.st !== 'wait' && d.at && recent(d.at, today)) },
    requests: {
      pending: items.filter(i => i.status === 'open' && !i.decision),
      done: items.filter(i => (i.decision || i.status === 'closed') && recent(i.decidedAt || i.closedAt || i.created, today)),
    },
    reports: { pending: reports.filter(r => r.review === 'pending'), done: reports.filter(r => r.review !== 'pending' && recent(r.approvedAt || r.date, today)) },
    alerts: { pending: [], done: inbox.slice(0, 20) },
  };
}

/** Pending lines in all, for the menu badge. */
export const pendingCount = c => {
  const f = fieldusers.current();
  const b = blocksOf({ ws: c.ws, devices: f?.devices, inbox: f?.inbox, today: c.today });
  return b.devices.pending.length + b.requests.pending.length + b.reports.pending.length;
};

function block(title, b, row, empty, note = '') {
  const lines = filter === 'pending' ? b.pending.map(x => [x, false]) : filter === 'done' ? b.done.map(x => [x, true]) : [...b.pending.map(x => [x, false]), ...b.done.map(x => [x, true])];
  return html`<section class="card notif-block">
    <h3 class="card-h">${title} ${b.pending.length ? html`<em class="count-q">${b.pending.length}</em>` : ''}</h3>
    ${note ? html`<p class="muted small">${note}</p>` : ''}
    ${lines.length ? html`<ul class="tlist">${lines.map(([x, done]) => row(x, done))}</ul>` : html`<p class="empty">${empty}</p>`}
  </section>`;
}

const deviceLine = (d, done) => html`<li class="trow notif-row">
  ${done ? '' : html`<span class="chip high">New</span>`}
  <span class="tt"><b>${d.name || d.email}</b><span class="muted">${d.email} · ${d.ua || 'Unknown device'} · ${d.ip ? `IP ${d.ip}${d.loc ? `, ${d.loc} (approximate)` : ''}` : 'IP not known yet'} · ${when(d.first)}${done ? ` · ${d.st === 'ok' ? 'Approved' : 'Denied'} by ${d.by || '?'}` : ''}</span></span>
  ${state(done)}
  ${done ? '' : html`<span class="actions"><button class="btn small primary" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="approve">Approve</button><button class="btn small ghost" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="deny">Deny</button></span>`}
</li>`;

const requestLine = (i, done) => html`<li class="trow notif-row">
  <span class="tt"><b>${i.title}</b><span class="muted">From ${i.owner || 'Site'} · ${fmtDate(i.created)}${i.due ? ` · needed by ${fmtDate(i.due)}` : ''}${i.decision ? ` · ${i.decision === 'approved' ? 'Approved' : 'Rejected'} by ${i.decidedBy || '?'}` : i.status === 'closed' ? ' · closed' : ''}</span></span>
  ${state(done)}
  ${done ? '' : html`<span class="actions"><button class="btn small primary" type="button" data-act="reqDecide" data-id="${i.id}" data-v="approved">Approve</button><button class="btn small ghost" type="button" data-act="reqDecide" data-id="${i.id}" data-v="rejected">Reject</button></span>`}
</li>`;

const reportLine = (r, done) => html`<li class="trow notif-row">
  <span class="tt"><b>Report ${r.field?.no ? `No. ${r.field.no} · ` : ''}${fmtDate(r.date)}</b><span class="muted">By ${r.by || 'Site'}${done ? ` · ${r.approvedBy ? `approved by ${r.approvedBy}` : 'reviewed'}` : ' · waiting for review'}</span></span>
  ${state(done)}
  ${done ? '' : html`<a class="btn small" href="#reports">Review</a>`}
</li>`;

const alertLine = x => html`<li class="trow notif-row">
  <span class="tt"><b>${x.h}</b><span class="muted pre">${x.m}</span><span class="muted small">From ${x.f || 'Field Report'} · ${when(x.t)}</span></span>
  <span class="chip">Info</span>
</li>`;

export function render(c) {
  if (!store.isAdmin) return html`<section class="card"><p class="empty">Only the Admin sees the notifications.</p></section>`;
  fieldusers.load();
  const f = fieldusers.current();
  const b = blocksOf({ ws: c.ws, devices: f?.devices, inbox: f?.inbox, today: c.today });
  const pending = b.devices.pending.length + b.requests.pending.length + b.reports.pending.length;
  return html`
    <section class="today-head">
      <div><h2>Notifications</h2><span class="muted">${pending ? `${pending} pending` : 'Nothing pending'}${f ? ` · Field Report read ${when(f.at)}` : ''}${fieldusers.isDemo() ? ' · demo: sample sign-ins' : ''}</span></div>
      <div class="seg">${FILTERS.map(([k, label]) => html`<button type="button" class="${filter === k ? 'on' : ''}" data-act="notifFilter" data-v="${k}">${label}</button>`)}</div>
      <button class="btn small" type="button" data-act="fuLoad" ${fieldusers.isBusy() ? 'disabled' : ''}>${fieldusers.isBusy() ? 'Reading…' : 'Refresh'}</button>
    </section>
    <div class="notif-grid">
      ${block('New sign-ins to Field Report', b.devices, deviceLine, filter === 'done' ? 'No device decided in the last two weeks.' : 'No new device is waiting.', 'Also under Settings, Field Report and import, Field Report users.')}
      ${block(`Requests from site · ${c.project.name}`, b.requests, requestLine, filter === 'done' ? 'No request decided in the last two weeks.' : 'No request from site is waiting.', 'Material, manpower and tool requests sent with the Field Report. Approve or reject them here; they stay on the overview as follow-ups. Shown for the open project.')}
      ${block(`Field reports to review · ${c.project.name}`, b.reports, reportLine, filter === 'done' ? 'No report reviewed in the last two weeks.' : 'No report is waiting for review.')}
      ${filter === 'pending' ? '' : block('Sent to you by Field Report', b.alerts, alertLine, 'Nothing yet.', 'The notifications Field Report sent the Admin: reports, missing reports, devices, tests.')}
    </div>`;
}

export const actions = {
  ...fieldusers.actions,
  notifFilter(el) { filter = el.dataset.v; },
  /** Approve or reject a request from site. A rejected one is closed; an approved one stays open until it is delivered. */
  reqDecide(el, c) {
    const v = el.dataset.v;
    if (v === 'rejected' && !confirm('Reject this request from site?')) return;
    const by = store.profile?.name || store.user?.displayName || store.user?.email || 'Admin';
    store.update(ws => {
      const i = ws.items.find(x => x.id === el.dataset.id);
      if (!i) return;
      Object.assign(i, { decision: v, decidedBy: by, decidedAt: new Date().toISOString() }, v === 'rejected' ? { status: 'closed', closedAt: c.today } : {});
    });
  },
};
