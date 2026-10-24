// Discuss: short messages between the people of Amistad. One channel for the
// whole company and one per project. Messages are company-wide records, one
// document each, so they appear on everyone's screen as they are sent.
// The sender may correct a message within 30 seconds, and take it back at any time: it then reads
// "This message was deleted" with the time. A new message from someone else rings and shows a note.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { html } from './dom.js';
import { tell } from '../core/image.js';
import { accountOf } from '../engine/people.js';
import { currentDivision, TRADING } from '../core/division.js';

// Installation and Trading each have their own General channel (and only Installation has the project channels),
// so the two never share a conversation. The older 'general' channel is the Installation one.
const general = () => (currentDivision() === TRADING ? 'general-trading' : 'general');
const SEEN_KEY = 'sf:chat:seen';
const MAX_SHOWN = 300;      // the newest messages of a channel; older ones stay in the database
const MAX_LENGTH = 2000;
const COLOURS = ['#0a3440', '#b47d14', '#3b6e4f', '#6a4c93', '#a23e48', '#2f6690'];
export const EDIT_SECONDS = 30;
const LINK = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/g;

let open = null;
let filter = '';
let editing = null;     // id of the message being corrected
let profile = null;     // id of the message whose sender's card is open
let heard = null;       // the newest message time already announced; null until the first look

const me = () => store.user?.email || 'me';
const myName = () => store.profile?.name || store.user?.name || 'Me';
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
/** Seconds left to correct a message, 0 when it can no longer be changed. Pure. */
export const editLeft = (m, now = Date.now()) => (m.deleted ? 0 : Math.max(0, Math.ceil(EDIT_SECONDS - (now - (m.sentMs || Date.parse(m.at))) / 1000)));
/** A message's text with its web addresses as links that open in a new tab. */
export const linked = text => String(text || '').split(LINK).map((part, i) => {
  if (!(i % 2)) return part;
  const [, url, tail] = part.match(/^(.*?)([.,;:!?)]*)$/);   // a full stop or bracket after an address is not part of it
  return html`<a href="${/^www\./.test(url) ? `https://${url}` : url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
});
/** The sender as the directory knows them (full name, title and photo), else as the message says. */
const sender = (company, m) => {
  const p = (company.staff || []).find(x => accountOf(x) === m.by);
  return { name: p?.name || m.name || m.by, title: p?.title || m.title || '', photo: p?.photo || '', email: m.by };
};
const face = (who, big = false) => (who.photo ? html`<img class="avatar ${big ? 'big' : 'small'}" src="${who.photo}" alt="">`
  : html`<span class="avatar ${big ? 'big' : 'small'}" style="background:${colour(who.email)}">${initials(who.name)}</span>`);
const colour = text => COLOURS[[...String(text)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % COLOURS.length];

/** The channels this person may use: the company one, and the projects they can open. */
const channels = () => [{ id: general(), name: 'General', about: currentDivision() === TRADING ? 'Everyone in Trading' : 'Everyone in Installation' },
  ...(currentDivision() === TRADING ? [] : store.projects.map(p => ({ id: p.id, name: p.name, about: 'Project channel' })))];
const inChannel = (company, id) => (company.messages || []).filter(m => m.channel === id);
const unreadIn = (company, id, seen = readSeen()) => inChannel(company, id).filter(m => m.by !== me() && m.at > (seen[id] || '')).length;

/** Messages from other people in this person's channels that they have not opened yet. */
export function unreadCount(company) {
  const seen = readSeen();
  return channels().reduce((n, ch) => n + unreadIn(company, ch.id, seen), 0);
}

function markSeen(company, id) {
  const last = inChannel(company, id).at(-1);
  if (!last) return;
  const seen = readSeen();
  if ((seen[id] || '') >= last.at) return;
  seen[id] = last.at;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* the red number just stays until next time */ }
}

/** Mark every channel of the open department as read. */
export function markAllRead(company) {
  const seen = readSeen();
  for (const ch of channels()) {
    const last = inChannel(company, ch.id).at(-1);
    if (last && (seen[ch.id] || '') < last.at) seen[ch.id] = last.at;
  }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* the red number just stays until next time */ }
}

