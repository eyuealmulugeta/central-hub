// Discuss: short messages between the people of Amistad. One channel for the
// whole company and one per project. Messages are company-wide records, one
// document each, so they appear on everyone's screen as they are sent.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { html } from './dom.js';
import { currentDivision, TRADING } from '../core/division.js';

// Installation and Trading each have their own General channel (and only Installation has the project channels),
// so the two never share a conversation. The older 'general' channel is the Installation one.
const general = () => (currentDivision() === TRADING ? 'general-trading' : 'general');
const SEEN_KEY = 'sf:chat:seen';
const MAX_SHOWN = 300;      // the newest messages of a channel; older ones stay in the database
const MAX_LENGTH = 2000;
const COLOURS = ['#0a3440', '#b47d14', '#3b6e4f', '#6a4c93', '#a23e48', '#2f6690'];

let open = null;
let filter = '';

const me = () => store.user?.email || 'me';
const myName = () => store.profile?.name || store.user?.name || 'Me';
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
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
            <span class="chat-ch-text"><b>${ch.name}</b><span class="muted">${last ? `${last.name}: ${last.text}` : ch.about}</span></span>
            ${n ? html`<em>${n}</em>` : ''}
          </button></li>`;
      })}</ul>
      ${listed.length ? '' : html`<p class="muted">No channel with that name.</p>`}
    </aside>
    <section class="card chat-main">
      <div class="toolbar"><h2>${current.id === general() ? '# General' : current.name}</h2><span class="muted">${current.about}${store.cloud ? '' : '. Demo: messages stay in this browser'}</span></div>
      <div class="chat-log">${rows.length ? rows.map(({ m, newDay }) => html`
        <div class="chat-msg ${m.by === me() ? 'mine' : ''}">
          <span class="avatar small" style="background:${colour(m.by)}">${initials(m.name)}</span>
          <div class="chat-body">
            <span class="chat-meta"><b>${m.name}</b><span class="muted">${timeLabel(m.at)}</span>
              <button type="button" class="btn ghost small" data-act="removeMessage" data-id="${m.id}" title="Delete this message">Delete</button></span>
            <p>${m.text}</p>
          </div>
        </div>
        ${newDay ? html`<div class="chat-day"><span>${dayLabel(m.at)}</span></div>` : ''}`)
        : html`<p class="empty">No messages here yet. Write the first one below.</p>`}</div>
      <form data-form="send" class="chat-form">
        <input name="text" maxlength="${MAX_LENGTH}" placeholder="Message ${current.id === general() ? 'everyone' : current.name}" aria-label="Message" autocomplete="off" required>
        <button class="btn primary">Send</button>
      </form>
    </section>`;
}

export const actions = {
  open(el) { open = el.dataset.id; },
  removeMessage(el) {
    if (confirm('Delete this message for everyone?')) store.updateCompany(co => { co.messages = co.messages.filter(m => m.id !== el.dataset.id); });
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
    store.updateCompany(co => { (co.messages ||= []).push({ id: uid('msg'), channel, by: me(), name: myName(), text, at: new Date().toISOString() }); });
  },
};

export function onEnter(root) { root.querySelector('.chat-form input')?.focus(); }
