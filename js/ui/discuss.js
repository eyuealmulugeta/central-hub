// Discuss: short messages between the people of Amistad. One channel for the
// whole company and one per project. Messages are company-wide records, one
// document each, so they appear on everyone's screen as they are sent.
// The sender may correct a message within 1 minute (v1.13.1, was 30 seconds), and take it back in the first 5 minutes:
// it then reads "This message was deleted" with the time. After 5 minutes Delete only hides it from the sender (hiddenFor). A new message from someone else rings and shows a note.
// v0.65.0 (owner, Phase C2): private one-to-one chats ('dm:<email>'), in company.direct; only the two people read them.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { html } from './dom.js';
import { tell } from '../core/image.js';
import { accountOf } from '../engine/people.js';
import { tagOf, tick } from '../engine/receipts.js';   // v1.37.0
import { currentDivision, TRADING } from '../core/division.js';

// Installation and Trading each have their own General channel (and only Installation has the project channels),
// so the two never share a conversation. The older 'general' channel is the Installation one.
const general = () => (currentDivision() === TRADING ? 'general-trading' : 'general');
const SEEN_KEY = 'sf:chat:seen';
const MAX_SHOWN = 300;      // the newest messages of a channel; older ones stay in the database
const MAX_LENGTH = 2000;
const COLOURS = ['#0a3440', '#b47d14', '#3b6e4f', '#6a4c93', '#a23e48', '#2f6690'];
export const EDIT_SECONDS = 60;
export const TAKE_BACK_MS = 5 * 60e3;   // v1.13.1 (owner): for everyone in the first 5 minutes, then only from the sender's view
export const takeBackLeft = (m, now = Date.now()) => !m.deleted && now - (m.sentMs || Date.parse(m.at) || 0) < TAKE_BACK_MS;
const hiddenFromMe = m => (m.hiddenFor || []).includes(me());
const LINK = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/g;

let open = null;
let filter = '';
let editing = null;     // id of the message being corrected
let profile = null;     // id of the message whose sender's card is open
let heard = null;       // the newest message time already announced; null until the first look

const me = () => String(store.user?.email || 'me').toLowerCase();
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

const DM = 'dm:';
export const isDirect = id => String(id || '').startsWith(DM);
const otherOf = id => String(id).slice(DM.length);
/** The two people of a one-to-one chat, as the database keeps them: lower case, sorted. */
export const pairOf = (a, b) => [a, b].map(x => String(x).trim().toLowerCase()).sort();
const chatOf = m => (m.members ? DM + (m.members.find(x => x !== me()) || '') : m.channel);

