// Home: three numbers, what needs attention, and the follow-up list.

import { store } from '../core/store.js';
import { reminderText, itemTypeLabel } from '../engine/followups.js';
import { uid, money, fmtDay, fmtDate } from '../core/util.js';
import { html, meter, chip } from './dom.js';
import { unseenAlerts, markSeen, flagKey, itemKey } from './seen.js';
import { itemsOf } from './setup.js';

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
      ${flags.auto.length ? html`<ul class="list">${flags.auto.map(f => html`
        <li><a href="#${f.link}" class="row ${unseen.has(flagKey(f)) ? 'unread' : ''}" data-act="seen" data-key="${flagKey(f)}">
          ${chip(SEV_LABEL[f.sev], f.sev)}
          <span class="row-main"><b>${f.title}</b><span class="muted">${f.kind}. ${f.detail}</span></span>
        </a></li>`)}</ul>` : html`<p class="empty">Nothing is flagged on this project.</p>`}
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
};
