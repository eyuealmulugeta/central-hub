// v0.98.0 (owner, 7 Nov, Phase G2): Sign-in history of Central Hub and Field Report, for the Admin and Tier 1.
// Online now, each person's time per day (name, position, projects), every session, and Field Report's refused sign-ins.

import { store } from '../core/store.js';
import { html } from './dom.js';
import { perDay, onlineNow, minutesOf, endOf, isOnline, hm, day, APPS } from '../engine/signlog.js';
import { fieldDevices } from '../sync/fieldreport.js';
import { inSession, actionWord } from '../engine/activity.js';   // v0.99.0: what was done in each session

let who = '', app = '', span = 7, older = null, refused = null, note = '';
const t = ms => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(11, 16) : '');
const dt = ms => (ms ? `${day(ms)} ${t(ms)}` : '');

/** Project ids (Central Hub) and Field Report codes as names. */
function projName(c) {
  const list = store.projects || [];
  return k => (list.find(p => p.id === k) || list.find(p => String(p.fieldCode || '').toUpperCase() === String(k).toUpperCase()))?.name || k;
}

export function render(c) {
  const now = Date.now();
  const all = older || store.signlogs || [];
  const from = now - span * 864e5;
  const list = all.filter(e => +e.start >= from && (!who || e.email === who) && (!app || e.app === app));
  const people = [...new Map(all.map(e => [e.email, e.name || e.email])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const on = onlineNow(all, now), today = day(now);
  const days = perDay(list, now), pn = projName(c);
  const todayRows = perDay(all.filter(e => day(+e.start) === today), now);
  const sessions = [...list].sort((a, b) => +b.start - +a.start).slice(0, 300);
  return html`
    <div class="toolbar"><h2>Sign-in history</h2><span class="muted">Central Hub and Field Report. ${note}</span><span class="grow"></span>
      <select data-chg="who" aria-label="Person"><option value="">Everyone</option>${people.map(([e, n]) => html`<option value="${e}" ${e === who ? 'selected' : ''}>${n}</option>`)}</select>
      <select data-chg="app" aria-label="App"><option value="">Both apps</option>${Object.entries(APPS).map(([k, v]) => html`<option value="${k}" ${k === app ? 'selected' : ''}>${v}</option>`)}</select>
      <select data-chg="span" aria-label="Period">${[[1, 'Today'], [7, 'Last 7 days'], [31, 'Last 31 days'], [365, 'Last 12 months']].map(([v, l]) => html`<option value="${v}" ${v === span ? 'selected' : ''}>${l}</option>`)}</select>
    </div>
    <p class="muted small">Each session is recorded while the app is open and in front (every minute). It ends when the person signs out, or at the last minute it was seen. Times are Addis Ababa time. Kept 12 months.</p>
    <section class="card"><h3>Online now · ${on.length}</h3>
      ${on.length ? html`<ul class="xlist">${on.map(e => html`<li><span class="tag ok">${e.app}</span><span class="xt"><b>${e.name || e.email}</b> <small>${e.position || ''}</small><br><small>since ${t(+e.start)} · ${hm(minutesOf(e, now))} · ${e.device || ''}${e.place ? ` · ${e.place}` : ''}</small></span></li>`)}</ul>` : html`<p class="empty">Nobody is online right now.</p>`}
    </section>
    <section class="card"><h3>Today · ${todayRows.length} ${todayRows.length === 1 ? 'person' : 'people'} signed in</h3>
      ${todayRows.length ? table(['Person', 'Position', 'Projects', 'Apps', 'First', 'Last seen', 'Sessions', 'Time'], todayRows.map(r => [html`<button type="button" class="linkish" data-act="pick" data-e="${r.email}">${r.name}</button>${r.online ? html` <span class="tag ok">online</span>` : ''}`, r.position, r.projects.map(pn).join(', '), r.apps.join(' + '), t(r.first), r.online ? 'now' : t(r.last), r.sessions, html`<b>${hm(r.minutes)}</b>`])) : html`<p class="empty">No sign-in today yet.</p>`}
    </section>
    <section class="card"><h3>Time per day${who ? ` · ${people.find(([e]) => e === who)?.[1] || who}` : ''}</h3>
      ${days.length ? table(['Day', 'Person', 'Position', 'Projects', 'Apps', 'Sessions', 'Time'], days.map(r => [r.day, html`<button type="button" class="linkish" data-act="pick" data-e="${r.email}">${r.name}</button>`, r.position, r.projects.map(pn).join(', '), r.apps.join(' + '), r.sessions, html`<b>${hm(r.minutes)}</b>`])) : html`<p class="empty">No sign-in in this period.</p>`}
      ${span === 365 && !older ? html`<button type="button" class="btn small" data-act="older">Load the last 12 months</button>` : ''}
    </section>
    <section class="card"><h3>Sessions · ${sessions.length}</h3>
      ${sessions.length ? table(['Signed in', 'Person', 'App', 'Device', 'Place', 'Ended', 'How', 'Time', 'Did'], sessions.map(e => [dt(+e.start), e.name || e.email, e.app, `${e.device || ''}${e.mode ? ` (${e.mode === 'app' ? 'installed' : 'browser'})` : ''}`, e.place || '', isOnline(e, now) ? html`<span class="tag ok">online</span>` : t(endOf(e, now)), e.how === 'signout' ? 'Signed out' : isOnline(e, now) ? '' : 'Closed', hm(minutesOf(e, now)), didOf(e, now)])) : html`<p class="empty">No session in this period.</p>`}
    </section>
    ${store.isAdmin ? html`<section class="card"><h3>Refused sign-ins (Field Report)</h3>
      ${refused === null ? html`<button type="button" class="btn small" data-act="refused">Show the refused sign-ins</button>`
        : refused.length ? table(['When', 'Person', 'Why', 'Device', 'Times'], refused.map(r => [String(r.at).slice(0, 16).replace('T', ' '), r.name || r.email, r.text || r.why, `${r.ua || ''}${r.mode ? ` (${r.mode})` : ''}`, r.n])) : html`<p class="empty">No refused sign-in.</p>`}
    </section>` : ''}`;
}

/** v0.99.0 (G1): the documents handled in a session (Activity record), as a count with the list in the tip. */
const didOf = (e, now) => { const l = inSession(store.activity, e, endOf(e, now) || now); return l.length ? html`<span title="${l.map(x => `${actionWord(x.action)}: ${x.doc}`).join('
')}">${l.length} ${l.length === 1 ? 'action' : 'actions'}</span>` : ''; };
const table = (head, rows) => html`<div class="tscroll"><table class="table compact"><thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows.map(r => html`<tr>${r.map(x => html`<td>${x}</td>`)}</tr>`)}</tbody></table></div>`;

export const changes = {
  who(el) { who = el.value; },
  app(el) { app = el.value; },
  span(el) { span = +el.value || 7; if (span < 365) older = null; },
};

export const actions = {
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
