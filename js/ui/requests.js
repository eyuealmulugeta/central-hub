// Requests: material, manpower and equipment asked for by the site. A Site Engineer raises a
// request, the Project Manager or Admin approves or refuses it, the office arranges it, and the
// site confirms it arrived. An approved request becomes a follow-up for the office. Each request
// prints on the letterhead and can be emailed as a PDF, for example to a supplier.

import { store } from '../core/store.js';
import {
  KINDS, PRIORITIES, DEFAULT_UNIT, kindLabel, statusLabel, isOpen, moves, editable, overdue, nextNumber, check, titleOf, followUp, summary,
} from '../engine/requests.js';
import { uid, fmtFull } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, chip } from './dom.js';
import { letterhead } from './docs.js';
import { openMail, emailIn } from './maildialog.js';

let selected = null;
let filter = null;          // waiting | open | done | all; chosen from the person's role until they pick one
let notice = '';
let problems = [];

/** The moment now on this device's clock, like 2026-10-19T08:15 (not UTC, so the date matches the person's day). */
const stamp = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const approver = () => store.role === 'owner' || store.role === 'office';
const me = () => ({ email: (store.user?.email || '').toLowerCase(), name: store.profile.name || store.user?.name || 'Admin' });
const find = ws => ws.requests.find(r => r.id === selected);
const STATUS_CLASS = { requested: 'warn', approved: 'info', arranging: 'info', fulfilled: 'ok', rejected: 'high', cancelled: '' };

export function render(c) {
  const r = find(c.ws);
  return r ? detail(r, c) : list(c);
}

function list(c) {
  const all = [...c.ws.requests].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.number.localeCompare(a.number));
  const s = summary(all, c.today);
  const on = filter || (approver() ? 'waiting' : 'open');
  const shown = all.filter(r => (on === 'waiting' ? r.status === 'requested' : on === 'open' ? isOpen(r) : on === 'done' ? !isOpen(r) : true));
  const tasks = c.ws.tasks.filter(t => !t.milestone).map(t => [t.id, t.name]);
  const tab = (id, label, n) => html`<button type="button" class="btn small ${on === id ? 'primary' : ''}" data-act="filter" data-k="${id}">${label}${n != null ? ` (${n})` : ''}</button>`;
  return html`
    <section class="card">
      <div class="toolbar"><h2>New request</h2><span class="muted">${notice}</span></div>
      ${problems.length ? html`<ul class="plain bad">${problems.map(p => html`<li>${p}</li>`)}</ul>` : ''}
      <form data-form="newRequest">
        <div class="grid2">
          <label>What is it for <select name="kind">${options(KINDS, 'material')}</select></label>
          <label>Priority <select name="priority">${options(PRIORITIES, 'normal')}</select></label>
          <label>Needed by <input type="date" name="neededBy" required min="${c.today}"></label>
          <label>For which task <select name="taskId"><option value="">Not tied to a task</option>${options(tasks, null)}</select></label>
        </div>
        <div class="entry">
          <input name="description" class="wide" required placeholder="What is needed, e.g. Roof sheeting 0.5 mm, or Welder" aria-label="What is needed">
          <input name="qty" type="number" min="0" step="any" required placeholder="Quantity" aria-label="Quantity" class="amount">
          <input name="unit" placeholder="Unit (pcs, m², people…)" aria-label="Unit" class="amount">
        </div>
        <label>Why it is needed (optional) <textarea name="purpose" rows="2" placeholder="What work it is for and what happens if it is late"></textarea></label>
        <div class="actions left"><button class="btn primary">Send the request</button><span class="muted">You can add more lines to it after sending.</span></div>
      </form>
    </section>
    <section class="card">
      <div class="toolbar"><h2>Requests</h2>
        ${tab('waiting', 'Waiting for approval', s.waiting)}${tab('open', 'Open', s.open)}${tab('done', 'Closed')}${tab('all', 'All')}
        <span class="grow"></span><span class="muted">${s.overdue ? `${s.overdue} past the date needed` : ''}${s.urgent ? `${s.overdue ? ', ' : ''}${s.urgent} urgent` : ''}</span></div>
      ${shown.length ? html`<table class="table">
        <thead><tr><th>Number</th><th>What</th><th>Needed by</th><th>Priority</th><th>Status</th><th>Asked by</th></tr></thead>
        <tbody>${shown.map(r => html`<tr class="click" data-act="open" data-id="${r.id}">
          <td class="nowrap"><button class="link" type="button">${r.number}</button> <span class="muted note">${kindLabel(r.kind)}</span></td>
          <td>${titleOf(r)}</td>
          <td class="nowrap ${overdue(r, c.today) ? 'bad' : ''}">${r.neededBy ? fmtFull(r.neededBy) : ''}${overdue(r, c.today) ? ' (late)' : ''}</td>
          <td>${r.priority === 'urgent' ? chip('Urgent', 'high') : ''}</td>
          <td>${chip(statusLabel(r.status), STATUS_CLASS[r.status])}</td>
          <td>${r.byName || r.by}</td></tr>`)}</tbody>
      </table>` : html`<p class="empty">${all.length ? 'Nothing in this list.' : 'No requests yet.'}</p>`}
    </section>`;
}

