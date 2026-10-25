// Today (v0.22.0, Hub 2): what needs this person, across all projects. It replaces the grid of icons. A card per
// project (progress, spent against budget, health, one line), then "Needs you" most urgent first, "This week" and
// "Waiting on others". Each person sees only what their role may open; Site users never see money.

import { store } from '../core/store.js';
import { money, fmtDate, fmtFull } from '../core/util.js';
import { html, icon } from './dom.js';
import { healthOf, projectLine, needsYou, thisWeek, waitingOn } from '../engine/today.js';

let only = '';   // the project the lists are filtered to; '' = all projects

const TONE = { ok: 'ok', warn: 'warn', bad: 'high', none: '' };
const SEV_TONE = { high: 'high', warn: 'warn', info: 'info' };
const SEV_LABEL = { high: 'Urgent', warn: 'Watch', info: 'Note' };
const me = () => store.user?.email || '';
const tag = (text, tone) => html`<span class="tag ${tone || ''}">${text}</span>`;

function projectCard(s, c) {
  const h = healthOf(s);
  const line = projectLine(s, c.today);
  const open = s.project.id === c.project.id;
  const m = c.money ? s.money : null;
  const budget = +s.budget || 0;
  const used = m && budget > 0 ? Math.min(100, m.spent / budget * 100) : null;
  return html`<button type="button" class="pcard ${open ? 'on' : ''}" data-act="openProject" data-id="${s.project.id}" data-to="dashboard" title="Open ${s.project.name}">
    <span class="pcard-hd"><i class="dot ${h.tone}"></i><b>${s.project.name}</b>${tag(h.label, TONE[h.tone])}</span>
    <span class="pcard-m">
      <span><b>${Math.round(s.progress || 0)} %</b>${s.basis === 'billed' ? 'invoiced' : 'done'}</span>
      ${m ? html`<span><b>${money(m.spent, m.currency)}</b>${budget > 0 ? `spent of ${money(budget, m.currency)}` : 'spent'}</span>` : html`<span><b>${s.waiting || 0}</b>to approve</span>`}
    </span>
    <span class="bar"><i style="width:${Math.min(100, Math.max(0, s.progress || 0))}%"></i></span>
    ${used != null ? html`<span class="bar thin"><i class="${used > 100 ? 'r' : used > 90 ? 'w' : 'm'}" style="width:${used}%"></i></span>` : ''}
    <span class="pcard-ln ${line.tone}">${line.text}</span>
  </button>`;
}

function needRow(n, c) {
  const other = n.projectId !== c.project.id;
  return html`<li class="trow">
    <span class="tic ${SEV_TONE[n.sev]}">${icon(n.link === 'reports' ? 'reports' : n.link === 'schedule' ? 'schedule' : n.link === 'requests' ? 'docs' : ['ledger', 'docs', 'invoices'].includes(n.link) ? 'finance' : 'dashboard', 18)}</span>
    <span class="tt"><b>${n.title}</b><span class="muted">${n.kind}${n.detail ? `. ${n.detail}` : ''}</span></span>
    <span class="tag ${SEV_TONE[n.sev]}">${SEV_LABEL[n.sev]}</span>
    ${other ? html`<button type="button" class="btn small" data-act="openProject" data-id="${n.projectId}" data-to="${n.link}">Open</button>`
      : html`<a class="btn small ${n.kind === 'Field reports' ? 'primary' : ''}" href="#${n.link}">${n.kind === 'Field reports' ? 'Review' : 'Open'}</a>`}
  </li>`;
}

export function render(c) {
  const summaries = c.summaries || [];
  const meetings = [...(c.company.meetings || []).filter(m => !me() || m.by === me() || (m.invitees || []).some(i => i.email === me())), ...(c.company.bookings || [])];
  const others = summaries.filter(s => s.project.id !== c.project.id);
  const needs = needsYou({ project: c.project, flags: c.flags, requests: c.ws.requests || [], others, approver: c.role !== 'site' })
    .filter(n => !only || n.projectId === only);
  const week = only && only !== c.project.id ? [] : thisWeek({ today: c.today, rows: c.sched.rows, items: c.flags.items, meetings });
  const waits = only && only !== c.project.id ? [] : waitingOn(c.flags.items);
  const urgent = needs.filter(n => n.sev === 'high').length;
  return html`
    <section class="today-head">
      <div><h2>${fmtFull(c.today)}</h2><span class="muted">${needs.length ? `${needs.length} thing${needs.length > 1 ? 's' : ''} need${needs.length > 1 ? '' : 's'} you${urgent ? `, ${urgent} urgent` : ''}.` : 'Nothing needs you right now.'}</span></div>
      ${summaries.length > 1 ? html`<div class="seg">${[['', 'All projects'], ...summaries.map(s => [s.project.id, s.project.name])].map(([id, name]) => html`
        <button type="button" class="${only === id ? 'on' : ''}" data-act="only" data-id="${id}">${name}</button>`)}</div>` : ''}
    </section>
    <section class="pcards">${summaries.map(s => projectCard(s, c))}</section>
    <section class="today-grid">
      <div class="card">
        <h3 class="card-h">Needs you <em class="count-q">${needs.length}</em></h3>
        ${needs.length ? html`<ul class="tlist">${needs.map(n => needRow(n, c))}</ul>` : html`<p class="empty">All clear. New reports, requests and alerts show here.</p>`}
      </div>
      <div class="today-side">
        <div class="card">
          <h3 class="card-h">This week</h3>
          ${week.length ? html`<ul class="tlist">${week.map(w => html`<li class="trow"><span class="tday"><b>${fmtDate(w.day).split(' ')[0]}</b><small>${new Date(w.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</small></span>
            <span class="tt"><b>${w.title}</b><span class="muted">${w.kind}${w.detail ? `, ${w.detail}` : ''}</span></span><a class="btn small ghost" href="#${w.link}">Open</a></li>`)}</ul>`
            : html`<p class="empty">Nothing due in the next 7 days.</p>`}
        </div>
        <div class="card">
          <h3 class="card-h">Waiting on others</h3>
          ${waits.length ? html`<ul class="tlist">${waits.slice(0, 8).map(i => html`<li class="trow"><span class="tt"><b>${i.title}</b><span class="muted">With ${i.owner}${i.due ? `, due ${fmtDate(i.due)}` : ''}${i.overdue ? ', overdue' : ''}</span></span>${i.overdue ? tag('Overdue', 'high') : ''}</li>`)}</ul>`
            : html`<p class="empty">No follow-ups open. Add them on the project's overview.</p>`}
        </div>
      </div>
    </section>`;
}

export const actions = {
  only(el) { only = el.dataset.id || ''; },
  /** Open a project (and a page of it) from a card or a line about another project. */
  openProject(el) {
    const to = el.dataset.to || 'dashboard';
    if (el.dataset.id !== store.project?.id) store.switchTo(el.dataset.id);
    location.hash = to;
  },
};
