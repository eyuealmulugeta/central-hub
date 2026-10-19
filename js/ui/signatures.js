// Document sign: every document sent for signature, with who has signed. A request is made from the
// contract it belongs to (Administration, Agreements); this page is the list of all of them.

import { overview } from './sign.js';
import { focusOn } from './contracts.js';
import { STATE_LABEL } from '../engine/sign.js';
import { fmtFull } from '../core/util.js';
import { html, chip } from './dom.js';

const CLS = { waiting: 'warn', completed: 'ok', expired: 'high', cancelled: '' };
let filter = 'all';
const FILTERS = [['all', 'All'], ['waiting', 'Waiting'], ['completed', 'Signed'], ['expired', 'Expired'], ['cancelled', 'Cancelled']];

export function render(c) {
  const rows = overview(c);
  const shown = rows.filter(r => filter === 'all' || r.st.state === filter);
  const count = k => rows.filter(r => r.st.state === k).length;
  return html`
    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Waiting for signatures</span><strong class="${count('waiting') ? 'bad' : ''}">${count('waiting')}</strong><span class="muted">Sent, not signed by everyone yet</span></div>
      <div class="kpi"><span class="kpi-label">Signed</span><strong>${count('completed')}</strong><span class="muted">Signed by everyone</span></div>
      <div class="kpi"><span class="kpi-label">Expired or cancelled</span><strong>${count('expired') + count('cancelled')}</strong><span class="muted">No longer open to sign</span></div>
    </section>
    <section class="card">
      <div class="toolbar"><h2>Documents sent for signature</h2><span class="grow"></span>
        <div class="seg">${FILTERS.map(([k, label]) => html`<button class="${filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${label}</button>`)}</div></div>
      ${shown.length ? html`<table class="table">
        <thead><tr><th>Document</th><th>Contract</th><th>Sent</th><th>By</th><th class="r">Signed</th><th>Status</th><th></th></tr></thead>
        <tbody>${shown.map(({ req, st }) => html`<tr>
          <td><b>${req.title}</b>${req.validUntil ? html`<br><span class="muted">Open until ${fmtFull(req.validUntil)}</span>` : ''}</td>
          <td class="nowrap">${req.ref || ''}</td><td class="nowrap">${fmtFull(String(req.at).slice(0, 10))}</td><td>${req.by || ''}</td>
          <td class="r">${st.done} of ${st.total}</td><td>${chip(STATE_LABEL[st.state], CLS[st.state])}</td>
          <td class="r"><button class="btn small" data-act="open" data-id="${req.contractId}">Open the contract</button></td></tr>`)}</tbody>
      </table>` : html`<p class="empty">${rows.length ? 'Nothing in this list.' : 'Nothing has been sent for signature yet. Open a contract under Agreements and use Signatures.'}</p>`}
    </section>`;
}

export const actions = {
  filter(el) { filter = el.dataset.k; },
  open(el) { focusOn(el.dataset.id); location.hash = '#contracts'; },
};
