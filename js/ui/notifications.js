// v0.23.0: Notifications, the Admin's page under Today. One block per kind (new sign-ins to Field Report, requests from
// site, field reports to review, what Field Report sent the Admin), each line Pending or Done. Field requests can be
// approved or rejected here (new fields on the follow-up: decision, decidedBy, decidedAt); devices are decided in the
// Field Report script (see fieldusers.js). Nothing new is stored for the page itself.

import { store } from '../core/store.js';
import * as fieldusers from './fieldusers.js';
import { urgentBox, urgentActions, urgentChanges, urgentSubmits } from './urgent.js';
import { html } from './dom.js';
import { fmtDate } from '../core/util.js';

const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['done', 'Done']];
const DONE_DAYS = 14;   // decided or closed lines stay this long under Done
let filter = 'pending';

const recent = (iso, today) => !iso || (new Date(today) - new Date(String(iso).slice(0, 10))) / 864e5 <= DONE_DAYS;
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

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

/**
 * v0.78.0 (owner): a circle with the number of notifications waiting, over every page (the Admin's), only while there
 * are some. A tap opens Notifications; Clear hides it until a new one comes. Answered ones leave the number.
 */
const CLEARED = 'hub:notifCleared';
const cleared = () => { try { return Number(localStorage.getItem(CLEARED)) || 0; } catch { return 0; } };
export function fab(c) {
  const n = pendingCount(c);
  if (n < cleared()) { try { localStorage.setItem(CLEARED, String(n)); } catch { /* not kept */ } }
  if (!n || n <= cleared()) return '';
  return html`<div class="notif-fab"><a href="#notifications" aria-label="Notifications: ${n}">🔔<i>${n}</i></a><button type="button" data-notif-clear="${n}" aria-label="Clear">✕</button></div>`;
}
globalThis.document?.addEventListener('click', e => {
  const b = e.target.closest?.('[data-notif-clear]');
  if (!b) return;
  try { localStorage.setItem(CLEARED, b.dataset.notifClear); } catch { /* not kept */ }
  b.parentElement.remove();
});

/** Pending lines in all, for the menu badge. */
export const pendingCount = c => {
  const f = fieldusers.current();
  const b = blocksOf({ ws: c.ws, devices: f?.devices, inbox: f?.inbox, today: c.today });
  return b.devices.pending.length + b.requests.pending.length + b.reports.pending.length;
};

// v0.90.0 (owner: "not well organized, make it compact"): one list, newest kinds first, a small coloured tag says what
// each line is; the long notes moved into the tags' titles; empty kinds no longer take a box each.
const KINDS = {
  devices: ['Sign-in', 'New device asking to use Field Report (also under Settings, Field Report users)'],
  requests: ['Request', 'Material, manpower or tool request from site, for the open project'],
  reports: ['Report', 'Field report waiting for review, for the open project'],
  alerts: ['From FR', 'What Field Report sent the Admin'],
};
const tag = k => html`<span class="nk nk-${k}" title="${KINDS[k][1]}">${KINDS[k][0]}</span>`;
const doneTag = done => (done ? html`<span class="nk-done">Done</span>` : '');

/** The lines to show for a filter, as [kind, record, done]. Pure, for the tests. */
export function linesOf(b, f = 'pending') {
  const out = [];
  for (const k of ['devices', 'requests', 'reports']) {
    if (f !== 'done') out.push(...b[k].pending.map(x => [k, x, false]));
    if (f !== 'pending') out.push(...b[k].done.map(x => [k, x, true]));
  }
  if (f !== 'pending') out.push(...b.alerts.done.map(x => ['alerts', x, true]));
  return out;
}

const deviceLine = (d, done) => html`
  <span class="tt"><b>${d.name || d.email}</b><span class="muted" title="${d.email} · ${d.ua || ''}">${d.ua || 'Unknown device'} · ${d.ip ? `IP ${d.ip}${d.loc ? `, ${d.loc}` : ''}` : 'IP not known yet'} · ${when(d.first)}${done ? ` · ${d.st === 'ok' ? 'Approved' : 'Denied'} by ${d.by || '?'}` : ''}</span></span>
  ${done ? doneTag(done) : html`<span class="actions"><button class="btn small primary" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="approve">Approve</button><button class="btn small ghost" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="deny">Deny</button></span>`}`;

