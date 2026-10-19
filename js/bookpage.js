// The public booking page (book.html). Nobody signs in: a visitor sees only the
// meeting types, the working hours and which times are already taken, and
// leaves one booking. See engine/booking.js for the records.

import { firebaseConfig } from './config.js';
import { withDefaults, openDays, dayLabel, whenLabel, onCompanyClock, stepsOf, slotId, calendarLink, calendarFile } from './engine/booking.js';

const FIREBASE = '10.12.2';
const BASE = 'company/main';
// the Trading link carries d=trading: its bookings are Trading meetings (no mark means Installation)
const division = new URLSearchParams(location.search).get('d') === 'trading' ? 'trading' : '';
const local = !firebaseConfig || new URLSearchParams(location.search).has('local');
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => `bk${[...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('')}`;

// ---- where the records are: the shared database, or this browser in the demo ----

async function openData() {
  if (local) {
    const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
    return {
      settings: async () => read('sf:booking'),
      taken: async () => new Set((read('sf:company')?.slots || []).map(s => s.id)),
      async book(booking, slots) {
        const co = read('sf:company') || {};
        const have = new Set((co.slots || []).map(s => s.id));
        if (slots.some(s => have.has(s.id))) throw new Error('taken');
        co.slots = [...(co.slots || []), ...slots];
        co.bookings = [...(co.bookings || []), booking];
        localStorage.setItem('sf:company', JSON.stringify(co));
      },
    };
  }
  const sdk = name => import(`https://www.gstatic.com/firebasejs/${FIREBASE}/firebase-${name}.js`);
  const [{ initializeApp }, F] = await Promise.all([sdk('app'), sdk('firestore-lite')]);
  const db = F.getFirestore(initializeApp(firebaseConfig));
  return {
    settings: async () => { const snap = await F.getDoc(F.doc(db, 'public/booking')); return snap.exists() ? snap.data() : null; },
    taken: async () => new Set((await F.getDocs(F.collection(db, `${BASE}/slots`))).docs.map(d => d.id)),
    // one write for everything: if any of the times was taken a moment ago, nothing is saved
    async book(booking, slots) {
      const batch = F.writeBatch(db);
      for (const s of slots) batch.set(F.doc(db, `${BASE}/slots/${s.id}`), s);
      batch.set(F.doc(db, `${BASE}/bookings/${booking.id}`), booking);
      await batch.commit();
    },
  };
}

// ---- the page ----

let data, settings, taken;
let type = null, day = null, start = null;

function draw(message = '') {
  const s = settings;
  const days = type ? openDays(s, taken, type.minutes, Date.now()) : [];
  if (day && !days.some(d => d.day === day)) { day = null; start = null; }
  const times = days.find(d => d.day === day)?.times || [];
  if (start && !times.includes(start)) start = null;

  app.innerHTML = `
    <div class="card"><h1>Book a meeting with ${esc(s.company)}</h1><p class="muted">${esc(s.intro)}</p>${message ? `<p class="bad">${esc(message)}</p>` : ''}</div>
    <div class="card"><h2>1. What kind of meeting?</h2>
      <div class="pick types">${s.types.map(t => `<button type="button" data-type="${esc(t.id)}" class="${type?.id === t.id ? 'on' : ''}"><b>${esc(t.name)}</b><small>${t.minutes} minutes${t.where ? `, ${esc(t.where)}` : ''}</small></button>`).join('')}</div></div>
    ${type ? `<div class="card"><h2>2. Which day?</h2>
      ${days.length ? `<div class="pick days">${days.map(d => `<button type="button" data-day="${d.day}" class="${d.day === day ? 'on' : ''}">${esc(dayLabel(d.day))}<small>${d.times.length} time${d.times.length > 1 ? 's' : ''} free</small></button>`).join('')}</div>`
        : '<p class="muted">There are no free times at the moment. Please contact us directly.</p>'}</div>` : ''}
    ${day ? `<div class="card"><h2>3. What time?</h2><p class="muted">Times are in ${esc(s.zone)}.</p>
      <div class="pick times">${times.map(t => `<button type="button" data-time="${t}" class="${t === start ? 'on' : ''}">${onCompanyClock(t, s.offset).time}</button>`).join('')}</div></div>` : ''}
    ${start ? `<form class="card" id="form"><h2>4. Your details</h2>
      <p><b>${esc(type.name)}</b>, ${type.minutes} minutes<br>${esc(whenLabel(start, s.offset))} <span class="muted">(${esc(s.zone)})</span><br><span class="muted">Your own clock: ${esc(new Date(start).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }))}</span></p>
      <div class="two">
        <label>Your name <input name="name" required maxlength="120" autocomplete="name"></label>
        <label>Company <input name="company" maxlength="120" autocomplete="organization"></label>
        <label>Email <input type="email" name="email" required maxlength="160" autocomplete="email"></label>
        <label>Phone <input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>
      </div>
      <label>What would you like to discuss? <textarea name="note" rows="3" maxlength="1000"></textarea></label>
      <label class="trap" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="go" id="go">Book this meeting</button></form>` : ''}`;
}