/** A short ring, made in the browser (no sound file). Browsers allow it once the page has been clicked. */
function ring() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const tone = (freq, at) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.25);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.3);
    };
    tone(880, 0); tone(1320, 0.15);
    setTimeout(() => ctx.close(), 800);
  } catch { /* no sound on this device */ }
}

/** Called on every screen update: rings and shows a note for messages from others that arrived since the last look. */
export function announce(company, onDiscuss = false) {
  const mine = new Set(channels().map(ch => ch.id));
  const fresh = (company.messages || []).filter(m => mine.has(m.channel) && !m.deleted);
  const newest = fresh.reduce((t, m) => (m.at > t ? m.at : t), '');
  if (heard === null) { heard = newest; return; }      // what was there at sign-in is not news
  const news = fresh.filter(m => m.at > heard && m.by !== me());
  if (newest > heard) heard = newest;
  if (!news.length) return;
  ring();
  const last = news.at(-1);
  if (!(onDiscuss && last.channel === open)) tell(`💬 ${sender(company, last).name}: ${last.text.slice(0, 90)}${news.length > 1 ? ` (+${news.length - 1} more)` : ''}`);
}

const sameDay = (a, b) => a.slice(0, 10) === b.slice(0, 10);
const dayLabel = iso => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeLabel = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function render(c) {
  const all = channels();
  if (!all.some(ch => ch.id === open)) open = general();
  const current = all.find(ch => ch.id === open);
  const seen = readSeen();
  const q = filter.trim().toLowerCase();
  const listed = all.filter(ch => !q || ch.name.toLowerCase().includes(q));
  const log = inChannel(c.company, open).slice(-MAX_SHOWN);
  // drawn newest first inside a reversed column, so the page rests at the latest message
  const rows = log.map((m, i) => ({ m, newDay: i === 0 || !sameDay(log[i - 1].at, m.at) })).reverse();
  markSeen(c.company, open);
  const shown = profile && log.find(m => m.id === profile);
  const card = shown && sender(c.company, shown);

  return html`
    <aside class="card chat-side">
      <input class="search" type="search" data-chg="search" data-fk="chat-q" value="${filter}" placeholder="Search channels" aria-label="Search channels">
      <span class="side-label">Channels</span>
      <ul class="list">${listed.map(ch => {
        const n = ch.id === open ? 0 : unreadIn(c.company, ch.id, seen);
        const last = inChannel(c.company, ch.id).at(-1);
        return html`
          <li><button type="button" class="chat-ch ${ch.id === open ? 'on' : ''}" data-act="open" data-id="${ch.id}">
            <span class="avatar small" style="background:${colour(ch.name)}">${ch.id === general() ? '#' : initials(ch.name)}</span>
            <span class="chat-ch-text"><b>${ch.name}</b><span class="muted">${last ? `${sender(c.company, last).name}: ${last.deleted ? 'message deleted' : last.text}` : ch.about}</span></span>
            ${n ? html`<em>${n}</em>` : ''}
          </button></li>`;
      })}</ul>
      ${listed.length ? '' : html`<p class="muted">No channel with that name.</p>`}
    </aside>
    <section class="card chat-main">
      <div class="toolbar"><h2>${current.id === general() ? '# General' : current.name}</h2><span class="muted">${current.about}${store.cloud ? '' : '. Demo: messages stay in this browser'}</span></div>
      ${card ? profileCard(card) : ''}
      <div class="chat-log">${rows.length ? rows.map(({ m, newDay }) => {
        const who = sender(c.company, m);
        const own = m.by === me();
        const left = own ? editLeft(m) : 0;
        if (left) setTimeout(() => store.notify(), left * 1000 + 50);   // the Edit button goes when the time is up
        return html`
        <div class="chat-msg ${own ? 'mine' : ''} ${m.deleted ? 'gone' : ''}">
          <button type="button" class="chat-face" data-act="profile" data-id="${m.id}" title="${who.name}${who.title ? `, ${who.title}` : ''}">${face(who)}</button>
          <div class="chat-body">
            <span class="chat-meta"><b>${who.name}</b><span class="muted">${timeLabel(m.at)}${m.edited && !m.deleted ? ', edited' : ''}</span>
              ${!m.deleted && left && editing !== m.id ? html`<button type="button" class="btn ghost small" data-act="edit" data-id="${m.id}" title="You can correct it for ${left} more seconds">Edit</button>` : ''}
              ${!m.deleted && (own || c.admin) ? html`<button type="button" class="btn ghost small" data-act="unsend" data-id="${m.id}" title="Delete this message for everyone">Delete</button>` : ''}</span>
            ${m.deleted ? html`<p class="chat-gone">This message was deleted, ${timeLabel(m.deletedAt || m.at)}${sameDay(m.deletedAt || m.at, m.at) ? '' : ` on ${dayLabel(m.deletedAt)}`}</p>`
              : editing === m.id ? html`<form data-form="edit" class="chat-edit"><input name="text" maxlength="${MAX_LENGTH}" value="${m.text}" aria-label="Corrected message" data-fk="chat-edit" required><button class="btn small primary">Save</button><button type="button" class="btn ghost small" data-act="edit" data-id="">Cancel</button></form>`
              : html`<p>${linked(m.text)}</p>`}
          </div>
        </div>
        ${newDay ? html`<div class="chat-day"><span>${dayLabel(m.at)}</span></div>` : ''}`;
      })
        : html`<p class="empty">No messages here yet. Write the first one below.</p>`}</div>
      <form data-form="send" class="chat-form">
        <input name="text" maxlength="${MAX_LENGTH}" placeholder="Message ${current.id === general() ? 'everyone' : current.name}" aria-label="Message" autocomplete="off" required>
        <button class="btn primary">Send</button>
      </form>
    </section>`;
}

