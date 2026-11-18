// Home: three numbers, what needs attention, and the follow-up list.

import { store } from '../core/store.js';
import { reminderText, itemTypeLabel } from '../engine/followups.js';
import { uid, money, fmtDay, fmtDate } from '../core/util.js';
import { html, meter, chip } from './dom.js';
import { unseenAlerts, markSeen, flagKey, itemKey } from './seen.js';
import { itemsOf } from './setup.js';
import { projectForm, submits as spotSubmits } from './spotnotes.js';
import { markDayOff, reqListFR, requestReport } from '../sync/fieldreport.js';

// v1.73.0 (owner, 18 Nov): Request report on a missing day (Field Report script 7.70.0): the requests and engineers of a project
const frReq = {};   // Field Report code -> { reqs, engineers, at, busy }
const hm = iso => { const d = new Date(iso); return iso && !Number.isNaN(+d) ? d.toTimeString().slice(0, 5) : ''; };
/** The status line of a request: "Requested 10:20 to Abebe by Tes · Seen 11:05 · due ...", "Submitted", "cancelled". */
export function reqLine(r) {
  if (!r || !r.at) return '';
  if (r.sub) return `Requested ${hm(r.at)} · Submitted ${hm(r.sub)}`;
  if (r.cx) return `Request cancelled ${hm(r.cx)}`;
  return `Requested ${hm(r.at)}${r.toName ? ` to ${r.toName}` : ''} by ${r.by}${r.seen ? ` · Seen ${hm(r.seen)}` : ' · Not seen yet'} · due ${String(r.due || '').replace('T', ' ')}`;
}
/** One request every 4 hours (the script refuses sooner too): '' or the time it may go again. */
export const reqWait = (r, now = Date.now()) => (r && r.at && !r.sub && Date.parse(r.at) + 4 * 3600e3 > now ? hm(new Date(Date.parse(r.at) + 4 * 3600e3).toISOString()) : '');
const reqOpenFR = r => !!r && !r.sub && !r.cx;
function loadReqs(code, force) {
  const k = frReq[code];
  if (!code || (k && (k.busy || (!force && Date.now() - k.at < 5 * 60e3)))) return;
  frReq[code] = { ...(k || { reqs: {}, engineers: [] }), busy: true };
  reqListFR(code).then(o => { frReq[code] = { reqs: o.reqs || {}, engineers: o.engineers || [], at: Date.now() }; paintReqs(code); })
    .catch(() => { frReq[code] = { reqs: {}, engineers: [], at: Date.now() }; });
}
/** Fills the request lines and the "Send to" lists in the page once Field Report answered. */
function paintReqs(code) {
  const k = frReq[code];
  document.querySelectorAll(`[data-frreq][data-code="${code}"]`).forEach(el => { el.textContent = reqLine(k.reqs[el.dataset.frreq]) || 'Not requested yet'; });
  document.querySelectorAll(`select[data-req-to][data-code="${code}"]`).forEach(sel => {
    sel.replaceChildren(...k.engineers.map((e, i) => Object.assign(document.createElement('option'), { value: e.id, textContent: `${e.name}${i === 0 && e.n ? ' (usually reports)' : ''}` })));
  });
}

const DAYOFF_KINDS = ['Holiday', 'Weather', 'Client stop', 'Other'];   // = Field Report script 7.68.0

const SEV_LABEL = { high: 'Urgent', warn: 'Watch', info: 'Note' };
const REMIND_EVERY_DAYS = 3;
let notice = '';

const kpi = (label, value, sub, extra = '') => html`
  <div class="kpi"><span class="kpi-label">${label}</span><strong>${value}</strong><span class="muted">${sub}</span>${extra}</div>`;

/** While the essentials of the project are not all done, the Admin is told what is next. */
function setupBanner(c) {
  if (!store.isAdmin || c.project.setupHidden) return '';
  const { items, essentials, essentialsTotal, complete } = itemsOf(c);
  if (complete) return '';
  const next = items.find(i => i.required && !i.done);
  return html`<div class="field-note"><span><b>Setting up this project: ${essentials} of ${essentialsTotal} essentials done.</b> Next: ${next.label.toLowerCase()}.</span>
    <a class="btn small primary" href="#setup">Open the checklist</a></div>`;
}

