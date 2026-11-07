// v1.8.0 (owner, 7 Nov; with Field Report 2.66.0): Reports > Work photos. Technicians share photos of the work they executed on
// Field Report; the Site Engineer or PM approves or rejects them with a reason. Here: per technician what was sent, approved and
// rejected and why; phones with 3 rejected in 7 days (the Admin blocks them in Field Report users); the photos; Excel.

import { store } from '../core/store.js';
import { html, chip } from './dom.js';
import { toCSV, downloadText } from '../core/util.js';
import { techStats, badDevices, sortShots, reasonWord, SHOT_WORD, SHOT_TONE, BAD_COUNT, BAD_DAYS } from '../fr/model/shots.js';

let show = 'waiting';   // waiting | all
const TONE = { ok: 'ok', warn: 'warn', bad: 'high' };
const reasons = r => Object.entries(r.reasons || {}).map(([k, v]) => `${reasonWord(k)} ${v}`).join(', ');

export function csvRows(list) {
  return [['Date', 'Technician', 'Task', 'Note', 'Status', 'Reason', 'Decided by', 'Phone'],
    ...sortShots(list).map(x => [String(x.at || '').slice(0, 16).replace('T', ' '), x.byName || x.by, x.taskName || '', x.note || '', SHOT_WORD[x.status] || x.status, x.status === 'rejected' ? reasonWord(x.reason) : '', x.decidedByName || '', x.dev || ''])];
}

export function render(c) {
  const ws = c.ws || store.ws, all = ws.workShots || [], stats = techStats(all), bad = badDevices(all, c.now || Date.now());
  const list = sortShots(all).filter(x => show === 'all' || x.status === 'waiting').slice(0, 60);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Work photos</h2><span class="muted">Shared by technicians on Field Report; the Site Engineer or PM approves or rejects them.</span><span class="grow"></span>
      <button type="button" class="btn" data-act="wpCsv">Excel</button></div>
    ${bad.length ? html`<div class="callout warn"><b>Phones with ${BAD_COUNT} or more rejected photos in ${BAD_DAYS} days</b>
      <ul>${bad.map(d => html`<li>${d.byName} · phone ${d.dev} · ${d.count} rejected</li>`)}</ul>
      <p class="small">The Admin may block the phone: Field Report and import, Field Report users, Block.</p></div>` : ''}
    <div class="table-wrap"><table class="table compact"><thead><tr><th>Technician</th><th class="num">Sent</th><th class="num">Approved</th><th class="num">Rejected</th><th class="num">Waiting</th><th>Why rejected</th></tr></thead>
      <tbody>${stats.length ? stats.map(r => html`<tr><td>${r.byName}</td><td class="num">${r.sent}</td><td class="num">${r.approved}</td><td class="num">${r.rejected ? chip(String(r.rejected), 'high') : 0}</td><td class="num">${r.waiting}</td><td>${reasons(r)}</td></tr>`)
        : html`<tr><td colspan="6" class="muted">No work photos yet. Give a technician a Field Report account (role Technician) on this project.</td></tr>`}</tbody></table></div>
    <div class="actions left"><button type="button" class="btn ${show === 'waiting' ? 'primary' : ''}" data-act="wpShow" data-v="waiting">Waiting</button><button type="button" class="btn ${show === 'all' ? 'primary' : ''}" data-act="wpShow" data-v="all">All</button></div>
    ${list.length ? list.map(x => html`<div class="box pad"><b>${x.byName}</b> ${chip(SHOT_WORD[x.status] || x.status, TONE[SHOT_TONE[x.status]] || '')}
      <span class="muted small">${String(x.at || '').slice(0, 16).replace('T', ' ')} · ${x.taskName || 'No task'}${x.status === 'rejected' ? ` · ${reasonWord(x.reason)}` : ''}${x.decidedByName ? ` · by ${x.decidedByName}` : ''}</span>
      <p>${x.note || ''}</p><div class="actions left">${(x.photos || []).map((u, i) => html`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Photo ${i + 1}" style="width:120px;height:120px;object-fit:cover;border-radius:8px"></a>`)}</div></div>`)
      : html`<p class="muted">${show === 'waiting' ? 'Nothing waiting.' : 'No work photos yet.'}</p>`}
  </section>`;
}

export const actions = {
  wpShow(el) { show = el.dataset.v || 'waiting'; },
  wpCsv(el, c) { downloadText(`Work photos ${store.project?.name || ''}.csv`, toCSV(csvRows((c?.ws || store.ws).workShots || []))); },
};
