// v1.5.0 (owner, 7 Nov, FR R7): Reports > Materials used. Per schedule task and material: issued from the site store
// (Field Report, approved), what the work done should have used, the difference in % and money (latest PO price), Excel.
// The PM or office sets how much each task's work should use. See engine/usage.js.

import { store } from '../core/store.js';
import { html, chip, options } from './dom.js';
import { toCSV, downloadText, todayISO, money } from '../core/util.js';
import { UNITS } from '../fr/model/store.js';
import { usageRows, cleanUsage, FLAG_WORD, FLAG_TONE, csvRows } from '../engine/usage.js';

let editing = '';     // the task whose usage is being set
let show = 'flagged'; // flagged | all
const n = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const cur = () => (store.project?.currency === 'USD' ? 'USD' : 'ETB');

function data(c) {
  const ws = c.ws || store.ws;
  return { ws, ...usageRows({ tasks: ws.tasks || [], reports: ws.reports || [], moves: ws.storeMoves || [], docs: ws.docs || [] }) };
}

function editor(ws) {
  const t = (ws.tasks || []).find(x => x.id === editing);
  if (!t) return '';
  const lines = [...cleanUsage(t.usage), { item: '', unit: '', per: '' }, { item: '', unit: '', per: '' }];
  const per = (+t.totalQty || 0) > 0 ? `per ${t.unit || 'unit'} of work` : 'for the whole task';
  return html`<form data-form="useSave" class="box pad">
    <b>${t.name}</b> <span class="muted">· how much material ${per}${(+t.totalQty || 0) > 0 ? ` (task: ${n(t.totalQty)} ${t.unit || ''})` : ''}</span>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>Material (as named in the store)</th><th>Unit</th><th class="num">Amount ${per}</th></tr></thead>
      <tbody>${lines.map((u, i) => html`<tr><td><input name="item${i}" value="${u.item}" list="useItems" placeholder="e.g. Cement 50 kg"></td>
        <td><select name="unit${i}"><option value="">Unit…</option>${options([...new Set([...UNITS, u.unit].filter(Boolean))].map(x => [x, x]), u.unit)}</select></td>
        <td class="num"><input name="per${i}" type="number" min="0" step="any" value="${u.per}"></td></tr>`)}</tbody></table></div>
    <datalist id="useItems">${[...new Set((ws.storeMoves || []).filter(m => m.item && m.kind !== 'count').map(m => m.item))].map(i => html`<option value="${i}">`)}</datalist>
    <div class="actions left"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-act="useEdit" data-v="">Close</button>
      <span class="muted small">Leave the amount empty to take a line off. Save again for more lines.</span></div>
  </form>`;
}

export function render(c) {
  const { ws, rows, unlinked } = data(c);
  const tasks = ws.tasks || [], set = tasks.filter(t => cleanUsage(t.usage).length).length;
  const shown = show === 'all' ? rows : rows.filter(r => r.flag && r.flag !== '');
  const over = rows.filter(r => r.flag === 'over'), lost = over.reduce((s, r) => s + (r.value || 0), 0);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Materials used</h2><span class="muted">Issued from the site store (approved) against what the work done should have used. Over 10% more = overuse; over 10% less = work not reported or material left on site.</span><span class="grow"></span>
      <button type="button" class="btn" data-act="useCsv" ${rows.length ? '' : 'disabled'}>Excel</button></div>
    <div class="actions left">
      ${chip(`Usage set for ${set} of ${tasks.length} tasks`, set ? '' : 'warn')}
      ${over.length ? chip(`${over.length} overuse${lost ? `, ${money(lost, cur())}` : ''}`, 'bad') : chip('No overuse', 'ok')}
      ${unlinked.count ? chip(`${unlinked.count} issue${unlinked.count === 1 ? '' : 's'} not linked to a task`, 'warn') : ''}
      <select data-chg="useTask" aria-label="Set the usage of a task"><option value="">Set usage for a task…</option>${options(tasks.map(t => [t.id, `${t.name}${cleanUsage(t.usage).length ? ' ✓' : ''}`]), editing)}</select>
      <button type="button" class="btn ${show === 'flagged' ? 'primary' : ''}" data-act="useShow" data-v="flagged">To look at</button>
      <button type="button" class="btn ${show === 'all' ? 'primary' : ''}" data-act="useShow" data-v="all">All · ${rows.length}</button>
    </div>
    ${editor(ws)}
    ${shown.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Task</th><th class="num">Done</th><th>Material</th><th class="num">Issued</th><th class="num">Expected</th><th class="num">Difference</th><th class="num">Value</th><th>Check</th></tr></thead>
      <tbody>${shown.map(r => html`<tr><td>${r.task}</td><td class="num">${n(r.progress)}%</td><td>${r.item}</td><td class="num">${n(r.issued)} ${r.unit}</td><td class="num">${r.expected == null ? '—' : `${n(r.expected)} ${r.unit}`}</td>
        <td class="num">${r.expected ? `${r.diff > 0 ? '+' : ''}${n(r.diff)} (${r.pct > 0 ? '+' : ''}${r.pct}%)` : ''}</td><td class="num">${r.value != null && r.expected ? money(r.value, cur()) : ''}</td>
        <td>${chip(FLAG_WORD[r.flag], FLAG_TONE[r.flag])}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">${rows.length ? 'Nothing to look at: every material is within 10% of the expected use.' : 'No material issued against a task yet. On the phone, Store, Issue: choose the task it is for. Set each task\'s usage here.'}</p>`}
    ${unlinked.count ? html`<p class="muted small">Not linked to a task: ${Object.entries(unlinked.items).map(([k, q]) => `${k.split('|')[0]} ${n(q)} ${k.split('|')[1]}`).join(', ')}.</p>` : ''}
  </section>`;
}

export const actions = {
  useShow(el) { show = el.dataset.v; },
  useEdit(el) { editing = el.dataset.v || ''; },
  useCsv(el, c) { downloadText(`Materials used ${store.project?.name || ''} ${todayISO()}.csv`, toCSV(csvRows(data(c || {}).rows))); },
};
export const changes = { useTask(el) { editing = el.value; } };
export const submits = {
  useSave(fd) {
    const lines = [];
    for (let i = 0; fd.has(`item${i}`); i++) lines.push({ item: fd.get(`item${i}`), unit: fd.get(`unit${i}`), per: fd.get(`per${i}`) });
    const usage = cleanUsage(lines), id = editing;
    store.update(ws => { const t = ws.tasks.find(x => x.id === id); if (t) t.usage = usage; });
    store.logActivity?.({ action: 'save', channel: 'Materials used', doc: `Usage for ${(store.ws.tasks || []).find(x => x.id === id)?.name || 'a task'}: ${usage.length} lines` });
  },
};
