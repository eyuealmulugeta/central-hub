// v1.9.0 (owner, 7 Nov, G7): Money > Excel link. The Admin or the GM makes one private, read-only link per project; Excel's
// Data > From Web opens it and Refresh All brings the latest money and planning tables. See engine/excelfeed.js.

import { store } from '../core/store.js';
import { html } from './dom.js';
import { linkOf, mayLink } from '../engine/excelfeed.js';

const got = {};   // pid -> { busy, link, err }
const when = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

async function call(pid, act) {
  const s = got[pid] ||= {};
  s.busy = true; s.err = ''; store.notify();
  try { s.link = await store.callServer('excelLink', { pid, act }); }
  catch (e) { s.err = String(e?.message || e).replace(/^.*?: /, ''); }
  s.busy = false; store.notify();
}

export function render(c) {
  if (!mayLink(store.role, store.ranks)) return html`<section class="card"><p class="empty">Only the Admin and the GM make Excel links.</p></section>`;
  const p = c.project || store.project || {}, pid = p.id, s = got[pid] || {};
  if (pid && !s.link && !s.busy && !s.err) call(pid, 'get');
  const l = s.link || {}, url = linkOf(l.key);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Excel link</h2><span class="muted">${p.name || ''}: money and planning tables for Excel, read only. No pay or salaries.</span></div>
    ${s.err ? html`<p class="callout warn">${s.err}</p>` : ''}
    ${s.busy && !s.link ? html`<p class="muted">Loading…</p>` : url ? html`<div class="box pad"><b>The link</b>
        <p><input readonly value="${url}" aria-label="Excel link" style="width:100%" onclick="this.select()"></p>
        <p class="muted small">Made ${when(l.at)} by ${l.byName}. Opened by Excel ${l.uses} time${l.uses === 1 ? '' : 's'}${l.last ? `, last ${when(l.last)}` : ''}.</p>
        <div class="actions left"><button type="button" class="btn primary" data-act="xlCopy">Copy the link</button>
          <button type="button" class="btn" data-act="xlMake" ${s.busy ? 'disabled' : ''}>Make a new link</button>
          <button type="button" class="btn danger" data-act="xlOff" ${s.busy ? 'disabled' : ''}>Turn off</button></div>
        <p class="muted small">Anyone with the link can read these tables, so share it only with the people who need them. A new link stops the old one at once.</p></div>`
      : html`<div class="box pad"><p>No Excel link for this project.</p><button type="button" class="btn primary" data-act="xlMake" ${s.busy ? 'disabled' : ''}>Make the link</button></div>`}
    <div class="box pad"><b>In Excel (once)</b>
      <ol class="small"><li>Copy the link.</li><li>Excel: <b>Data</b>, <b>Get Data</b>, <b>From Web</b> (or <b>From Web</b> on the Data tab).</li><li>Paste the link, <b>OK</b>. If asked how to connect, choose <b>Anonymous</b>, <b>Connect</b>.</li>
        <li>In the list, tick <b>Select multiple items</b>, tick every table (Summary, Costs, Bills, Invoices, Cash flow, Tasks, Progress), then <b>Load</b>.</li>
        <li>Later: <b>Data</b>, <b>Refresh All</b> brings the latest figures. Save the Excel file; the tables stay connected.</li></ol>
      <p class="muted small">Tables: Summary (budget, spent, invoiced, outstanding), Costs, supplier Bills, client Invoices, Cash flow by month, Tasks (% done, delay), Progress by week.</p></div>
  </section>`;
}

export const actions = {
  xlCopy(el, c) { const l = (got[(c.project || store.project || {}).id] || {}).link; if (l?.key) navigator.clipboard?.writeText(linkOf(l.key)).then(() => store.toast?.('Link copied.')).catch(() => {}); },
  xlMake(el, c) { const p = c.project || store.project || {}, l = (got[p.id] || {}).link; if (l?.key && !confirm('Make a new link? The old link stops working at once, also in Excel files that use it.')) return; call(p.id, 'make'); },
  xlOff(el, c) { const p = c.project || store.project || {}; if (!confirm(`Turn off the Excel link of ${p.name || 'this project'}? Excel files that use it stop refreshing.`)) return; call(p.id, 'off'); },
};
