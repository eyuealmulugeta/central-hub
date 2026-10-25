// Meetings, two tabs. "Schedule meeting": an internal meeting with colleagues (title, date and time, length, place or
// link, who is invited). "Schedules": every meeting coming up, the internal ones this person organises or is invited
// to and what people outside the company booked through the booking page (book.html), whose settings are kept at the
// bottom. Internal meetings are company records of one division (section `meetings`). See engine/booking.js.

import { store } from '../core/store.js';
import { uid, fmtFull } from '../core/util.js';
import { html, chip, field, options } from './dom.js';
import { tell } from '../core/image.js';
import { linked } from './discuss.js';
import { openMail } from './maildialog.js';
import { currentDivision, TRADING, stamp } from '../core/division.js';
import { withDefaults, whenLabel, stepsOf, slotId, calendarLink } from '../engine/booking.js';
import { docHead, docSec, footText, signoff } from './print.js';
import { docRef } from '../engine/docref.js';

const SEEN_KEY = 'sf:meet:seen';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let notice = '';
let showPast = false;
let tab = 'list';           // 'schedule' (the form) or 'list' (Schedules)
let heard = null;           // ids of invitations already announced; null until the first look
let minutesOf = null;       // the meeting whose minutes are open (v0.22.4)
const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];

const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); } };
// each division has its own link: a booking made through the Trading link is a Trading meeting
const link = () => {
  const query = [store.cloud ? '' : 'local', currentDivision() === TRADING ? 'd=trading' : ''].filter(Boolean).join('&');
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}book.html${query ? `?${query}` : ''}`;
};
const live = b => b.status !== 'cancelled';
const me = () => store.user?.email || 'me';
const endOf = m => Date.parse(m.start) + m.minutes * 60000;
/** Internal meetings this person organises or is invited to (the Admin sees them all). */
const mineOf = (company, all = false) => (company.meetings || []).filter(m => all || m.by === me() || (m.invitees || []).some(i => i.email === me()));
const invitedTo = company => (company.meetings || []).filter(m => m.by !== me() && live(m) && (m.invitees || []).some(i => i.email === me()));
const whenOf = m => new Date(m.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** Colleagues to invite: the people with access (the Admin's list), else everyone seen writing in Discuss or invited before. */
function colleagues(company) {
  const out = new Map();
  for (const u of store.users || []) out.set(u.email, u.name || u.email);
  for (const m of company.messages || []) if (m.by && !out.has(m.by)) out.set(m.by, m.name || m.by);
  for (const x of company.meetings || []) for (const i of [...(x.invitees || []), { email: x.by, name: x.byName }]) if (i.email && !out.has(i.email)) out.set(i.email, i.name || i.email);
  out.delete(me());
  return [...out].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
}
const inviteText = m => `${m.title}\n${whenOf(m)}, ${m.minutes} minutes${m.where ? `\n${m.where}` : ''}${m.note ? `\n\n${m.note}` : ''}\n\nInvited: ${(m.invitees || []).map(i => i.name || i.email).join(', ')}\nOrganised by ${m.byName || m.by}`;

/** Bookings this person has not looked at yet, for the red number in the menu. */
export function unseenCount(company) {
  const seen = readSeen();
  return (company.bookings || []).filter(b => live(b) && Date.parse(b.start) > Date.now() && !seen.has(b.id)).length
    + invitedTo(company).filter(m => endOf(m) > Date.now() && !seen.has(m.id)).length;
}
export const markAllSeen = company => markSeen(company);
function markSeen(company) {
  const ids = [...new Set([...readSeen(), ...(company.bookings || []).map(b => b.id), ...(company.meetings || []).map(m => m.id)])];   // keeps what was seen in the other division
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* the number stays until next time */ }
}

/** Called on every screen update: a note when someone invites this person to a meeting. */
export function announce(company) {
  const now = invitedTo(company).filter(m => endOf(m) > Date.now());
  if (heard === null) { heard = new Set(now.map(m => m.id)); return; }
  for (const m of now) if (!heard.has(m.id)) { heard.add(m.id); tell(`📅 ${m.byName || m.by} invited you: ${m.title}, ${whenOf(m)}`); }
}

const details = b => [`With: ${b.name}${b.company ? `, ${b.company}` : ''}`, b.email && `Email: ${b.email}`, b.phone && `Phone: ${b.phone}`, b.note && `Note: ${b.note}`].filter(Boolean).join('\n');

export function render(c) {
  const open = minutesOf && (c.company.meetings || []).find(m => m.id === minutesOf);
  if (open) return minutesView(open, c);
  const s = withDefaults(store.booking);
  const all = [...(c.company.bookings || [])].sort((a, b) => a.start.localeCompare(b.start));
  const now = Date.now();
  const upcoming = all.filter(b => Date.parse(b.start) + b.minutes * 60000 >= now && live(b));
  const past = all.filter(b => !upcoming.includes(b)).reverse();
  const seen = readSeen();
  markSeen(c.company);
  const admin = c.admin;
  const off = admin ? '' : 'disabled';

  const people = colleagues(c.company);
  const internal = mineOf(c.company, admin).sort((a, b) => a.start.localeCompare(b.start));
  const soon = internal.filter(m => endOf(m) >= now && live(m));
  const before = internal.filter(m => !soon.includes(m)).reverse();
  const meetRow = m => html`
    <li class="meet-row ${live(m) ? '' : 'closed'}">
      <div class="split">
        <span><b>${whenOf(m)}</b> <span class="muted">${m.minutes} min, internal meeting</span></span>
        <span>${!live(m) ? chip('Cancelled') : m.by !== me() && !seen.has(m.id) && endOf(m) > now ? chip('Invited', 'info') : ''}</span>
      </div>
      <span><b>${m.title}</b> <span class="muted">organised by ${m.by === me() ? 'you' : m.byName || m.by}</span></span>
      <span class="muted">With ${(m.invitees || []).map(i => i.name || i.email).join(', ') || 'nobody yet'}</span>
      ${m.where ? html`<span>${linked(m.where)}</span>` : ''}
      ${m.note ? html`<span class="meet-note">${linked(m.note)}</span>` : ''}
      ${live(m) && endOf(m) > now ? html`
        <div class="actions left">
          <a class="btn small" target="_blank" rel="noopener" href="${calendarLink({ title: m.title, start: Date.parse(m.start), minutes: m.minutes, where: m.where, details: inviteText(m) })}">Add to my Google Calendar</a>
          ${m.by === me() ? html`<button class="btn small" data-act="invite" data-id="${m.id}">Email the invitation</button>` : ''}
          ${m.by === me() || admin ? html`<button class="btn small" data-act="cancelMeeting" data-id="${m.id}">Cancel meeting</button>` : ''}
        </div>` : ''}
      ${live(m) && Date.parse(m.start) <= now && (m.by === me() || admin || m.record) ? html`<div class="actions left">
        <button class="btn small ${m.record ? '' : 'primary'}" data-act="openMinutes" data-id="${m.id}">${m.record ? `Minutes${m.record.actions?.length ? ` · ${m.record.actions.length} actions` : ''}` : 'Write the minutes'}</button></div>` : ''}
    </li>`;

  const row = b => html`
    <li class="meet-row ${live(b) ? '' : 'closed'}">
      <div class="split">
        <span><b>${whenLabel(Date.parse(b.start), s.offset)}</b> <span class="muted">${b.minutes} min, ${b.typeName}</span></span>
        <span>${!live(b) ? chip('Cancelled') : !seen.has(b.id) && Date.parse(b.start) > now ? chip('New', 'info') : ''}</span>
      </div>
      <span><b>${b.name}</b>${b.company ? `, ${b.company}` : ''} <span class="muted">${[b.email, b.phone].filter(Boolean).join(', ')}</span></span>
      ${b.where ? html`<span class="muted">${b.where}</span>` : ''}
      ${b.note ? html`<span class="meet-note">${b.note}</span>` : ''}
      ${live(b) && Date.parse(b.start) > now ? html`
        <div class="actions left">
          <a class="btn small" target="_blank" rel="noopener" href="${calendarLink({ title: `${b.typeName}: ${b.name}`, start: Date.parse(b.start), minutes: b.minutes, where: b.where, details: details(b) })}">Add to my Google Calendar</a>
          ${b.email ? html`<button class="btn small" data-act="confirm" data-id="${b.id}">Email confirmation</button>` : ''}
          <button class="btn small" data-act="cancel" data-id="${b.id}">Cancel meeting</button>
        </div>` : ''}
    </li>`;

  const tabs = [['schedule', 'Schedule meeting'], ['list', 'Schedules']];
  const strip = html`<div class="emp-tabs set-tabs" role="tablist">${tabs.map(([k, label, n]) => html`
    <button type="button" role="tab" class="tab ${tab === k ? 'on' : ''}" data-act="tab" data-t="${k}" aria-selected="${tab === k ? 'true' : 'false'}">${label}${n ? html` <span class="badge">${n}</span>` : ''}</button>`)}</div>`;
  const day = new Date(now + 86400000).toISOString().slice(0, 10);

  if (tab === 'schedule') {
    return html`<div class="side">${strip}
    <section class="card">
      <h2>Schedule a meeting</h2>
      <p class="muted">For a meeting with colleagues. The people you invite see it under Meetings, Schedules, with a note when it arrives. Clients and suppliers book through the booking page instead.</p>
      <form data-form="meeting" class="form">
        <label>Title <input name="title" required maxlength="120" placeholder="e.g. Weekly site coordination"></label>
        <div class="grid4">
          <label>Date <input type="date" name="date" value="${day}" min="${new Date().toISOString().slice(0, 10)}" required></label>
          <label>Time <input type="time" name="time" value="09:00" required></label>
          <label>Length <select name="minutes">${options(LENGTHS.map(n => [String(n), n < 60 ? `${n} minutes` : `${n / 60} hour${n > 60 ? 's' : ''}`.replace('1.5 hours', '1 hour 30')]), '60')}</select></label>
          <label>Place or video link <input name="where" maxlength="300" placeholder="Office, site, or https://meet.google.com/..."></label>
        </div>
        <fieldset class="invitees"><legend>Invite</legend>
          ${people.length ? html`<div class="pills">${people.map(p => html`<label class="check pill"><input type="checkbox" name="invite" value="${p.email}"> ${p.name}</label>`)}</div>`
            : html`<p class="muted">Nobody to choose from yet: type their addresses below.</p>`}
          <label>Other people, by email <input name="others" placeholder="name@gmail.com, name2@gmail.com"></label>
        </fieldset>
        <label>Agenda or note <textarea name="note" rows="3" maxlength="1000"></textarea></label>
        <div class="actions left"><button class="btn primary">Schedule meeting</button><span class="muted">${notice}</span></div>
      </form>
    </section></div>`;
  }

  return html`<div class="side">${strip}
    <section class="card">
      <div class="toolbar"><h2>Meetings with colleagues</h2><span class="muted">${soon.length ? `${soon.length} coming up` : 'None coming up'}</span><span class="grow"></span><button class="btn small primary" data-act="tab" data-t="schedule">Schedule meeting</button></div>
      ${notice ? html`<p class="ok">${notice}</p>` : ''}
      ${soon.length ? html`<ul class="list">${soon.map(meetRow)}</ul>` : html`<p class="empty">No meeting with colleagues coming up.</p>`}
      ${before.length ? html`<details><summary class="muted">Past and cancelled (${before.length})</summary><ul class="list">${before.map(meetRow)}</ul></details>` : ''}
    </section>
    <section class="card">
      <div class="toolbar"><h2>Booked by clients and suppliers</h2><span class="muted">${upcoming.length ? `${upcoming.length} booked` : 'Nothing booked'}. Times in ${s.zone}</span></div>
      ${upcoming.length ? html`<ul class="list">${upcoming.map(row)}</ul>` : html`<p class="empty">No meetings booked yet. Send people the booking link below, or put it in your email signature.</p>`}
      ${past.length ? html`
        <button class="btn ghost small" data-act="past">${showPast ? 'Hide' : 'Show'} past and cancelled (${past.length})</button>
        ${showPast ? html`<ul class="list">${past.map(row)}</ul>` : ''}` : ''}
    </section>

    <details class="card booking-page">
      <summary class="toolbar"><h2>Client booking page</h2>${chip(s.on ? 'Open for bookings' : 'Closed', s.on ? 'ok' : 'high')}<span class="muted">Click to see the link and its settings</span></summary>
      <p class="muted">Anyone with this link can book a meeting in your free times. They do not need an account.</p>
      <div class="entry"><input class="wide" readonly value="${link()}" aria-label="Booking link" data-fk="bk-link"><button class="btn" data-act="copyLink">Copy link</button><a class="btn" href="${link()}" target="_blank" rel="noopener">Open</a></div>
      ${admin ? '' : html`<p class="muted">Only the Admin changes the settings below.</p>`}
      <div class="form">
        <label class="check"><input type="checkbox" data-chg="set" data-f="on" ${s.on ? 'checked' : ''} ${off}> Open for bookings</label>
        <label>Name shown on the page <input data-chg="set" data-f="company" data-fk="bk-co" value="${s.company}" ${off}></label>
        <label>Welcome line <input data-chg="set" data-f="intro" data-fk="bk-intro" value="${s.intro}" ${off}></label>

        <h3>Kinds of meeting</h3>
        <ul class="list">${s.types.map(t => html`
          <li class="meet-type">
            <input data-chg="type" data-id="${t.id}" data-f="name" data-fk="bt-n-${t.id}" value="${t.name}" placeholder="Name" aria-label="Meeting name" ${off}>
            <input type="number" min="5" step="5" data-chg="type" data-id="${t.id}" data-f="minutes" data-fk="bt-m-${t.id}" value="${t.minutes}" title="Length in minutes" aria-label="Minutes" ${off}>
            <input data-chg="type" data-id="${t.id}" data-f="where" data-fk="bt-w-${t.id}" value="${t.where || ''}" placeholder="Where: office, phone, video link" aria-label="Where" ${off}>
            <button class="btn ghost small" data-act="removeType" data-id="${t.id}">Remove</button>
          </li>`)}</ul>
        ${admin ? html`<form data-form="type" class="entry">
          <input name="name" placeholder="New kind of meeting" required aria-label="Meeting name" class="wide">
          <input type="number" name="minutes" min="5" step="5" value="30" required aria-label="Minutes" class="amount">
          <input name="where" placeholder="Where" aria-label="Where" class="wide">
          <button class="btn">Add</button>
        </form>` : ''}

        <h3>When you can meet</h3>
        <div class="week">${WEEKDAYS.map((d, i) => html`
          <label class="check"><input type="checkbox" data-chg="day" data-d="${i}" ${s.days.includes(i) ? 'checked' : ''} ${off}> ${d}</label>`)}</div>
        <div class="grid4">
          <label>From <input type="time" data-chg="set" data-f="from" data-fk="bk-from" value="${s.from}" ${off}></label>
          <label>To <input type="time" data-chg="set" data-f="to" data-fk="bk-to" value="${s.to}" ${off}></label>
          <label>Notice, hours <input type="number" min="0" data-chg="set" data-f="noticeHours" data-fk="bk-notice" value="${s.noticeHours}" title="The soonest a meeting can be booked" ${off}></label>
          <label>Days ahead <input type="number" min="1" max="120" data-chg="set" data-f="horizonDays" data-fk="bk-ahead" value="${s.horizonDays}" ${off}></label>
        </div>
        <p class="muted">Times are in ${s.zone}. A time someone has booked disappears from the page for everyone else.</p>
      </div>
    </details></div>`;
}

const NUMBERS = { noticeHours: [0, 720], horizonDays: [1, 120] };

/** Who may write the minutes: the organiser and the Admin. Everyone invited reads and prints them. */
const mayWrite = (m, c) => m.by === me() || c.admin;
const blankRecord = m => ({ attendees: [m.byName || m.by, ...(m.invitees || []).map(i => i.name || i.email)], others: '', agenda: m.note || '', decisions: '', actions: [], next: '' });
const lines = t => String(t || '').split('\n').map(x => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
const minutesRef = (m, c) => docRef({ company: c.global.company, project: c.project, type: 'MIN', key: m.start.slice(0, 10) });

/** The minutes: the form for the organiser beside the printed page (attendees, agenda, decisions, actions with owner and date). */
function minutesView(m, c) {
  const r = { ...blankRecord(m), ...(m.record || {}) };
  const can = mayWrite(m, c);
  const everyone = [m.byName || m.by, ...(m.invitees || []).map(i => i.name || i.email)];
  return html`<div class="toolbar no-print"><button class="btn ghost" data-act="closeMinutes">← Meetings</button><span class="muted">${notice}</span><span class="grow"></span>
      <button class="btn" data-share title="Send the minutes as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="printMinutes">Print</button></div>
    ${can ? html`<section class="card no-print min-form">
      <h3>Who attended</h3>
      <div class="week">${everyone.map(n => html`<label class="check"><input type="checkbox" data-chg="minAtt" data-v="${n}" ${r.attendees.includes(n) ? 'checked' : ''}> ${n}</label>`)}</div>
      <label>Also present (names, one per line) <textarea data-chg="minSet" data-f="others" data-fk="min-others" rows="2">${r.others}</textarea></label>
      <label>Agenda (one point per line) <textarea data-chg="minSet" data-f="agenda" data-fk="min-agenda" rows="3">${r.agenda}</textarea></label>
      <label>Decisions (one per line) <textarea data-chg="minSet" data-f="decisions" data-fk="min-dec" rows="4">${r.decisions}</textarea></label>
      <h3>Actions</h3>
      ${r.actions.length ? html`<table class="table compact"><thead><tr><th>Action</th><th>Who</th><th>By when</th><th>Done</th><th></th></tr></thead>
        <tbody>${r.actions.map(a => html`<tr><td>${a.text}</td><td>${a.owner || ''}</td><td class="nowrap">${a.due ? fmtFull(a.due) : ''}</td>
          <td><input type="checkbox" data-chg="minDone" data-id="${a.id}" ${a.done ? 'checked' : ''} aria-label="Done"></td>
          <td class="r"><button class="btn ghost small" data-act="cutAction" data-id="${a.id}">Take out</button></td></tr>`)}</tbody></table>` : ''}
      <form data-form="minAction" class="entry">
        <input name="text" class="wide" required placeholder="What is to be done" aria-label="Action">
        <input name="owner" list="min-people" placeholder="Who" aria-label="Who"><datalist id="min-people">${everyone.map(n => html`<option value="${n}">`)}</datalist>
        <input name="due" type="date" aria-label="By when">
        <button class="btn">Add action</button>
      </form>
      <label>Next meeting <input data-chg="minSet" data-f="next" data-fk="min-next" value="${r.next}" placeholder="Date, time and place"></label>
    </section>` : ''}
    <section class="card sheet">${minutesPaper(m, r, c)}</section>`;
}

function minutesPaper(m, r, c) {
  const ref = minutesRef(m, c);
  const present = [...r.attendees, ...lines(r.others)];
  const absent = [m.byName || m.by, ...(m.invitees || []).map(i => i.name || i.email)].filter(n => !r.attendees.includes(n));
  let n = 0;
  return html`<div class="paper dsr doc-paper" data-foot="${footText(c, 'Minutes of meeting', ref)}">
    ${docHead(c, { title: 'Minutes of meeting', sub: m.title, ref, facts: [['Date', `${fmtFull(m.start.slice(0, 10))}, ${new Date(m.start).toTimeString().slice(0, 5)}`], ['Length', `${m.minutes} min`], ['Place', m.where || ''], ['Chaired by', m.byName || m.by]] })}
    ${docSec(++n, 'Attendance', html`<p><b>Present:</b> ${present.join(', ') || '—'}</p>${absent.length ? html`<p class="muted"><b>Absent:</b> ${absent.join(', ')}</p>` : ''}`, `${present.length} present`)}
    ${lines(r.agenda).length ? docSec(++n, 'Agenda', html`<ol class="min-list">${lines(r.agenda).map(x => html`<li>${x}</li>`)}</ol>`) : ''}
    ${docSec(++n, 'Decisions', lines(r.decisions).length ? html`<ol class="min-list">${lines(r.decisions).map(x => html`<li>${x}</li>`)}</ol>` : html`<p class="muted">No decision recorded.</p>`)}
    ${docSec(++n, 'Actions', r.actions.length ? html`<table class="dsr-t"><thead><tr><th>#</th><th>Action</th><th>Who</th><th>By when</th><th>Status</th></tr></thead>
      <tbody>${r.actions.map((a, i) => html`<tr><td>${i + 1}</td><td>${a.text}</td><td>${a.owner || ''}</td><td class="nowrap">${a.due ? fmtFull(a.due) : ''}</td><td>${a.done ? 'Done' : 'Open'}</td></tr>`)}</tbody></table>` : html`<p class="muted">No action agreed.</p>`, `${r.actions.length}`)}
    ${r.next ? docSec(++n, 'Next meeting', html`<p>${r.next}</p>`) : ''}
    ${signoff([{ label: 'Minutes taken by', name: m.byName || m.by }, { label: 'Approved by' }])}
  </div>`;
}

const saveRecord = (c, fn) => store.updateCompany(co => {
  const x = (co.meetings || []).find(k => k.id === minutesOf);
  if (!x) return;
  x.record = { ...blankRecord(x), ...(x.record || {}) };
  fn(x.record);
  x.record.updated = new Date().toISOString();
});

export const actions = {
  openMinutes(el) { minutesOf = el.dataset.id; notice = ''; },
  closeMinutes() { minutesOf = null; notice = ''; },
  printMinutes() { print(); },
  cutAction(el, c) { saveRecord(c, r => { r.actions = r.actions.filter(a => a.id !== el.dataset.id); }); },
  tab(el) { tab = el.dataset.t; notice = ''; },
  past() { showPast = !showPast; },
  /** The invitation by email to everyone invited, with the calendar link. */
  invite(el, c) {
    const m = (c.company.meetings || []).find(x => x.id === el.dataset.id);
    if (!m) return;
    openMail({
      to: (m.invitees || []).map(i => i.email).join(', '),
      subject: `Meeting: ${m.title}, ${whenOf(m)}`,
      message: `Hello,\n\nYou are invited to a meeting.\n\n${inviteText(m)}\n\nAdd it to your calendar:\n${calendarLink({ title: m.title, start: Date.parse(m.start), minutes: m.minutes, where: m.where, details: '' })}\n\nKind regards,\n${store.signature}`,
      onSent({ to }) { notice = `Invitation sent to ${to}.`; store.notify(); },
    });
  },
  cancelMeeting(el, c) {
    const m = (c.company.meetings || []).find(x => x.id === el.dataset.id);
    if (!m || !confirm(`Cancel "${m.title}" on ${whenOf(m)}? The people invited see it as cancelled. No email is sent.`)) return;
    store.updateCompany(co => { const x = co.meetings.find(k => k.id === m.id); if (x) x.status = 'cancelled'; });
  },
  copyLink() {
    navigator.clipboard.writeText(link()).then(() => { notice = 'Booking link copied.'; store.notify(); }, () => {});
  },
  confirm(el, c) {
    const b = c.company.bookings.find(x => x.id === el.dataset.id);
    const s = withDefaults(store.booking);
    const start = Date.parse(b.start);
    openMail({
      to: b.email,
      subject: `Confirmed: ${b.typeName}, ${whenLabel(start, s.offset)}`,
      message: `Dear ${b.name},\n\nYour meeting with ${s.company} is confirmed.\n\n${b.typeName}, ${b.minutes} minutes\n${whenLabel(start, s.offset)} (${s.zone})\n${b.where || ''}\n\nAdd it to your calendar:\n${calendarLink({ title: `${b.typeName} with ${s.company}`, start, minutes: b.minutes, where: b.where, details: '' })}\n\nIf you cannot make it, please reply to this email.\n\nKind regards,\n${store.signature}\n${s.company}`,
      onSent({ to }) { notice = `Confirmation sent to ${to}.`; store.notify(); },
    });
  },
  cancel(el, c) {
    const b = c.company.bookings.find(x => x.id === el.dataset.id);
    const s = withDefaults(store.booking);
    if (!b || !confirm(`Cancel the meeting with ${b.name} on ${whenLabel(Date.parse(b.start), s.offset)}? The time becomes free again. Tell them yourself: no email is sent.`)) return;
    const freed = new Set(stepsOf(Date.parse(b.start), b.minutes, b.step || s.step).map(slotId));
    store.updateCompany(co => {
      const x = co.bookings.find(k => k.id === b.id);
      if (x) x.status = 'cancelled';
      co.slots = (co.slots || []).filter(k => !freed.has(k.id));
    });
  },
  removeType(el) {
    const s = withDefaults(store.booking);
    if (s.types.length < 2) { notice = 'Keep at least one kind of meeting.'; return; }
    store.setBooking({ types: s.types.filter(t => t.id !== el.dataset.id) });
  },
};

export const changes = {
  minSet(el, c) { saveRecord(c, r => { r[el.dataset.f] = el.value; }); },
  minAtt(el, c) { saveRecord(c, r => { r.attendees = el.checked ? [...new Set([...r.attendees, el.dataset.v])] : r.attendees.filter(n => n !== el.dataset.v); }); },
  minDone(el, c) { saveRecord(c, r => { const a = r.actions.find(x => x.id === el.dataset.id); if (a) a.done = el.checked; }); },
  set(el) {
    const f = el.dataset.f;
    let value = field(el);
    if (NUMBERS[f]) value = Math.min(NUMBERS[f][1], Math.max(NUMBERS[f][0], Math.round(+value || 0)));
    else if (typeof value === 'string') value = value.trim();
    if ((f === 'from' || f === 'to') && !/^\d\d:\d\d$/.test(value)) return;
    store.setBooking({ [f]: value });
  },
  day(el) {
    const s = withDefaults(store.booking);
    const d = +el.dataset.d;
    store.setBooking({ days: el.checked ? [...new Set([...s.days, d])].sort() : s.days.filter(x => x !== d) });
  },
  type(el) {
    const s = withDefaults(store.booking);
    const f = el.dataset.f;
    const value = f === 'minutes' ? Math.max(5, Math.round(+el.value || 30)) : el.value.trim();
    if (f === 'name' && !value) return;
    store.setBooking({ types: s.types.map(t => (t.id === el.dataset.id ? { ...t, [f]: value } : t)) });
  },
};

export const submits = {
  minAction(fd, c) {
    const text = String(fd.get('text') || '').trim();
    if (!text) return false;
    saveRecord(c, r => { r.actions.push({ id: uid('act'), text: text.slice(0, 300), owner: String(fd.get('owner') || '').trim().slice(0, 80), due: fd.get('due') || '', done: false }); });
  },
  /** A meeting with colleagues: saved for this division, seen by the people invited. */
  meeting(fd, c) {
    const start = new Date(`${fd.get('date')}T${fd.get('time')}`);
    if (Number.isNaN(+start)) return false;
    if (+start < Date.now()) { notice = 'That time has passed. Choose a later one.'; return false; }
    const names = new Map(colleagues(c.company).map(p => [p.email, p.name]));
    const typed = String(fd.get('others') || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    const emails = [...new Set([...fd.getAll('invite'), ...typed])].filter(e => e !== me());
    if (!emails.length) { notice = 'Invite at least one person.'; return false; }
    const m = {
      id: uid('mtg'), title: String(fd.get('title') || '').trim().slice(0, 120), start: start.toISOString(), minutes: Math.max(5, +fd.get('minutes') || 60),
      where: String(fd.get('where') || '').trim().slice(0, 300), note: String(fd.get('note') || '').trim().slice(0, 1000),
      invitees: emails.map(email => ({ email, name: names.get(email) || email })), by: me(), byName: store.profile?.name || store.user?.name || me(),
      at: new Date().toISOString(), status: 'planned', ...stamp(),
    };
    store.updateCompany(co => { (co.meetings ||= []).push(m); });
    tab = 'list';
    notice = `"${m.title}" scheduled. The people invited see it with a note. Use "Email the invitation" to send it to their inbox too.`;
  },
  type(fd) {
    const s = withDefaults(store.booking);
    const name = fd.get('name').trim();
    if (!name) return false;
    store.setBooking({ types: [...s.types, { id: uid('mt'), name, minutes: Math.max(5, Math.round(+fd.get('minutes') || 30)), where: fd.get('where').trim() }] });
  },
};
