// Meetings: what people outside the company booked through the booking page
// (book.html), and the settings of that page. See engine/booking.js.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { html, chip, field } from './dom.js';
import { openMail } from './maildialog.js';
import { currentDivision, TRADING } from '../core/division.js';
import { withDefaults, whenLabel, stepsOf, slotId, calendarLink } from '../engine/booking.js';

const SEEN_KEY = 'sf:meet:seen';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let notice = '';
let showPast = false;

const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); } };
// each division has its own link: a booking made through the Trading link is a Trading meeting
const link = () => {
  const query = [store.cloud ? '' : 'local', currentDivision() === TRADING ? 'd=trading' : ''].filter(Boolean).join('&');
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}book.html${query ? `?${query}` : ''}`;
};
const live = b => b.status !== 'cancelled';

/** Bookings this person has not looked at yet, for the red number in the menu. */
export function unseenCount(company) {
  const seen = readSeen();
  return (company.bookings || []).filter(b => live(b) && Date.parse(b.start) > Date.now() && !seen.has(b.id)).length;
}
export const markAllSeen = company => markSeen(company);
function markSeen(company) {
  const ids = [...new Set([...readSeen(), ...(company.bookings || []).map(b => b.id)])];   // keeps what was seen in the other division
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* the number stays until next time */ }
}

const details = b => [`With: ${b.name}${b.company ? `, ${b.company}` : ''}`, b.email && `Email: ${b.email}`, b.phone && `Phone: ${b.phone}`, b.note && `Note: ${b.note}`].filter(Boolean).join('\n');

export function render(c) {
  const s = withDefaults(store.booking);
  const all = [...(c.company.bookings || [])].sort((a, b) => a.start.localeCompare(b.start));
  const now = Date.now();
  const upcoming = all.filter(b => Date.parse(b.start) + b.minutes * 60000 >= now && live(b));
  const past = all.filter(b => !upcoming.includes(b)).reverse();
  const seen = readSeen();
  markSeen(c.company);
  const admin = c.admin;
  const off = admin ? '' : 'disabled';

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

  return html`
    <section class="card">
      <div class="toolbar"><h2>Upcoming meetings</h2><span class="muted">${upcoming.length ? `${upcoming.length} booked` : 'Nothing booked'}. Times in ${s.zone}</span></div>
      ${notice ? html`<p class="ok">${notice}</p>` : ''}
      ${upcoming.length ? html`<ul class="list">${upcoming.map(row)}</ul>` : html`<p class="empty">No meetings booked yet. Send people the booking link below, or put it in your email signature.</p>`}
      ${past.length ? html`
        <button class="btn ghost small" data-act="past">${showPast ? 'Hide' : 'Show'} past and cancelled (${past.length})</button>
        ${showPast ? html`<ul class="list">${past.map(row)}</ul>` : ''}` : ''}
    </section>

    <section class="card">
      <div class="toolbar"><h2>Booking page</h2>${chip(s.on ? 'Open for bookings' : 'Closed', s.on ? 'ok' : 'high')}</div>
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
    </section>`;
}

const NUMBERS = { noticeHours: [0, 720], horizonDays: [1, 120] };

export const actions = {
  past() { showPast = !showPast; },
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
  type(fd) {
    const s = withDefaults(store.booking);
    const name = fd.get('name').trim();
    if (!name) return false;
    store.setBooking({ types: [...s.types, { id: uid('mt'), name, minutes: Math.max(5, Math.round(+fd.get('minutes') || 30)), where: fd.get('where').trim() }] });
  },
};
