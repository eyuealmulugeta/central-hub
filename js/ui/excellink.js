// v1.9.0 (owner, 7 Nov, G7): Money > Excel link. The Admin or the GM makes one private, read-only link per project; Excel's
// Data > From Web opens it and Refresh All brings the latest money and planning tables. See engine/excelfeed.js.

import { store } from '../core/store.js';
import { html } from './dom.js';
import { linkOf, mayLink } from '../engine/excelfeed.js';
import { templateSheets, KIND_WORD } from '../engine/excelin.js';   // v1.10.0 (G7b)
import { xlsxBytes } from '../core/xlsxwrite.js';
import { linkOf as payLinkOf, LINK_DAYS } from '../engine/payfeed.js';   // v1.17.0 (G8)

// v1.17.0 (owner, G8): the pay link: attendance, crew pay, monthly staff and progress, names and pay included; 30 days
const pay = {};   // pid -> { busy, link, err }
async function callPay(pid, act) {
  const s = pay[pid] ||= {};
  s.busy = true; s.err = ''; store.notify();
  try { s.link = await store.callServer('payLink', { pid, act }); }
  catch (e) { s.err = String(e?.message || e).replace(/^.*?: /, ''); }
  s.busy = false; store.notify();
}
function payCard(p) {
  const s = pay[p.id] || {};
  if (p.id && !s.link && !s.busy && !s.err) callPay(p.id, 'get');
  const l = s.link || {}, url = payLinkOf(l.key);
  const left = l.until ? Math.max(0, Math.ceil((l.until - Date.now()) / 864e5)) : 0;
  return html`<div class="box pad"><b>Pay link (attendance, salary, progress)</b>
    <p class="muted small">Names, wages and pay of this project for Excel: attendance by day, the crew pay sheets (as in Payments), the monthly staff (Payroll), day rates and progress, this month and the two before. Only the Admin and the GM make it; it stops by itself after ${LINK_DAYS} days.</p>
    ${s.err ? html`<p class="callout warn">${s.err}</p>` : ''}
    ${s.busy && !s.link ? html`<p class="muted">Loading…</p>` : url ? html`<p><input readonly value="${url}" aria-label="Excel pay link" style="width:100%" onclick="this.select()"></p>
        <p class="muted small">Made ${when(l.at)} by ${l.byName}. Works ${left} more day${left === 1 ? '' : 's'} (until ${when(l.until)}). Opened by Excel ${l.uses} time${l.uses === 1 ? '' : 's'}${l.last ? `, last ${when(l.last)}` : ''}.</p>
        <div class="actions left"><button type="button" class="btn primary" data-act="plCopy">Copy the pay link</button>
          <button type="button" class="btn" data-act="plMake" ${s.busy ? 'disabled' : ''}>Make a new pay link</button>
          <button type="button" class="btn danger" data-act="plOff" ${s.busy ? 'disabled' : ''}>Turn off</button></div>
        <p class="callout warn small">Anyone with this link sees everyone's pay on this project. Give it only to the person who keeps the pay file.</p>`
      : html`<p>${l.ran ? 'The last pay link ran out.' : 'No pay link for this project.'}</p><button type="button" class="btn primary" data-act="plMake" ${s.busy ? 'disabled' : ''}>Make the pay link</button>`}
    <p class="muted small">In Excel: the same steps as below (Data, From Web, paste, Anonymous). Tables: Summary, Pay periods, Salary, Attendance, Monthly staff, Rates, Progress.</p>
  </div>`;
}

const got = {};   // pid -> { busy, link, err }
const when = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

async function call(pid, act) {
  const s = got[pid] ||= {};
  s.busy = true; s.err = ''; store.notify();
  try { s.link = await store.callServer('excelLink', { pid, act }); }
  catch (e) { s.err = String(e?.message || e).replace(/^.*?: /, ''); }
  s.busy = false; store.notify();
}

// v1.10.0 (owner, G7b): From Excel: the owner's Excel file in Google Drive; changes wait for the Admin or the GM
const inn = {};   // pid -> { busy, st, err, open }
async function callIn(pid, data) {
  const s = inn[pid] ||= {};
  s.busy = true; s.err = ''; store.notify();
  try { s.st = await store.callServer('excelIn', { pid, ...data }); }
  catch (e) { s.err = String(e?.message || e).replace(/^.*?: /, ''); }
  s.busy = false; store.notify();
}
function fromExcel(p) {
  const s = inn[p.id] || {};
  if (p.id && !s.st && !s.busy && !s.err) callIn(p.id, { act: 'get' });
  const st = s.st || {}, ch = st.changes || [], er = st.errors || [];
  return html`<div class="box pad"><b>From Excel to Central Hub</b>
    <p class="muted small">Keep one Excel file for this project in Google Drive. Central Hub reads it every hour; each new, changed or removed row waits here until you approve it.</p>
    ${s.err ? html`<p class="callout warn">${s.err}</p>` : ''}
    ${st.file ? html`<p class="small"><b>${st.file.name || 'Excel file'}</b> · connected ${when(st.file.at)} by ${st.file.byName} · <a href="${st.file.link}" target="_blank" rel="noopener">open in Drive</a></p>
      <p class="muted small">${st.checked ? `Checked ${when(st.checked)}` : 'Not checked yet'}${st.modified ? ` · file saved ${when(st.modified)}` : ''}</p>
      ${st.fail ? html`<p class="callout warn small">Last check failed: ${st.fail}</p>` : ''}
      <div class="actions left"><button type="button" class="btn primary" data-act="xiSync" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Working…' : 'Sync now'}</button><button type="button" class="btn" data-act="xiTpl">Download the template</button><button type="button" class="btn danger" data-act="xiOff" ${s.busy ? 'disabled' : ''}>Disconnect</button></div>`
    : html`<ol class="small"><li><button type="button" class="btn" data-act="xiTpl">Download the template</button></li><li>Upload it to your Google Drive (the account Field Report runs on) and fill it in.</li><li>In Drive: Share, Copy link. Paste it here:</li></ol>
      <form data-form="xiSet" class="actions left"><input name="link" placeholder="https://docs.google.com/… or https://drive.google.com/…" aria-label="Google Drive link" style="min-width:18rem"><button class="btn primary" ${s.busy ? 'disabled' : ''}>Connect</button></form>`}
    ${er.length ? html`<div class="callout warn small"><b>${er.length} row${er.length === 1 ? '' : 's'} to fix in Excel</b><ul>${er.slice(0, 30).map(e => html`<li>${e.sheet}, row ${e.row}${e.ref ? ` (${e.ref})` : ''}: ${e.text}</li>`)}</ul></div>` : ''}
    ${ch.length ? html`<div class="toolbar"><b>${ch.length} change${ch.length === 1 ? '' : 's'} waiting${st.more ? ` (and ${st.more} more after these)` : ''}</b><span class="grow"></span>
        <button type="button" class="btn primary" data-act="xiDo" data-v="approve" data-all="1" ${s.busy ? 'disabled' : ''}>Approve all</button><button type="button" class="btn" data-act="xiDo" data-v="reject" data-all="1" ${s.busy ? 'disabled' : ''}>Reject all</button></div>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Sheet</th><th>Ref</th><th>What</th><th>Details</th><th></th></tr></thead><tbody>${ch.map(x => html`<tr>
        <td>${x.sheet}</td><td>${x.ref}</td><td>${KIND_WORD[x.kind] || x.kind}</td>
        <td>${x.text}${x.diffs.length ? html`<ul class="small muted">${x.diffs.map(([k, a, b]) => html`<li>${k}: ${a || '—'} → ${b || '—'}</li>`)}</ul>` : ''}</td>
        <td class="nowrap"><button type="button" class="btn small primary" data-act="xiDo" data-v="approve" data-id="${x.id}" ${s.busy ? 'disabled' : ''}>Approve</button> <button type="button" class="btn small" data-act="xiDo" data-v="reject" data-id="${x.id}" ${s.busy ? 'disabled' : ''}>Reject</button></td></tr>`)}</tbody></table></div>`
      : st.file && !st.fail ? html`<p class="muted small">Nothing waiting: Central Hub has everything in the file.</p>` : ''}
  </div>`;
}

export function render(c) {
  if (!mayLink(store.role, store.ranks)) return html`<section class="card"><p class="empty">Only the Admin and the GM make Excel links.</p></section>`;
  const p = c.project || store.project || {}, pid = p.id, s = got[pid] || {};
  if (pid && !s.link && !s.busy && !s.err) call(pid, 'get');
  const l = s.link || {}, url = linkOf(l.key);
  return html`<section class="card wide">
    ${fromExcel(p)}
    ${payCard(p)}
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