function detail(r, c) {
  const can = approver();
  const edit = editable(r, can);
  const tasks = c.ws.tasks.filter(t => !t.milestone).map(t => [t.id, t.name]);
  const taskName = c.ws.tasks.find(t => t.id === r.taskId)?.name || '';
  const lines = (r.lines || []).filter(l => String(l.description || '').trim() || edit);
  const decided = [...(r.log || [])].reverse().find(x => x.status === 'approved');
  const showDays = r.kind === 'manpower' || lines.some(l => l.days);
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="back">← Requests</button>
      <span class="muted">${r.number}${r.emails?.length ? `. Emailed to ${r.emails.at(-1).to} on ${fmtFull(r.emails.at(-1).at)}` : ''}</span>
      <span class="grow"></span>
      ${moves(r.status, can).map(([to, label]) => html`<button class="btn ${to === 'approved' || to === 'fulfilled' ? 'primary' : ''}" data-act="move" data-to="${to}">${label}</button>`)}
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn" data-act="print">Print</button>
      <button class="btn danger" data-act="removeRequest">Delete</button>
    </div>
    ${notice ? html`<p class="ok no-print">${notice}</p>` : ''}
    ${problems.length ? html`<ul class="plain bad no-print">${problems.map(p => html`<li>${p}</li>`)}</ul>` : ''}
    ${edit ? html`<section class="card no-print"><div class="grid2">
      <label>Needed by <input type="date" data-chg="set" data-f="neededBy" data-fk="rq-need" value="${r.neededBy || ''}"></label>
      <label>Priority <select data-chg="set" data-f="priority" data-fk="rq-pri">${options(PRIORITIES, r.priority)}</select></label>
      <label>For which task <select data-chg="set" data-f="taskId" data-fk="rq-task"><option value="">Not tied to a task</option>${options(tasks, r.taskId || null)}</select></label>
    </div>
    <label>Why it is needed <textarea data-chg="set" data-f="purpose" data-fk="rq-why" rows="2">${r.purpose || ''}</textarea></label>
    ${(r.lines || []).length ? html`<table class="table compact"><thead><tr><th>What</th><th class="r">Quantity</th><th>Unit</th>${showDays ? html`<th class="r">Days</th>` : ''}<th>Note</th><th></th></tr></thead>
      <tbody>${r.lines.map(l => html`<tr>
        <td><input data-chg="line" data-id="${l.id}" data-f="description" data-fk="rl-d-${l.id}" value="${l.description || ''}" aria-label="What"></td>
        <td class="r"><input class="price" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="qty" data-fk="rl-q-${l.id}" value="${l.qty ?? ''}" aria-label="Quantity"></td>
        <td><input data-chg="line" data-id="${l.id}" data-f="unit" data-fk="rl-u-${l.id}" value="${l.unit || ''}" aria-label="Unit"></td>
        ${showDays ? html`<td class="r"><input class="price" type="number" min="0" step="any" data-chg="line" data-id="${l.id}" data-f="days" data-fk="rl-y-${l.id}" value="${l.days ?? ''}" aria-label="Days"></td>` : ''}
        <td><input data-chg="line" data-id="${l.id}" data-f="note" data-fk="rl-n-${l.id}" value="${l.note || ''}" aria-label="Note"></td>
        <td class="r"><button class="btn ghost small" data-act="cutLine" data-id="${l.id}">Take out</button></td></tr>`)}</tbody></table>` : ''}
    <form data-form="addLine" class="entry">
      <input name="description" class="wide" required placeholder="Another item or trade" aria-label="What">
      <input name="qty" type="number" min="0" step="any" required placeholder="Quantity" aria-label="Quantity" class="amount">
      <input name="unit" placeholder="Unit" value="${DEFAULT_UNIT[r.kind] || ''}" aria-label="Unit" class="amount">
      <button class="btn">Add line</button>
    </form></section>` : ''}
    ${(r.log || []).length ? html`<section class="card no-print"><h3>History</h3><ul class="plain">${r.log.map(x => html`<li>${fmtFull(x.at.slice(0, 10))}: <b>${statusLabel(x.status)}</b> by ${x.byName || x.by}${x.note ? html`. ${x.note}` : ''}</li>`)}</ul></section>` : ''}
    <section class="card sheet"><div class="paper">
      ${letterhead(c, `${kindLabel(r.kind)} request`, [['Number', r.number], ['Date', fmtFull(r.date)], ['Project', c.project.name], ['Needed by', r.neededBy ? fmtFull(r.neededBy) : '—'], ['Priority', r.priority === 'urgent' ? 'URGENT' : 'Normal'], ['Status', statusLabel(r.status)]])}
      ${taskName ? html`<p><span class="muted">For the task:</span> ${taskName}</p>` : ''}
      <table style="margin-top:12px"><thead><tr><th>#</th><th>Description</th><th class="r">Quantity</th><th>Unit</th>${showDays ? html`<th class="r">Days</th>` : ''}<th>Note</th></tr></thead>
        <tbody>${lines.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.description || ''}</td><td class="r">${l.qty ?? ''}</td><td>${l.unit || ''}</td>${showDays ? html`<td class="r">${l.days ?? ''}</td>` : ''}<td>${l.note || ''}</td></tr>`)}</tbody></table>
      ${r.purpose ? html`<h3>Why it is needed</h3><p class="pre">${r.purpose}</p>` : ''}
      <div class="p-sign"><div>Requested by ${r.byName || r.by}${r.byTitle ? `, ${r.byTitle}` : ''}<br>${fmtFull(r.date)}</div>
        <div>${decided ? `Approved by ${decided.byName || decided.by}, ${fmtFull(decided.at.slice(0, 10))}` : r.status === 'rejected' ? 'Refused' : 'Approval: name, signature and date'}</div></div>
    </div></section>`;
}

