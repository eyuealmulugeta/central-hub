// v1.3.0 (owner, 7 Nov, FR R5): Reports > Site store. The project's store as Field Report keeps it: what is there,
// each movement (receive, issue, return, transfer out, weekly count) with who recorded and who approved it, and an
// Excel file. Read only here: the store keeper records on the phone and the PM approves there.

import { store } from '../core/store.js';
import { html, chip } from './dom.js';
import { toCSV, downloadText, todayISO } from '../core/util.js';
import { bookOf, sortMoves, kindWord, MOVE_WORD, lowOf, countDue, moveLine } from '../fr/model/store.js';

const TONE = { waiting: 'warn', approved: 'ok', rejected: 'bad', cancelled: '' };
const n = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
let tab = 'stock';

export function render(c) {
  const all = c.ws.storeMoves || store.ws.storeMoves || [], keeper = all.find(m => m.id === 'keeper');
  const book = Object.values(bookOf(all)).filter(e => e.qty || e.waiting).sort((a, b) => a.item.localeCompare(b.item));
  const low = lowOf(bookOf(all), keeper?.mins || {}), due = countDue(all, c.today || todayISO()), list = sortMoves(all);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Site store</h2><span class="muted">Kept in Field Report by ${keeper ? (keeper.keeperName || keeper.keeper) : 'the store keeper (not set yet)'}. The PM approves every movement; the PE or GM the weekly count.</span><span class="grow"></span>
      <button type="button" class="btn" data-act="ssCsv" ${all.length ? '' : 'disabled'}>Excel</button></div>
    <div class="actions left">
      <button type="button" class="btn ${tab === 'stock' ? 'primary' : ''}" data-act="ssTab" data-v="stock">In the store · ${book.length}</button>
      <button type="button" class="btn ${tab === 'moves' ? 'primary' : ''}" data-act="ssTab" data-v="moves">Movements · ${list.length}${list.some(m => m.status === 'waiting') ? ` (${list.filter(m => m.status === 'waiting').length} waiting)` : ''}</button>
      ${due.due ? chip(`Weekly count due${due.last ? `, last ${due.last}` : ''}`, 'warn') : chip(`Counted ${due.last}`, 'ok')}
      ${low.length ? chip(`Low: ${low.map(e => e.item).join(', ')}`, 'bad') : ''}
    </div>
    ${tab === 'stock' ? (book.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Item</th><th class="num">In the store</th><th>Unit</th><th class="num">Waiting</th><th class="num">Minimum</th><th>Last</th></tr></thead>
      <tbody>${book.map(e => html`<tr><td>${e.item}</td><td class="num"><b>${n(e.qty)}</b></td><td>${e.unit}</td><td class="num">${e.waiting ? n(e.waiting) : ''}</td><td class="num">${keeper?.mins?.[e.key] ?? ''}</td><td>${e.last}</td></tr>`)}</tbody></table></div>` : html`<p class="empty">Nothing in the store yet.</p>`)
    : list.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Day</th><th>Movement</th><th>Supplier / for</th><th>Recorded by</th><th>Status</th><th>Delivery note / signature</th></tr></thead>
      <tbody>${list.map(m => html`<tr><td class="nowrap">${m.date}</td><td>${moveLine(m)}${m.kind === 'count' ? html`<br><small class="muted">${(m.lines || []).filter(l => l.diff).map(l => `${l.item} ${l.diff > 0 ? '+' : ''}${n(l.diff)}`).join(', ') || 'No differences'}</small>` : ''}${m.note ? html`<br><small class="muted">${m.note}</small>` : ''}</td>
        <td>${m.supplier || m.zone || m.toProjectName || ''}</td><td>${m.byName || m.by}</td>
        <td>${chip(MOVE_WORD[m.status] || m.status, TONE[m.status])}${m.decidedByName ? html`<br><small class="muted">${m.decidedByName}</small>` : ''}</td>
        <td>${m.photo ? html`<img class="ss-img" src="${m.photo}" alt="Delivery note">` : ''}${m.sig ? html`<img class="ss-img sig" src="${m.sig}" alt="Signature">` : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="empty">No movements yet.</p>`}
  </section>`;
}

export const actions = {
  ssTab(el) { tab = el.dataset.v; },
  ssCsv(el, c) {
    const all = (c?.ws || store.ws).storeMoves || [];
    const rows = [['Day', 'Type', 'Item', 'Quantity', 'Unit', 'Supplier', 'Given to / by', 'For', 'To project', 'Recorded by', 'Status', 'Decided by', 'Note']];
    for (const m of sortMoves(all)) {
      if (m.kind === 'count') for (const l of m.lines || []) rows.push([m.date, `${kindWord('count')} (books ${l.book}, diff ${l.diff})`, l.item, l.counted, l.unit, '', '', '', '', m.byName || m.by, m.status, m.decidedByName || '', m.note || '']);
      else rows.push([m.date, kindWord(m.kind), m.item, m.qty, m.unit, m.supplier || '', m.to || '', m.zone || '', m.toProjectName || '', m.byName || m.by, m.status, m.decidedByName || '', m.note || '']);
    }
    downloadText(`Site store ${store.project?.name || ''} ${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
  },
};