export const submits = { xiSet(fd, c) { const link = String(fd.get('link') || '').trim(); if (link) callIn((c.project || store.project || {}).id, { act: 'set', link }); } };

export const actions = {
  plCopy(el, c) { const l = (pay[(c.project || store.project || {}).id] || {}).link; if (l?.key) navigator.clipboard?.writeText(payLinkOf(l.key)).then(() => store.toast?.('Pay link copied.')).catch(() => {}); },
  plMake(el, c) { const p = c.project || store.project || {}, l = (pay[p.id] || {}).link; if (!confirm(l?.key ? 'Make a new pay link? The old one stops at once, also in Excel files that use it.' : `Make a pay link for ${p.name || 'this project'}? Anyone with it sees the names and pay of this project for ${LINK_DAYS} days.`)) return; callPay(p.id, 'make'); },
  plOff(el, c) { const p = c.project || store.project || {}; if (confirm(`Turn off the pay link of ${p.name || 'this project'}? Excel files that use it stop refreshing.`)) callPay(p.id, 'off'); },
  xiSync(el, c) { callIn((c.project || store.project || {}).id, { act: 'sync' }); },
  xiOff(el, c) { const p = c.project || store.project || {}; if (confirm(`Disconnect the Excel file of ${p.name || 'this project'}? What was approved stays in Central Hub.`)) callIn(p.id, { act: 'off' }); },
  xiDo(el, c) {
    const p = c.project || store.project || {}, st = (inn[p.id] || {}).st || {}, ids = el.dataset.all ? (st.changes || []).map(x => x.id) : [el.dataset.id];
    const n = ids.length, word = el.dataset.v === 'approve' ? 'Approve' : 'Reject';
    if (el.dataset.all && !confirm(`${word} all ${n} changes from Excel?`)) return;
    callIn(p.id, { act: el.dataset.v, ids });
  },
  xiTpl(el, c) {
    const p = c.project || store.project || {}, b = xlsxBytes(templateSheets());
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `${String(p.name || 'Project').replace(/[^w .-]/g, '')} - Central Hub Excel template.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  xlCopy(el, c) { const l = (got[(c.project || store.project || {}).id] || {}).link; if (l?.key) navigator.clipboard?.writeText(linkOf(l.key)).then(() => store.toast?.('Link copied.')).catch(() => {}); },
  xlMake(el, c) { const p = c.project || store.project || {}, l = (got[p.id] || {}).link; if (l?.key && !confirm('Make a new link? The old link stops working at once, also in Excel files that use it.')) return; call(p.id, 'make'); },
  xlOff(el, c) { const p = c.project || store.project || {}; if (!confirm(`Turn off the Excel link of ${p.name || 'this project'}? Excel files that use it stop refreshing.`)) return; call(p.id, 'off'); },
};
