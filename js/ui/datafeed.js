// v1.2.0 (owner, 7 Nov, G5): Dashboard, Data tracker. The server's summary (functions/datafeed.js, 07:00 and 18:00):
// a project x item grid in green, amber and red, each project's score and its last four weeks, each person's on-time %,
// and an Excel file. The Admin and Tier 1 see every project, the others the projects they are on.

import { store } from '../core/store.js';
import { html, chip } from './dom.js';
import { toCSV, downloadText, fmtFull } from '../core/util.js';
import { seesSignins } from '../engine/signlog.js';
import { ITEMS, EVERY, COLOUR, TONE, WHO, rowsFor, personScores, myOverdue, csvRows } from '../engine/datafeed.js';

let f = { q: '', only: '' }, busy = false, note = '';
const all = () => seesSignins(store.role, store.ranks);
const mine = () => rowsFor(store.datafeed, { all: all(), projects: (store.projects || []).map(p => p.id), email: store.user?.email });
const pct = n => (n == null ? '–' : `${n}%`);
const tone = n => (n == null ? '' : n >= 80 ? 'ok' : n >= 50 ? 'warn' : 'bad');

/** Home: management sees the projects behind; each person their own overdue items. */
export function homeBox() {
  const sum = store.datafeed;
  if (!sum) return '';
  if (all()) {
    const behind = (sum.projects || []).filter(p => p.score != null && p.score < 80);
    return behind.length ? html`<section class="card xact"><h3>Projects behind on data · ${behind.length} <a class="xlink2" href="#datafeed">Data tracker</a></h3><ul class="xlist">${behind.slice(0, 6).map(p => html`<li>${chip(pct(p.score), tone(p.score))}<span class="xt"><b>${p.name}</b><br><small>${p.items.filter(i => i.status === 'red').map(i => ITEMS.find(x => x.key === i.key).label).join(', ') || 'Some items 1 day late'}</small></span></li>`)}</ul></section>` : '';
  }
  const mineList = myOverdue(sum, store.user?.email);
  return mineList.length ? html`<section class="card xact"><h3>Your overdue items · ${mineList.length} <a class="xlink2" href="#datafeed">Data tracker</a></h3><ul class="xlist">${mineList.slice(0, 6).map(i => html`<li>${chip(COLOUR[i.status], TONE[i.status])}<span class="xt"><b>${i.label}</b><br><small>${i.project}${i.last ? ` · last ${fmtFull(i.last)}` : ''}</small></span></li>`)}</ul></section>` : '';
}

const cell = i => html`<td class="df-c ${TONE[i.status] || 'none'}" title="${[COLOUR[i.status], i.late > 1 ? `${i.late} working days` : '', i.last ? `last ${i.last}` : '', i.note, (i.who || []).map(w => w.name).join(', ')].filter(Boolean).join(' · ')}">${i.status === 'paused' ? '–' : i.status === 'grey' ? '·' : i.late > 0 ? i.late : '✓'}</td>`;

export function render() {
  const sum = store.datafeed;
  let rows = mine();
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(q)); }
  if (f.only === 'behind') rows = rows.filter(p => p.items.some(i => i.status === 'red' || i.status === 'amber'));
  const people = personScores({ projects: rows });
  return html`<section class="card wide">
    <div class="toolbar"><h2>Data tracker</h2><span class="muted">How up to date each project's data is kept. Green on time, amber 1 day late, red 2 days or more. Sundays, holidays and each project's days off are not counted; a project on hold is paused.</span><span class="grow"></span>
      ${all() ? html`<button type="button" class="btn" data-act="dfNow" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check now'}</button>` : ''}
      <button type="button" class="btn" data-act="dfCsv" ${rows.length ? '' : 'disabled'}>Excel</button></div>
    <div class="actions left">
      <input data-chg="dfF" data-k="q" value="${f.q}" placeholder="Project" aria-label="Find project">
      <select data-chg="dfF" data-k="only" aria-label="Show"><option value="">All projects</option><option value="behind" ${f.only === 'behind' ? 'selected' : ''}>Behind only</option></select>
      <span class="muted">${sum ? `Checked ${new Date(sum.at).toLocaleString()} · checked again at 07:00 and 18:00` : 'Not checked yet: the server checks at 07:00 and 18:00.'}${note ? ` · ${note}` : ''}</span>
    </div>
    ${rows.length ? html`<div class="table-wrap"><table class="table compact df-grid">
      <thead><tr><th>Project</th><th>Score</th>${ITEMS.map(i => html`<th title="${EVERY[i.every]} · ${WHO[i.who].label}">${i.label}<br><small class="muted">${EVERY[i.every]}</small></th>`)}<th>Last 4 weeks</th></tr></thead>
      <tbody>${rows.map(p => html`<tr><td><b>${p.name}</b>${p.code ? html` <small class="muted">${p.code}</small>` : ''}${p.paused ? html`<br><small class="muted">Paused</small>` : ''}</td>
        <td>${chip(pct(p.score), tone(p.score))}</td>${p.items.map(cell)}
        <td class="nowrap">${p.trend.map(w => html`<span class="df-w ${tone(w.score)}" title="Week of ${w.week}">${pct(w.score)}</span>`)}</td></tr>`)}</tbody></table></div>
      <p class="muted">A number is the working days late. Hold or tap a cell to see the last date and who answers for it: daily items the Site Engineer, weekly items and planning the Project Engineer or Coordinator, money the Accountant.</p>
      ${people.length ? html`<h3>On time, by person</h3><div class="table-wrap"><table class="table compact"><thead><tr><th>Person</th><th>On time</th><th>Items</th><th>Red</th></tr></thead>
        <tbody>${people.map(e => html`<tr><td>${e.name || e.email}</td><td>${chip(pct(e.score), tone(e.score))}</td><td>${e.items}</td><td>${e.red}</td></tr>`)}</tbody></table></div>` : ''}`
    : html`<p class="empty">${sum ? 'No projects to show.' : 'The first check has not run yet.'}</p>`}
  </section>`;
}

export const actions = {
  dfCsv() { downloadText(`Data tracker ${new Date().toISOString().slice(0, 10)}.csv`, toCSV(csvRows(mine()))); },
  async dfNow() {
    if (busy) return;
    busy = true; store.notify();
    note = '';
    try { await store.callServer('dataFeedNow', {}); note = 'Checked just now.'; }
    catch (e) { note = String(e?.message || e); }
    finally { busy = false; store.notify(); }
  },
};
export const changes = { dfF(el) { f = { ...f, [el.dataset.k]: el.value }; } };
