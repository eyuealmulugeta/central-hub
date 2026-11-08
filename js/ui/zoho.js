// v1.18.0 (owner, 8 Nov, G9): Money > Zoho export. The UAE company's month (USD projects and Trading, crew pay included)
// as one .xlsx in Zoho Books' import format, USD at 3.6725 AED. The Admin and the GM download it; only the Admin marks a
// month as sent (so nothing goes to Zoho twice) and chooses the accounts. All on the server: functions/zoho.js.

import { store } from '../core/store.js';
import { html } from './dom.js';
import { mayExport, PEG } from '../engine/zoho.js';

const st = { month: '', busy: false, err: '', data: null, openMap: false };
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const when = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const money = v => (+v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function call(act, extra = {}) {
  st.busy = true; st.err = ''; store.notify();
  try {
    const r = await store.callServer('zohoExport', { month: st.month, act, ...extra });
    st.data = r;
    if (act === 'file' && r?.b64) {
      const bin = atob(r.b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = r.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    if (act === 'mark') store.toast?.(`${r.marked} records marked as sent to Zoho.`);
  } catch (e) { st.err = String(e?.message || e).replace(/^.*?: /, ''); }
  st.busy = false; store.notify();
}

export function render() {
  if (!mayExport(store.role, store.ranks)) return html`<section class="card"><p class="empty">Only the Admin and the GM use the Zoho export.</p></section>`;
  st.month ||= lastMonth();
  if (!st.data && !st.busy && !st.err) call('get');
  const d = st.data || {}, c = d.counts || {}, mine = (d.log || []).find(l => l.month === st.month);
  const nothing = !(c.invoices || c.customerPayments || c.bills || c.vendorPayments || c.expenses || c.journals);
  return html`<section class="card wide">
    <div class="toolbar"><h2>Zoho export</h2><span class="muted">Amistad Pre Fab Trading FZCO (Zoho Books, AED): the USD projects and Trading, crew pay included. 1 USD = ${PEG} AED.</span></div>
    <div class="actions left"><label>Month <input type="month" value="${st.month}" data-chg="zhMonth"></label>
      <button type="button" class="btn" data-act="zhLoad" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Working…' : 'Refresh'}</button></div>
    ${st.err ? html`<p class="callout warn">${st.err}</p>` : ''}
    ${st.busy && !st.data ? html`<p class="muted">Reading the month…</p>` : st.data ? html`
      ${mine ? html`<p class="callout info small">Marked as sent to Zoho ${when(mine.at)} by ${mine.byName} (${mine.n} records). Those records are not in a new file; <b>Download again</b> gives the same file as then.</p>` : ''}
      <div class="table-wrap"><table class="table compact"><thead><tr><th>In the file</th><th class="num">Rows</th></tr></thead><tbody>
        <tr><td>Client invoices (projects and stock sales)</td><td class="num">${c.invoices || 0}</td></tr>
        <tr><td>Payments received</td><td class="num">${c.customerPayments || 0}</td></tr>
        <tr><td>Supplier bills (projects and shipments)</td><td class="num">${c.bills || 0}</td></tr>
        <tr><td>Bill payments</td><td class="num">${c.vendorPayments || 0}</td></tr>
        <tr><td>Expenses (Costs and crew pay)</td><td class="num">${c.expenses || 0}</td></tr>
        <tr><td>Other money in (journals)</td><td class="num">${c.journals || 0}</td></tr>
        <tr><td><b>Invoiced</b> / <b>bills and expenses</b></td><td class="num">USD ${money(c.usdIn)} / USD ${money(c.usdOut)}</td></tr>
        ${c.skipped ? html`<tr><td class="muted">Already sent to Zoho (left out)</td><td class="num">${c.skipped}</td></tr>` : ''}
      </tbody></table></div>
      ${(d.checks || []).length ? html`<div class="callout warn small"><b>${d.checks.length + (d.more || 0)} thing${d.checks.length + (d.more || 0) === 1 ? '' : 's'} to fix first</b> (they are also on the Checks sheet)
        <ul>${d.checks.map(([what, where, fix]) => html`<li><b>${what}</b>: ${where}. ${fix}.</li>`)}</ul></div>` : html`<p class="muted small">No problems found.</p>`}
      <div class="actions left">
        <button type="button" class="btn primary" data-act="zhFile" ${st.busy || nothing ? 'disabled' : ''}>Download the Zoho file</button>
        ${mine ? html`<button type="button" class="btn" data-act="zhAgain" ${st.busy ? 'disabled' : ''}>Download again</button>` : ''}
        ${d.admin ? html`<button type="button" class="btn" data-act="zhMark" ${st.busy || nothing ? 'disabled' : ''}>Mark as sent to Zoho</button>
          ${mine ? html`<button type="button" class="btn danger" data-act="zhUnmark" ${st.busy ? 'disabled' : ''}>Take back "sent"</button>` : ''}` : ''}
      </div>
      <p class="muted small">After importing into Zoho, the Admin presses <b>Mark as sent to Zoho</b>: these records then stay out of every later file, so nothing is booked twice.</p>
      <div class="box pad"><b>How to import (the file has these steps on its first sheet)</b>
        <ol class="small"><li>Zoho Books: Settings, Currencies: switch on USD (rate ${PEG}).</li>
          <li>Import the contacts first: Sales, Customers, Import (sheet <b>Customers</b>); Purchases, Vendors, Import (sheet <b>Vendors</b>). Skip names already there.</li>
          <li>Then: Invoices and Customer Payments (Sales); Bills, Vendor Payments and Expenses (Purchases); Journals (Accountant, Manual Journals).</li>
          <li>For each sheet: in Excel, File, Save as, CSV (that sheet only); in Zoho, Import, choose the file, check the matched fields, Import.</li>
          <li>Do not match the <b>AED Amount</b> column: it is there to check the totals.</li></ol></div>
      ${d.admin ? html`<details class="box pad" ${st.openMap ? 'open' : ''} data-act="zhMapOpen"><summary><b>Accounts</b> <span class="muted small">(which Zoho account each Central Hub figure goes to)</span></summary>
        <form data-form="zhMap"><div class="table-wrap"><table class="table compact"><tbody>${Object.entries(d.words || {}).map(([k, word]) => html`<tr><td>${word}</td>
          <td><select name="${k}">${(d.accounts || []).map(a => html`<option ${d.map?.[k] === a ? 'selected' : ''}>${a}</option>`)}</select></td></tr>`)}</tbody></table></div>
        <button class="btn primary" ${st.busy ? 'disabled' : ''}>Save the accounts</button></form></details>` : ''}
      ${(d.log || []).length ? html`<p class="muted small">Sent to Zoho: ${d.log.map(l => `${l.month} (${l.n})`).join(', ')}.</p>` : ''}
    ` : ''}
  </section>`;
}

export const changes = { zhMonth(el) { st.month = el.value; st.data = null; call('get'); } };
export const submits = { zhMap(fd) { if (confirm('Save these accounts? The next files use them.')) call('map', { map: Object.fromEntries(fd.entries()) }); } };
export const actions = {
  zhLoad() { call('get'); },
  zhFile() { call('file'); },
  zhAgain() { call('file', { again: true }); },
  zhMark() { const c = st.data?.counts || {}; if (confirm(`Mark ${st.month} as sent to Zoho? Only after importing the file. These records will not be in later files.`)) call('mark'); },
  zhUnmark() { if (confirm(`Take back "sent to Zoho" for ${st.month}? Its records come back into the next file: only if they were not imported.`)) call('unmark'); },
  zhMapOpen() { st.openMap = true; },
};