/** The sender's card: photo, full name and position. */
const profileCard = who => html`
  <div class="chat-card" role="dialog" aria-label="${who.name}">
    ${face(who, true)}
    <div><b>${who.name}</b><span class="muted">${who.title || 'No position recorded'}</span><span class="muted">${who.email}</span></div>
    <button type="button" class="btn ghost small" data-act="profile" data-id="" aria-label="Close">✕</button>
  </div>`;

export const actions = {
  open(el) { open = el.dataset.id; editing = null; profile = null; },
  profile(el) { profile = el.dataset.id && el.dataset.id !== profile ? el.dataset.id : null; },
  edit(el) { editing = el.dataset.id || null; },
  /** Take a message back: everyone then sees "This message was deleted" and when. The sender, or the Admin. */
  unsend(el, c) {
    const m = (c.company.messages || []).find(x => x.id === el.dataset.id);
    if (!m || !(m.by === me() || c.admin) || !confirm('Delete this message for everyone?')) return;
    store.updateCompany(co => { const x = co.messages.find(y => y.id === m.id); Object.assign(x, { text: '', deleted: true, deletedAt: new Date().toISOString() }); });
  },
};

export const changes = {
  search(el) { filter = el.value; },
};

export const submits = {
  send(fd) {
    const text = String(fd.get('text') || '').trim().slice(0, MAX_LENGTH);
    if (!text) return false;
    const channel = open || general();
    store.updateCompany(co => { (co.messages ||= []).push({ id: uid('msg'), channel, by: me(), name: myName(), title: store.profile?.title || '', text, at: new Date().toISOString(), sentMs: Date.now() }); });
  },
  /** A correction, only within the 30 seconds (the database allows a little more, for a slow connection). */
  edit(fd, c) {
    const m = (c.company.messages || []).find(x => x.id === editing);
    const text = String(fd.get('text') || '').trim().slice(0, MAX_LENGTH);
    editing = null;
    if (!m || !text || text === m.text) return;
    if (!editLeft(m)) { tell('Too late: a message can be corrected for 30 seconds only. Delete it and write it again.'); return; }
    store.updateCompany(co => { Object.assign(co.messages.find(x => x.id === m.id), { text, edited: true }); });
  },
};

export function onEnter(root) { root.querySelector('.chat-form input')?.focus(); }