/** v1.73.0: the Request report row under "Daily report missing" (the GM and the approvers). */
function reqRow(code, day, today) {
  const k = frReq[code]; loadReqs(code);
  const r = k?.reqs?.[day], wait = reqWait(r), eng = k?.engineers || [];
  return html`<span class="toolbar">
    <span class="muted" data-frreq="${day}" data-code="${code}">${k && !k.busy ? reqLine(r) || 'Not requested yet' : 'Checking requests…'}</span>
    <select aria-label="Send to" data-req-to data-code="${code}">${eng.length ? eng.map((e, i) => html`<option value="${e.id}">${e.name}${i === 0 && e.n ? ' (usually reports)' : ''}</option>`) : html`<option value="">The usual site engineer</option>`}</select>
    <input data-req-note maxlength="200" placeholder="Note (optional)" aria-label="Note">
    <input type="datetime-local" data-req-due value="${today}T23:59" aria-label="Due">
    <button class="btn small" data-act="reqReport" data-day="${day}" ${wait ? `disabled title="One request every 4 hours: again after ${wait}"` : ''}>Request report</button>
    ${reqOpenFR(r) ? html`<button class="btn small ghost" data-act="reqCancel" data-day="${day}">Cancel request</button>` : ''}</span>`;
}

export function render(c) {
  const { sched: s, led, flags, project: p } = c;
  const behind = s.progress + 5 < s.plannedProgress;
  const unseen = unseenAlerts(p.id, flags);

  return html`
    <section class="kpis">
      ${kpi('Progress', `${Math.round(s.progress)}%`, `Planned ${Math.round(s.plannedProgress)}% by today`, meter(s.progress, behind ? 'bad' : ''))}
      ${kpi('Forecast finish', s.rows.length ? fmtDay(s.end) : '—', s.slip > 0 ? `${s.slip} working days behind plan` : s.slip < 0 ? `${-s.slip} working days ahead` : 'On plan')}
      ${!c.money ? '' : kpi('Spent', money(led.spent, p.currency), `of ${money(led.budget, p.currency)} budget`, meter(led.budget ? led.spent / led.budget * 100 : 0, led.spent > led.budget ? 'bad' : ''))}
    </section>

    <section class="card">
      ${setupBanner(c)}
      <h2>Needs attention</h2>
      ${store.readOnly ? '' : projectForm()}
      ${flags.auto.length ? html`<ul class="list">${flags.auto.map(f => html`
        <li><a href="#${f.link}" class="row ${unseen.has(flagKey(f)) ? 'unread' : ''}" data-act="seen" data-key="${flagKey(f)}">
          ${chip(SEV_LABEL[f.sev], f.sev)}
          <span class="row-main"><b>${f.title}</b><span class="muted">${f.kind}. ${f.detail}</span></span>
        </a>${f.day && p.fieldCode && store.canApprove && !store.readOnly ? html`<span class="toolbar">
          <select aria-label="Reason for the day off" data-dayoff-k>${DAYOFF_KINDS.map(k => html`<option>${k}</option>`)}</select>
          <button class="btn small" data-act="dayOff" data-day="${f.day}">Mark ${fmtDate(f.day)} as day-off</button></span>${reqRow(p.fieldCode, f.day, c.today)}` : ''}</li>`)}</ul>` : html`<p class="empty">Nothing is flagged on this project.</p>`}
    </section>

    <section class="card">
      <div class="toolbar"><h2>Follow-ups</h2><span class="muted">${notice}</span></div>
      <form data-form="item" class="entry">
        <input name="title" placeholder="What are you waiting on?" required aria-label="Follow-up" class="wide">
        <input name="owner" list="team-owners" placeholder="Who (name or email)" aria-label="Owner">
        <datalist id="team-owners">${c.ws.team.map(m => html`<option value="${m.name}"></option>`)}</datalist>
        <input type="date" name="due" aria-label="Due date">
        <button class="btn primary">Add</button>
      </form>
      ${flags.items.length ? html`<ul class="list">${flags.items.map(i => html`
        <li class="row top ${i.status === 'closed' ? 'closed' : ''} ${unseen.has(itemKey(i)) ? 'unread' : ''}" data-act="seen" data-key="${itemKey(i)}" ${unseen.has(itemKey(i)) ? html`title="Click to mark as read"` : ''}>
          <span class="row-main">
            <b>${i.title}</b>
            <span class="muted">${itemTypeLabel(i.type)}, ${i.owner || 'no owner'}, open ${i.age} days${i.due ? `, due ${fmtDate(i.due)}` : ''}</span>
            <span>${i.overdue ? chip('Overdue', 'high') : ''} ${i.reminderDue ? chip('Reminder due', 'warn') : ''} ${i.status === 'closed' ? chip('Done', 'ok') : ''}</span>
          </span>
          ${i.status === 'open' ? html`
            <button class="btn small ${i.reminderDue ? 'primary' : ''}" data-act="remind" data-id="${i.id}">Remind</button>
            <button class="btn ghost small" data-act="close" data-id="${i.id}">Done</button>`
          : html`<button class="btn ghost small" data-act="remove" data-id="${i.id}">Delete</button>`}
        </li>`)}</ul>` : html`<p class="empty">Nothing to chase. Site requests from daily reports land here.</p>`}
    </section>`;
}