const requestLine = (i, done) => html`
  <span class="tt"><b>${i.title}</b><span class="muted">${i.owner || 'Site'} · ${fmtDate(i.created)}${i.due ? ` · needed by ${fmtDate(i.due)}` : ''}${i.decision ? ` · ${i.decision === 'approved' ? 'Approved' : 'Rejected'} by ${i.decidedBy || '?'}` : i.status === 'closed' ? ' · closed' : ''}</span></span>
  ${done ? doneTag(done) : html`<span class="actions"><button class="btn small primary" type="button" data-act="reqDecide" data-id="${i.id}" data-v="approved">Approve</button><button class="btn small ghost" type="button" data-act="reqDecide" data-id="${i.id}" data-v="rejected">Reject</button></span>`}`;

const reportLine = (r, done) => html`
  <span class="tt"><b>No. ${r.field?.no || '–'} · ${fmtDate(r.date)}</b><span class="muted">${r.by || 'Site'}${done ? ` · ${r.approvedBy ? `approved by ${r.approvedBy}` : 'reviewed'}` : ''}</span></span>
  ${done ? doneTag(done) : html`<span class="actions"><a class="btn small primary" href="#reports">Review</a></span>`}`;

const alertLine = x => html`
  <span class="tt"><b>${x.h}</b><span class="muted" title="${x.m}">${x.m} · ${x.f || 'Field Report'} · ${when(x.t)}</span></span>`;

const LINE = { devices: deviceLine, requests: requestLine, reports: reportLine, alerts: alertLine };

export function render(c) {
  if (!store.isAdmin) return html`<section class="card"><p class="empty">Only the Admin sees the notifications.</p></section>`;
  fieldusers.load();
  const f = fieldusers.current();
  const b = blocksOf({ ws: c.ws, devices: f?.devices, inbox: f?.inbox, today: c.today });
  const count = k => b[k].pending.length;
  const pending = count('devices') + count('requests') + count('reports');
  const lines = linesOf(b, filter);
  return html`
    <section class="today-head notif-head">
      <div><h2>Notifications</h2><span class="muted">${pending ? `${pending} waiting for you` : 'Nothing waiting'}${f ? ` · read ${when(f.at)}` : ''}${fieldusers.isDemo() ? ' · demo: sample sign-ins' : ''}</span></div>
      <div class="seg">${FILTERS.map(([k, label]) => html`<button type="button" class="${filter === k ? 'on' : ''}" data-act="notifFilter" data-v="${k}">${label}</button>`)}</div>
      <button class="btn small" type="button" data-act="fuLoad" ${fieldusers.isBusy() ? 'disabled' : ''}>${fieldusers.isBusy() ? 'Reading…' : 'Refresh'}</button>
    </section>
    <section class="card notif-card">
      <div class="notif-sum">${['devices', 'requests', 'reports'].map(k => html`<span class="${count(k) ? 'on' : ''}">${tag(k)} ${count(k)}</span>`)}<span class="muted grow">Requests and reports: ${c.project.name}</span></div>
      ${lines.length ? html`<ul class="tlist notif-list">${lines.map(([k, x, done]) => html`<li class="trow notif-row ${done ? 'is-done' : ''}">${tag(k)}${LINE[k](x, done)}</li>`)}</ul>`
        : html`<p class="empty notif-empty">${filter === 'done' ? 'Nothing decided in the last two weeks.' : 'All clear. No sign-in, site request or report is waiting.'}</p>`}
    </section>
    ${urgentBox(c)}`;
}

export const changes = { ...urgentChanges };
export const submits = { ...urgentSubmits };

export const actions = {
  ...fieldusers.actions,
  ...urgentActions,
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
