// v0.98.0 (owner, 7 Nov, Phase G2): Sign-in history of Central Hub and Field Report, for the Admin and Tier 1.
// v1.30.0 (owner, 9 Nov: "the page is poorly designed"): rebuilt. Four figures on top, one bar of filters, and tabs
// (Now, People, Per day, Sessions, Refused) so each part is one tap away instead of one long page. Names and positions
// come from the Manpower Directory (engine/onesource.js named), never from what a phone typed.

import { store } from '../core/store.js';
import { html } from './dom.js';
import { perDay, onlineNow, minutesOf, endOf, isOnline, hm, day, APPS } from '../engine/signlog.js';
import { fieldDevices } from '../sync/fieldreport.js';
import { inSession, actionWord } from '../engine/activity.js';   // v0.99.0: what was done in each session
import { named } from '../engine/onesource.js';

export const TABS = [['now', 'Now'], ['people', 'People'], ['days', 'Per day'], ['sessions', 'Sessions'], ['refused', 'Refused']];
let tab = 'now', who = '', app = '', span = 7, find = '', older = null, refused = null, note = '';
const t = ms => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(11, 16) : '');
const dt = ms => (ms ? `${day(ms)} ${t(ms)}` : '');
const low = s => String(s || '').toLowerCase();

/** Project ids (Central Hub) and Field Report codes as names. */
function projName() {
  const list = store.projects || [];
  return k => (list.find(p => p.id === k) || list.find(p => String(p.fieldCode || '').toUpperCase() === String(k).toUpperCase()))?.name || k;
}

/** Each person in the period: sessions, time, apps, last seen, online. */
export function perPerson(list, now) {
  const m = new Map();
  for (const e of list) {
    const r = m.get(e.email) || { email: e.email, name: e.name || e.email, position: e.position || '', sessions: 0, minutes: 0, apps: new Set(), last: 0, online: false, days: new Set() };
    r.sessions++; r.minutes += minutesOf(e, now); r.apps.add(e.app); r.days.add(day(+e.start));
    r.last = Math.max(r.last, endOf(e, now) || now); if (isOnline(e, now)) r.online = true;
    m.set(e.email, r);
  }
  return [...m.values()].map(r => ({ ...r, apps: [...r.apps].sort(), days: r.days.size })).sort((a, b) => b.online - a.online || b.minutes - a.minutes);
}