function done(b) {
  const s = settings;
  const startMs = Date.parse(b.start);
  const event = { id: b.id, title: `${b.typeName} with ${s.company}`, start: startMs, minutes: b.minutes, where: b.where, details: '' };
  const file = URL.createObjectURL(new Blob([calendarFile(event)], { type: 'text/calendar' }));
  app.innerHTML = `
    <div class="card"><h1>Your meeting is booked</h1>
      <p class="ok">${esc(b.typeName)}, ${b.minutes} minutes</p>
      <p><b>${esc(whenLabel(startMs, s.offset))}</b> <span class="muted">(${esc(s.zone)})</span><br>
        <span class="muted">Your own clock: ${esc(new Date(startMs).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }))}</span></p>
      ${b.where ? `<p>${esc(b.where)}</p>` : ''}
      <p class="muted">${esc(s.company)} has your details and will be in touch if anything changes. Save the meeting in your calendar so you do not miss it:</p>
      <div class="links"><a href="${esc(calendarLink(event))}" target="_blank" rel="noopener">Add to Google Calendar</a><a href="${file}" download="meeting.ics">Outlook or Apple Calendar</a></div>
    </div>`;
  scrollTo({ top: 0 });
}

app.addEventListener('click', e => {
  const b = e.target.closest('button[data-type], button[data-day], button[data-time]');
  if (!b) return;
  if (b.dataset.type) { type = settings.types.find(t => t.id === b.dataset.type); start = null; }
  if (b.dataset.day) { day = b.dataset.day; start = null; }
  if (b.dataset.time) start = +b.dataset.time;
  draw();
  if (b.dataset.time) document.querySelector('#form input')?.focus();
});

app.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (fd.get('website')) return;   // a field people never see: only a robot fills it
  const s = settings;
  const text = k => String(fd.get(k) || '').trim();
  const booking = {
    id: newId(), start: new Date(start).toISOString(), minutes: type.minutes, step: s.step, type: type.id, typeName: type.name, where: type.where || '',
    name: text('name'), company: text('company'), email: text('email').toLowerCase(), phone: text('phone'), note: text('note'),
    at: new Date().toISOString(), status: 'booked', ...(division ? { division } : {}),
  };
  const slots = stepsOf(start, type.minutes, s.step).map(ms => ({ id: slotId(ms), start: new Date(ms).toISOString(), minutes: s.step }));
  document.getElementById('go').disabled = true;
  try {
    await data.book(booking, slots);
    done(booking);
  } catch {
    // most likely someone took the time a moment ago: read the calendar again
    try { taken = await data.taken(); } catch { /* keep what we had */ }
    start = null;
    draw('That time could not be booked. It may just have been taken. Please choose another.');
  }
});

async function begin() {
  try {
    data = await openData();
    settings = withDefaults(await data.settings());
    taken = await data.taken();
  } catch {
    app.innerHTML = '<div class="card"><h1>The booking page could not be opened</h1><p class="bad">Check the internet connection and open the link again.</p></div>';
    return;
  }
  document.getElementById('from').textContent = settings.company;
  document.title = `Book a meeting · ${settings.company}`;
  if (!settings.on) { app.innerHTML = `<div class="card"><h1>Bookings are closed</h1><p class="muted">${esc(settings.company)} is not taking bookings through this page at the moment. Please contact us directly.</p></div>`; return; }
  if (settings.types.length === 1) type = settings.types[0];
  draw();
}

begin();