export const actions = {
  open(el) { selected = el.dataset.id; notice = ''; problems = []; },
  back() { selected = null; notice = ''; problems = []; },
  filter(el) { filter = el.dataset.k; },
  print() { print(); },
  /** Approve, refuse, move along, deliver, withdraw or reopen. What each person may do is in engine/requests.js and the database rules. */
  move(el, c) {
    const r = find(c.ws);
    const to = el.dataset.to;
    if (!r || !moves(r.status, approver()).some(([k]) => k === to)) return;
    let note = '';
    if (to === 'rejected' || to === 'cancelled') {
      note = prompt(to === 'rejected' ? 'Why is it refused? The person who asked will see this.' : 'Why is it cancelled? (optional)') ;
      if (note === null) return;
    }
    const who = me();
    store.update(ws => {
      const x = find(ws);
      x.status = to;
      x.log = [...(x.log || []), { at: stamp(), by: who.email, byName: who.name, status: to, note: String(note).trim() }];
      const item = x.itemId && ws.items.find(i => i.id === x.itemId);
      if (to === 'approved' && !item) { const f = followUp(x, c.today, uid('i')); ws.items.push(f); x.itemId = f.id; }
      else if (item) item.status = ['fulfilled', 'rejected', 'cancelled'].includes(to) ? 'closed' : 'open';
    });
    notice = `${r.number}: ${statusLabel(to).toLowerCase()}.`;
  },
  cutLine(el, c) {
    store.update(ws => { const r = find(ws); if (r && editable(r, approver())) r.lines = r.lines.filter(l => l.id !== el.dataset.id); });
  },
  email(el, c) {
    const r = find(c.ws);
    if (!r) return;
    const sender = c.global.company?.name || 'Amistad Prefab';
    const name = `${kindLabel(r.kind)} request ${r.number}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: `${kindLabel(r.kind)} request ${r.number}: ${c.project.name}`,
      message: `Dear Sir or Madam,\n\nPlease find attached ${kindLabel(r.kind).toLowerCase()} request ${r.number} for ${c.project.name}, needed by ${r.neededBy ? fmtFull(r.neededBy) : 'the earliest date'}.\n\nPlease confirm that you can supply it and when.\n\nKind regards,\n${store.signature}\n${sender}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) {
        notice = `Sent to ${to}.`;
        store.update(ws => { const x = find(ws); if (x) x.emails = [...(x.emails || []), { at: c.today, to }]; });
      },
    });
  },
  removeRequest(el, c) {
    const r = find(c.ws);
    if (!r || !confirm(`Delete request ${r.number}? To keep the record, use Cancel instead.`)) return;
    store.update(ws => { ws.requests = ws.requests.filter(x => x.id !== r.id); if (r.itemId) ws.items = ws.items.filter(i => i.id !== r.itemId); });
    selected = null;
  },
};