export function render() {
  const now = Date.now(), staff = store.company?.staff || [];
  const all = named(older || store.signlogs || [], staff);
  const from = now - span * 864e5, q = low(find).trim();
  const hit = e => !q || [e.name, e.email, e.position, e.device, e.place].some(x => low(x).includes(q));
  const list = all.filter(e => +e.start >= from && (!who || e.email === who) && (!app || e.app === app) && hit(e));
  const people = [...new Map(all.map(e => [e.email, e.name || e.email])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const on = onlineNow(all, now).filter(e => !app || e.app === app), today = day(now);
  const todayRows = perDay(all.filter(e => day(+e.start) === today && (!app || e.app === app)), now);
  const pp = perPerson(list, now), total = list.reduce((s, e) => s + minutesOf(e, now), 0);
  const tabs = TABS.filter(([k]) => k !== 'refused' || store.isAdmin);
  const cur = tabs.some(([k]) => k === tab) ? tab : 'now';
  const card = (tone, label, value, hint, to) => html`<button type="button" class="xkpi" style="--c:${tone};text-align:left;font:inherit;color:inherit;cursor:pointer" data-act="shTab" data-v="${to}"><span class="lab">${label}</span><b>${value}</b><small>${hint}</small></button>`;
  const spanWord = { 1: 'today', 7: 'last 7 days', 31: 'last 31 days', 365: 'last 12 months' }[span];
  const body = {
    now: () => html`
      <section class="card"><h3>Online now · ${on.length}</h3>
        ${on.length ? html`<ul class="xlist">${on.map(e => html`<li><span class="tag ok">${e.app}</span><span class="xt"><b>${e.name || e.email}</b> <small>${e.position || ''}</small><br><small>since ${t(+e.start)} · ${hm(minutesOf(e, now))} · ${e.device || ''}${e.place ? ` · ${e.place}` : ''}</small></span></li>`)}</ul>` : html`<p class="empty">Nobody is online right now.</p>`}
      </section>
      <section class="card"><h3>Today · ${todayRows.length} ${todayRows.length === 1 ? 'person' : 'people'} signed in</h3>
        ${todayRows.length ? table(['Person', 'Position', 'Projects', 'Apps', 'First', 'Last seen', 'Sessions', 'Time'], todayRows.map(r => [pick(r), r.position, r.projects.map(projName()).join(', '), r.apps.join(' + '), t(r.first), r.online ? 'now' : t(r.last), r.sessions, html`<b>${hm(r.minutes)}</b>`])) : html`<p class="empty">No sign-in today yet.</p>`}
      </section>`,
    people: () => html`<section class="card"><h3>People · ${spanWord}</h3>
      ${pp.length ? html`<div class="sh-people">${pp.map(r => html`<button type="button" class="sh-person ${r.email === who ? 'on' : ''}" data-act="pick" data-e="${r.email}">
          <span><b>${r.name}</b>${r.online ? html` <span class="tag ok">online</span>` : ''}</span><small>${r.position || 'No position'} · ${r.apps.join(' + ')}</small>
          <span><b>${hm(r.minutes)}</b> <small>· ${r.sessions} session${r.sessions === 1 ? '' : 's'} · ${r.days} day${r.days === 1 ? '' : 's'}</small></span><small>Last seen ${r.online ? 'now' : dt(r.last)}</small></button>`)}</div>` : html`<p class="empty">No sign-in in this period.</p>`}
      <p class="muted small">Tap a person to see only them on the other tabs; tap again for everyone.</p></section>`,
    days: () => { const days = perDay(list, now); return html`<section class="card"><h3>Time per day${who ? ` · ${people.find(([e]) => e === who)?.[1] || who}` : ''}</h3>
      ${days.length ? table(['Day', 'Person', 'Position', 'Projects', 'Apps', 'Sessions', 'Time'], days.map(r => [r.day, pick(r), r.position, r.projects.map(projName()).join(', '), r.apps.join(' + '), r.sessions, html`<b>${hm(r.minutes)}</b>`])) : html`<p class="empty">No sign-in in this period.</p>`}</section>`; },
    sessions: () => { const ss = [...list].sort((a, b) => +b.start - +a.start).slice(0, 300); return html`<section class="card"><h3>Sessions · ${ss.length}${list.length > 300 ? ' (latest 300)' : ''}</h3>
      ${ss.length ? table(['Signed in', 'Person', 'App', 'Device', 'Place', 'Ended', 'How', 'Time', 'Did'], ss.map(e => [dt(+e.start), html`${e.name || e.email}${e.typed ? html`<br><span class="sh-typed" title="Typed on the phone">typed: ${e.typed}</span>` : ''}`, e.app, `${e.device || ''}${e.mode ? ` (${e.mode === 'app' ? 'installed' : 'browser'})` : ''}`, e.place || '', isOnline(e, now) ? html`<span class="tag ok">online</span>` : t(endOf(e, now)), e.how === 'signout' ? 'Signed out' : isOnline(e, now) ? '' : 'Closed', hm(minutesOf(e, now)), didOf(e, now)])) : html`<p class="empty">No session in this period.</p>`}</section>`; },
    refused: () => html`<section class="card"><h3>Refused sign-ins (Field Report)</h3>
      ${refused === null ? html`<button type="button" class="btn small" data-act="refused">Show the refused sign-ins</button>`
        : refused.length ? table(['When', 'Person', 'Why', 'Device', 'Times'], refused.map(r => [String(r.at).slice(0, 16).replace('T', ' '), r.name || r.email, r.text || r.why, `${r.ua || ''}${r.mode ? ` (${r.mode})` : ''}`, r.n])) : html`<p class="empty">No refused sign-in.</p>`}</section>`,
  };
  return html`
    <div class="toolbar"><h2>Sign-in history</h2><span class="muted">Central Hub and Field Report · Addis Ababa time · kept 12 months. ${note}</span></div>
    <div class="sh-cards">
      ${card('#16a34a', 'Online now', on.length, on.length ? on.slice(0, 3).map(e => e.name || e.email).join(', ') : 'nobody', 'now')}
      ${card('#2563eb', 'Signed in today', todayRows.length, `${todayRows.reduce((s, r) => s + r.sessions, 0)} sessions`, 'now')}
      ${card('#7c3aed', 'People', pp.length, spanWord, 'people')}
      ${card('#d97706', 'Time in the apps', hm(total), `${list.length} sessions · ${spanWord}`, 'sessions')}
    </div>
    <div class="sh-bar"><div class="seg" role="tablist">${tabs.map(([k, l]) => html`<button type="button" role="tab" class="${k === cur ? 'on' : ''}" aria-selected="${k === cur}" data-act="shTab" data-v="${k}">${l}</button>`)}</div></div>
    <div class="sh-bar">
      <div class="seg">${[['', 'Both apps'], ...Object.entries(APPS)].map(([k, l]) => html`<button type="button" class="${k === app ? 'on' : ''}" data-act="shApp" data-v="${k}">${l}</button>`)}</div>
      <select data-chg="span" aria-label="Period">${[[1, 'Today'], [7, 'Last 7 days'], [31, 'Last 31 days'], [365, 'Last 12 months']].map(([v, l]) => html`<option value="${v}" ${v === span ? 'selected' : ''}>${l}</option>`)}</select>
      <select data-chg="who" aria-label="Person"><option value="">Everyone</option>${people.map(([e, n]) => html`<option value="${e}" ${e === who ? 'selected' : ''}>${n}</option>`)}</select>
      <input type="search" data-chg="find" value="${find}" placeholder="Search name, device, place" aria-label="Search">
      ${span === 365 && !older ? html`<button type="button" class="btn small" data-act="older">Load the last 12 months</button>` : ''}
    </div>
    ${body[cur]()}`;
}

const pick = r => html`<button type="button" class="linkish" data-act="pick" data-e="${r.email}">${r.name}</button>${r.online ? html` <span class="tag ok">online</span>` : ''}`;
/** v0.99.0 (G1): the documents handled in a session (Activity record), as a count with the list in the tip. */
const didOf = (e, now) => { const l = inSession(store.activity, e, endOf(e, now) || now); return l.length ? html`<span title="${l.map(x => `${actionWord(x.action)}: ${x.doc}`).join('\n')}">${l.length} ${l.length === 1 ? 'action' : 'actions'}</span>` : ''; };
const table = (head, rows) => html`<div class="tscroll"><table class="table compact"><thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows.map(r => html`<tr>${r.map(x => html`<td>${x}</td>`)}</tr>`)}</tbody></table></div>`;

export const changes = {
  who(el) { who = el.value; },
  span(el) { span = +el.value || 7; if (span < 365) older = null; },
  find(el) { find = el.value; },
};

export const actions = {
  shTab(el) { tab = el.dataset.v || 'now'; },
  shApp(el) { app = el.dataset.v || ''; },
  pick(el) { who = el.dataset.e === who ? '' : el.dataset.e; },
  async older() {
    note = 'Loading…'; store.notify();
    try { older = await store.signlogsSince(Date.now() - 365 * 864e5); note = ''; } catch (e) { note = `Not loaded: ${e.message}`; }
    store.notify();
  },
  async refused() {
    note = 'Asking Field Report…'; store.notify();
    try { refused = (await fieldDevices()).refused; note = ''; } catch (e) { refused = null; note = `Not loaded: ${e.message}`; }
    store.notify();
  },
};
