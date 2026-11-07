// v1.7.0 (owner, 7 Nov, G3): Dashboard > Engagement, for the Admin and the GM only. Who is online now, active minutes
// per person (today, this week, this month), days used, last opened, nobody for 3 work days in red, per position, Excel.

import { store } from '../core/store.js';
import { html, chip } from './dom.js';
import { toCSV, downloadText, todayISO } from '../core/util.js';
import { onlineNow, hm, APPS } from '../engine/signlog.js';
import { rows, isQuiet, byPosition, csvRows, mayView, QUIET_DAYS } from '../engine/engagement.js';

let app = '';
const people = () => (store.users || []).filter(u => u.email && u.role !== 'disabled').map(u => ({ email: u.email, name: u.name || '', position: u.title || (u.ranks || [])[0] || '' }));
const when = ms => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : 'Never');

function data() {
  const now = Date.now(), list = (store.signlogs || []).filter(e => !app || e.app === app);
  return { now, list, rs: rows(list, now, { people: app === 'FR' ? [] : people() }) };
}

export function render() {
  if (!mayView(store.role, store.ranks)) return html`<section class="card"><p class="empty">Only the Admin and the GM see this page.</p></section>`;
  const { now, list, rs } = data(), on = onlineNow(list, now), quiet = rs.filter(isQuiet), pos = byPosition(list, now);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Engagement</h2><span class="muted">Active minutes: time in the app with a tap, typing or scrolling in the last 5 minutes. Seen by the Admin and the GM only.</span><span class="grow"></span>
      <button type="button" class="btn ${!app ? 'primary' : ''}" data-act="egApp" data-v="">Both apps</button>
      ${Object.entries(APPS).map(([k, l]) => html`<button type="button" class="btn ${app === k ? 'primary' : ''}" data-act="egApp" data-v="${k}">${l}</button>`)}
      <button type="button" class="btn" data-act="egCsv">Excel</button></div>
    <div class="actions left">${chip(`Online now: ${on.length}`, on.length ? 'ok' : '')} ${on.map(e => html`${chip(`${e.name || e.email} · ${e.app}${e.position ? ` · ${e.position}` : ''}`, 'ok')} `)}</div>
    ${quiet.length ? html`<p class="small bad">Not opened for ${QUIET_DAYS} work days or more: ${quiet.map(r => r.name).join(', ')}.</p>` : ''}
    <div class="table-wrap"><table class="table compact"><thead><tr><th>Name</th><th>Position</th><th>Apps</th><th class="num">Today</th><th class="num">This week</th><th class="num">This month</th><th class="num">Days used</th><th>Last opened</th></tr></thead>
      <tbody>${rs.map(r => html`<tr class="${isQuiet(r) ? 'bad' : ''}"><td><b>${r.name}</b>${r.online ? html` ${chip('online', 'ok')}` : ''}</td><td>${r.position}</td><td>${r.apps.join(' + ')}</td>
        <td class="num">${hm(r.today)}</td><td class="num">${hm(r.week)}</td><td class="num">${hm(r.month)}</td><td class="num">${r.daysUsed} / ${r.workDays}</td>
        <td class="nowrap">${when(r.last)}${r.quietDays ? html` <span class="${isQuiet(r) ? 'bad' : 'muted'} small">(${r.quietDays} work day${r.quietDays === 1 ? '' : 's'})</span>` : ''}</td></tr>`)}</tbody></table></div>
    ${pos.length ? html`<h3>This week by position</h3><div class="table-wrap"><table class="table compact"><thead><tr><th>Position</th><th>App</th><th class="num">People</th><th class="num">Average active</th></tr></thead>
      <tbody>${pos.map(g => html`<tr><td>${g.position}</td><td>${APPS[g.app] || g.app}</td><td class="num">${g.people}</td><td class="num">${hm(g.avg)}</td></tr>`)}</tbody></table></div>` : ''}
    <p class="muted small">Sessions before v1.7.0 count their whole open time. The last 31 days are kept here; Sign-in history has every session.</p>
  </section>`;
}

export const actions = {
  egApp(el) { app = el.dataset.v || ''; },
  egCsv() { if (mayView(store.role, store.ranks)) downloadText(`Engagement ${todayISO()}.csv`, toCSV(csvRows(data().rs))); },
};