/** Colleagues to write to: the people with access (the Admin's list), and everyone seen in Discuss or Meetings. */
export function colleagues(company) {
  const out = new Map();
  for (const u of store.users || []) out.set(String(u.email).toLowerCase(), u.name || u.email);
  for (const m of [...(company.messages || []), ...(company.direct || [])]) if (m.by && !out.has(m.by)) out.set(m.by, m.name || m.by);
  for (const x of company.meetings || []) for (const i of [...(x.invitees || []), { email: x.by, name: x.byName }]) if (i.email && !out.has(i.email.toLowerCase())) out.set(i.email.toLowerCase(), i.name || i.email);
  out.delete(me());
  return [...out].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** v0.65.0: this person's one-to-one chats, newest first, and the one being started. */
function directs(company) {
  const names = new Map(colleagues(company).map(p => [p.email, p.name]));
  const last = new Map();
  for (const m of company.direct || []) {
    const o = (m.members || []).find(x => x !== me());
    if (o && (m.members || []).includes(me())) last.set(o, m.at > (last.get(o) || '') ? m.at : last.get(o));
  }
  if (isDirect(open) && !last.has(otherOf(open))) last.set(otherOf(open), '~');
  return [...last].sort((a, b) => b[1].localeCompare(a[1])).map(([email]) => {
    const who = sender(company, { by: email, name: names.get(email) || email });
    return { id: DM + email, name: who.name, about: who.title || email, direct: true, who };
  });
}

/** The channels this person may use: the company one, the projects they can open and (v0.65.0) their one-to-one chats. */
const channels = (company = store.company || {}) => [{ id: general(), name: 'General', about: currentDivision() === TRADING ? 'Everyone in Trading' : 'Everyone in Installation' },
  ...(currentDivision() === TRADING ? [] : store.projects.map(p => ({ id: p.id, name: p.name, about: 'Project channel' }))), ...directs(company)];
// a person sees a project channel from the day they were put on the project, and General from the day they were given
// access (store.seesFrom); people who had access before keep the history, and the Admin sees everything
const visible = (m, id) => m.channel === id && String(m.at || '') >= store.seesFrom(id, general());
const inChannel = (company, id) => (isDirect(id)
  ? (company.direct || []).filter(m => (m.members || []).includes(me()) && (m.members || []).includes(otherOf(id)))
  : (company.messages || []).filter(m => visible(m, id))).filter(m => !hiddenFromMe(m));
const unreadIn = (company, id, seen = readSeen()) => inChannel(company, id).filter(m => m.by !== me() && m.at > (seen[id] || '')).length;

/** Messages from other people in this person's channels that they have not opened yet. */
export function unreadCount(company) {
  const seen = readSeen();
  return channels(company).reduce((n, ch) => n + unreadIn(company, ch.id, seen), 0);
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
  for (const ch of channels(company)) {
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
  const mine = new Set(channels(company).map(ch => ch.id));
  const fresh = [...(company.messages || []).filter(m => mine.has(m.channel) && visible(m, m.channel)), ...(company.direct || [])].filter(m => !m.deleted);
  const newest = fresh.reduce((t, m) => (m.at > t ? m.at : t), '');
  if (heard === null) { heard = newest; return; }      // what was there at sign-in is not news
  const news = fresh.filter(m => m.at > heard && m.by !== me());
  if (newest > heard) heard = newest;
  if (!news.length) return;
  ring();
  const last = news.at(-1);
  if (!(onDiscuss && chatOf(last) === open)) tell(`💬 ${sender(company, last).name}${last.members ? ' (to you)' : ''}: ${last.text.slice(0, 90)}${news.length > 1 ? ` (+${news.length - 1} more)` : ''}`);
}

const sameDay = (a, b) => a.slice(0, 10) === b.slice(0, 10);
const dayLabel = iso => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeLabel = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function render(c) {
  const all = channels(c.company);
  if (!all.some(ch => ch.id === open)) open = general();
  const people = colleagues(c.company);
  const current = all.find(ch => ch.id === open);
  const seen = readSeen();
  const q = filter.trim().toLowerCase();
  const listed = all.filter(ch => !q || ch.name.toLowerCase().includes(q));
  const log = inChannel(c.company, open).slice(-MAX_SHOWN);
  // drawn newest first inside a reversed column, so the page rests at the latest message
  const rows = log.map((m, i) => ({ m, newDay: i === 0 || !sameDay(log[i - 1].at, m.at) })).reverse();
  markSeen(c.company, open);
  if (store.cloud) store.markChatSeen(isDirect(open) ? pairOf(me(), otherOf(open)).join('|') : open);   // v1.37.0: Seen
  const shown = profile && log.find(m => m.id === profile);
  const card = shown && sender(c.company, shown);

  const item = ch => {
        const n = ch.id === open ? 0 : unreadIn(c.company, ch.id, seen);
        const last = inChannel(c.company, ch.id).at(-1);
        return html`
          <li><button type="button" class="chat-ch ${ch.id === open ? 'on' : ''}" data-act="open" data-id="${ch.id}">
            ${ch.direct ? face(ch.who) : html`<span class="avatar small" style="background:${colour(ch.name)}">${ch.id === general() ? '#' : initials(ch.name)}</span>`}
            <span class="chat-ch-text"><b>${ch.name}</b><span class="muted">${last ? `${sender(c.company, last).name}: ${last.deleted ? 'message deleted' : last.text}` : ch.about}</span></span>
            ${n ? html`<em>${n}</em>` : ''}
          </button></li>`;
  };
  const dms = listed.filter(ch => ch.direct);

  return html`
    <aside class="card chat-side">
      <input class="search" type="search" data-chg="search" data-fk="chat-q" value="${filter}" placeholder="Search channels and people" aria-label="Search channels and people">
      <span class="side-label">Channels</span>
      <ul class="list">${listed.filter(ch => !ch.direct).map(item)}</ul>
      <span class="side-label">Direct messages</span>
      ${dms.length ? html`<ul class="list">${dms.map(item)}</ul>` : ''}
      <form data-form="dm" class="chat-new">
        <input name="who" list="chat-people" placeholder="Write to a colleague…" aria-label="Write to a colleague (name or email)" autocomplete="off" required>
        <datalist id="chat-people">${people.map(p => html`<option value="${p.email}">${p.name}</option>`)}</datalist>
        <button class="btn small">Chat</button>
      </form>
      ${listed.length ? '' : html`<p class="muted">No channel or person with that name.</p>`}
    </aside>
    <section class="card chat-main">
      <div class="toolbar"><h2>${current.id === general() ? '# General' : current.name}</h2><span class="muted">${current.direct ? `🔒 Private: only you and ${current.name} see these messages` : current.about}${store.cloud ? '' : '. Demo: messages stay in this browser'}</span></div>
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
              ${own && !m.deleted && store.cloud ? receiptTag(m) : ''}
              ${!m.deleted && left && editing !== m.id ? html`<button type="button" class="btn ghost small" data-act="edit" data-id="${m.id}" title="You can correct it for ${left} more seconds">Edit</button>` : ''}
              ${!m.deleted && (own || (c.admin && !current.direct)) ? html`<button type="button" class="btn ghost small" data-act="unsend" data-id="${m.id}" title="${own && !takeBackLeft(m) ? 'Delete from your view (the others still see it)' : 'Delete this message for everyone'}">Delete</button>` : ''}</span>
            ${m.deleted ? html`<p class="chat-gone">This message was deleted, ${timeLabel(m.deletedAt || m.at)}${sameDay(m.deletedAt || m.at, m.at) ? '' : ` on ${dayLabel(m.deletedAt)}`}</p>`
              : editing === m.id ? html`<form data-form="edit" class="chat-edit"><input name="text" maxlength="${MAX_LENGTH}" value="${m.text}" aria-label="Corrected message" data-fk="chat-edit" required><button class="btn small primary">Save</button><button type="button" class="btn ghost small" data-act="edit" data-id="">Cancel</button></form>`
              : html`<p>${linked(m.text)}</p>`}
          </div>
        </div>
        ${newDay ? html`<div class="chat-day"><span>${dayLabel(m.at)}</span></div>` : ''}`;
      })
        : html`<p class="empty">${current.direct ? `No messages with ${current.name} yet. Write the first one below.` : 'No messages here yet. Write the first one below.'}</p>`}</div>
      <form data-form="send" class="chat-form">
        <input name="text" maxlength="${MAX_LENGTH}" placeholder="Message ${current.id === general() ? 'everyone' : current.name}" aria-label="Message" autocomplete="off" required>
        <button class="btn primary">Send</button>
      </form>
    </section>`;
}

/** v1.37.0 (owner, 9 Nov): Sent / Delivered / Seen under one's own message; in a channel, who (on hover). */
const receiptTag = m => { const t = tagOf(m, store.receipts, me()); return html`<span class="rc rc-${t.k}" title="${t.names}">${tick(t)} ${t.text}</span>`; };

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
    const sec = isDirect(open) ? 'direct' : 'messages';
    const m = (c.company[sec] || []).find(x => x.id === el.dataset.id);
    if (!m || !(m.by === me() || (c.admin && sec === 'messages'))) return;
    if (m.by === me() && !takeBackLeft(m) && !(c.admin && sec === 'messages')) {   // v1.13.1 (owner): after 5 minutes, only from my view
      if (!confirm('Delete this message from your view? After 5 minutes the others still see it.')) return;
      store.updateCompany(co => { Object.assign(co[sec].find(y => y.id === m.id), { hiddenFor: [me()] }); });
      return;
    }
    if (!confirm('Delete this message for everyone?')) return;
    store.updateCompany(co => { const x = co[sec].find(y => y.id === m.id); Object.assign(x, { text: '', deleted: true, deletedAt: new Date().toISOString() }); });
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
    const base = { id: uid('msg'), by: me(), name: myName(), title: store.profile?.title || '', text, at: new Date().toISOString(), sentMs: Date.now() };
    if (isDirect(channel)) store.updateCompany(co => { (co.direct ||= []).push({ ...base, members: pairOf(me(), otherOf(channel)) }); });
    else store.updateCompany(co => { (co.messages ||= []).push({ ...base, channel }); });
  },
  /** v0.65.0: start (or open) a one-to-one chat with a colleague, chosen from the list or by email. */
  dm(fd, c) {
    const typed = String(fd.get('who') || '').trim().toLowerCase();
    const known = colleagues(c.company).find(p => p.email === typed || p.name.toLowerCase() === typed);
    const to = known?.email || typed;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || to === me()) { tell('Choose a colleague from the list, or type their email.'); return false; }
    open = DM + to; editing = null; profile = null; filter = '';
  },
  /** A correction, only within the minute (the database allows a little more, for a slow connection). */
  edit(fd, c) {
    const sec = isDirect(open) ? 'direct' : 'messages';
    const m = (c.company[sec] || []).find(x => x.id === editing);
    const text = String(fd.get('text') || '').trim().slice(0, MAX_LENGTH);
    editing = null;
    if (!m || !text || text === m.text) return;
    if (!editLeft(m)) { tell('Too late: a message can be corrected for 1 minute only. Delete it and write it again.'); return; }
    store.updateCompany(co => { Object.assign(co[sec].find(x => x.id === m.id), { text, edited: true }); });
  },
};

export function onEnter(root) { root.querySelector('.chat-form input')?.focus(); }