export const changes = {
  set(el) {
    const f = el.dataset.f;
    store.update(ws => { const r = find(ws); if (r && editable(r, approver())) r[f] = el.value.trim(); });
  },
  line(el) {
    const f = el.dataset.f;
    store.update(ws => {
      const r = find(ws);
      const l = r && editable(r, approver()) && r.lines.find(x => x.id === el.dataset.id);
      if (l) l[f] = ['qty', 'days'].includes(f) ? (el.value === '' ? '' : Math.max(0, +el.value)) : el.value.trim();
    });
  },
};

export const submits = {
  newRequest(fd, c) {
    const kind = fd.get('kind');
    const who = me();
    const lines = [{ id: uid('rl'), description: String(fd.get('description') || '').trim(), qty: +fd.get('qty'), unit: String(fd.get('unit') || '').trim() || DEFAULT_UNIT[kind] || '', note: '' }];
    const rec = {
      id: uid('rq'), number: nextNumber(c.ws.requests), kind, priority: fd.get('priority') || 'normal', status: 'requested', date: c.today,
      neededBy: fd.get('neededBy') || '', taskId: fd.get('taskId') || '', purpose: String(fd.get('purpose') || '').trim(), lines,
      by: who.email, byName: who.name, byTitle: store.profile.title || '', projectId: c.project.id,
      log: [{ at: stamp(), by: who.email, byName: who.name, status: 'requested', note: '' }],
    };
    problems = check(rec);
    if (problems.length) return false;
    store.update(ws => ws.requests.push(rec));
    notice = `${rec.number} sent.`;
    selected = rec.id;
  },
  addLine(fd, c) {
    const r = find(c.ws);
    if (!r) return false;
    store.update(ws => {
      const x = find(ws);
      if (x && editable(x, approver())) x.lines.push({ id: uid('rl'), description: String(fd.get('description') || '').trim(), qty: +fd.get('qty'), unit: String(fd.get('unit') || '').trim(), note: '' });
    });
  },
};
