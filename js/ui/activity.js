// v0.99.0 (owner, 7 Nov, Phase G1): Activity record of Central Hub and Field Report, for the Admin and Tier 1.
// Every document generated, printed, shared, emailed, downloaded or sent, with who, position, project and when.

import { store } from '../core/store.js';
import { html } from './dom.js';
import { toCSV, downloadText } from '../core/util.js';
import { ACTIONS, actionWord, filtered, csvRows } from '../engine/activity.js';
import { APPS } from '../engine/signlog.js';

let f = { who: '', app: '', action: '', project: '' }, span = 7;
const when = ms => new Date(+ms + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const TONE = { print: 'info', share: 'ok', email: 'ok', download: '', generate: '', send: 'ok', view: '', save: '' };

export function render() {
  const all = store.activity || [];
  const list = filtered(all, { ...f, from: Date.now() - span * 864e5 });
  const opt = (pairs, v) => pairs.map(([k, l]) => html`<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`);
  const people = [...new Map(all.map(x => [x.email, x.name || x.email])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const projects = [...new Set(all.map(x => x.projectName || x.project).filter(Boolean))].sort();
  return html`
    <div class="toolbar"><h2>Activity record</h2><span class="muted">Documents generated, printed, shared, emailed, downloaded and sent, in Central Hub and Field Report.</span><span class="grow"></span>
      <select data-chg="who" aria-label="Person"><option value="">Everyone</option>${opt(people, f.who)}</select>
      <select data-chg="app" aria-label="App"><option value="">Both apps</option>${opt(Object.entries(APPS), f.app)}</select>
      <select data-chg="action" aria-label="Action"><option value="">Every action</option>${opt(Object.entries(ACTIONS), f.action)}</select>
      <select data-chg="project" aria-label="Project"><option value="">Every project</option>${opt(projects.map(p => [p, p]), f.project)}</select>
      <select data-chg="span" aria-label="Period">${opt([[1, 'Today'], [7, 'Last 7 days'], [31, 'Last 31 days']].map(([v, l]) => [String(v), l]), String(span))}</select>
      <button type="button" class="btn" data-act="csv" ${list.length ? '' : 'disabled'}>Excel</button>
    </div>
    <p class="muted small">Recorded from the apps' own buttons and every print (also from the browser's menu). Screenshots cannot be seen. Times are Addis Ababa time. Kept 12 months.</p>
    <section class="card"><h3>${list.length} ${list.length === 1 ? 'action' : 'actions'}</h3>
      ${list.length ? html`<div class="tscroll"><table class="table compact"><thead><tr><th>When</th><th>Person</th><th>Position</th><th>App</th><th>Project</th><th>Action</th><th>Document</th><th>Number</th><th>Channel</th><th>To</th></tr></thead>
        <tbody>${list.slice(0, 500).map(x => html`<tr><td class="nowrap">${when(x.at)}</td><td>${x.name || x.email}</td><td>${x.position}</td><td>${x.app}</td><td>${x.projectName || x.project}</td>
          <td><span class="tag ${TONE[x.action] || ''}">${actionWord(x.action)}</span></td><td>${x.doc}${x.page && x.page !== x.doc ? html`<br><small class="muted">${x.page}</small>` : ''}</td><td>${x.no}</td><td>${x.channel}</td><td>${x.to}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty">Nothing recorded in this period.</p>`}
    </section>`;
}

export const changes = {
  who(el) { f.who = el.value; }, app(el) { f.app = el.value; }, action(el) { f.action = el.value; }, project(el) { f.project = el.value; },
  span(el) { span = +el.value || 7; },
};

export const actions = {
  csv() { downloadText(`Activity record ${new Date().toISOString().slice(0, 10)}.csv`, toCSV(csvRows(filtered(store.activity || [], { ...f, from: Date.now() - span * 864e5 })))); },
};