export const submits = {
  ...spotSubmits,
  item(fd, c) {
    store.update(ws => ws.items.push({
      id: uid('i'), type: 'other', title: fd.get('title').trim(), owner: fd.get('owner').trim(),
      created: c.today, due: fd.get('due') || '', status: 'open', remindEvery: REMIND_EVERY_DAYS,
    }));
    notice = '';
  },
};

const seen = (c, key) => markSeen(c.project.id, c.flags, key);

export const actions = {
  /** An alert was opened: it no longer counts towards the red number beside Home. */
  seen(el, c) { seen(c, el.dataset.key); },
  /** Opens a pre-written email when the owner is an address, otherwise copies the text. */
  remind(el, c) {
    const item = c.ws.items.find(i => i.id === el.dataset.id);
    seen(c, itemKey(item));
    const { subject, body } = reminderText(item, c.project, c.today);
    // a team member's name resolves to their email when one is on file
    const contact = c.ws.team.find(m => m.name === item.owner)?.contact || '';
    const to = [item.owner, contact].find(v => v.includes('@'));
    if (to) {
      location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      notice = 'Reminder drafted in your email app.';
    } else {
      navigator.clipboard?.writeText(`${subject}\n\n${body}`).catch(() => {});
      notice = 'Reminder text copied to the clipboard.';
    }
    store.update(ws => { ws.items.find(i => i.id === item.id).lastReminded = c.today; });
  },
  close(el, c) { store.update(ws => Object.assign(ws.items.find(i => i.id === el.dataset.id), { status: 'closed', closedAt: c.today })); },
  remove(el) { store.update(ws => { ws.items = ws.items.filter(i => i.id !== el.dataset.id); }); },
  /** v1.71.0 (owner, 17 Nov): the GM or the PE marks the missing day as a day off in Field Report; the calendar adds it. */
  /** v1.73.0 (owner, 18 Nov): ask the site engineer for the missing day's report (push + pop-up on his phone). */
  async reqReport(el, c) {
    const li = el.closest('li'), code = c.project.fieldCode;
    el.disabled = true;
    try {
      const out = await requestReport({ proj: code, date: el.dataset.day, to: li?.querySelector('[data-req-to]')?.value, note: li?.querySelector('[data-req-note]')?.value, due: li?.querySelector('[data-req-due]')?.value });
      frReq[code] = { ...(frReq[code] || { engineers: [] }), reqs: out.reqs || {}, at: Date.now(), busy: false };
      paintReqs(code);
      alert(`Requested from ${out.req?.toName || 'the site engineer'}. It pops up on his phone until the report is sent.`);
    } catch (e) { el.disabled = false; alert(`Not sent: ${e.message}`); }
  },
  async reqCancel(el, c) {
    if (!confirm('Cancel this report request?')) return;
    const code = c.project.fieldCode;
    try { const out = await requestReport({ proj: code, date: el.dataset.day, cancel: true }); frReq[code] = { ...(frReq[code] || { engineers: [] }), reqs: out.reqs || {}, at: Date.now(), busy: false }; paintReqs(code); el.remove(); }
    catch (e) { alert(`Not cancelled: ${e.message}`); }
  },
  async dayOff(el, c) {
    const day = el.dataset.day, k = el.closest('li')?.querySelector('[data-dayoff-k]')?.value || 'Holiday';
    if (!confirm(`Mark ${fmtDate(day)} as a day off (${k}) for ${c.project.name}? No report is then needed for that day.`)) return;
    el.disabled = true;
    try {
      await markDayOff({ proj: c.project.fieldCode, date: day, k, by: store.user?.name || '' });
      store.updateProject(p => { p.nonWorking = [...new Set([...(p.nonWorking || []), day])].sort(); });
    } catch (e) { el.disabled = false; alert(`Not marked: ${e.message}`); }
  },
};
