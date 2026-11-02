// v0.62.0 (owner, Phase B2): Ledger, Bank statement. The bank's CSV or Excel file is read on this computer (nothing is
// sent anywhere), its columns recognised (or chosen once per bank and kept), and each line matched to the Ledger:
// matched by reference, maybe by amount and date, or not found. Confirmed lines mark the entry "In bank"; a line nobody
// entered can be added as a cost or a payment received. The rules are in engine/bankimport.js.

import { store } from '../core/store.js';
import { parseCSV, detectColumns, layoutKey, linesOf, matchLines, entryOfLine, FIELDS } from '../engine/bankimport.js';
import { readXlsx } from '../core/xlsx.js';
import { uid, money, fmtDate } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { tell } from '../core/image.js';

let file = '', rows = [], header = 0, map = {}, currency = 'ETB', results = [];
const LABEL = { labor: 'Labour', material: 'Material', equipment: 'Equipment', subcontract: 'Subcontract', transport: 'Transport', overhead: 'Overhead' };

function rematch(c) {
  results = matchLines(linesOf(rows, { header, map }), [...(c.ws.ledger || []), ...(c.ws.paycosts || [])], { currency });   // crew payments too
}

export function bankView(c) {
  const head = rows[header] || [];
  const cols = [['', '(none)'], ...head.map((h, i) => [String(i), String(h || `Column ${i + 1}`)])];
  const by = s => results.filter(r => r.status === s);
  const entry = id => [...(c.ws.ledger || []), ...(c.ws.paycosts || [])].find(e => e.id === id);
  const lineCells = l => html`<td class="nowrap">${fmtDate(l.date)}</td><td>${l.text}</td><td>${l.ref}</td><td class="r nowrap">${l.out ? money(l.out, currency) : ''}</td><td class="r nowrap">${l.in ? money(l.in, currency) : ''}</td>`;
  const entryCell = e => (e ? html`<td>${fmtDate(e.date)} · ${e.description}${e.vendor ? ` · ${e.vendor}` : ''}</td>` : html`<td></td>`);
  const thead = extra => html`<thead><tr><th>Date</th><th>On the statement</th><th>Reference</th><th class="r">Out</th><th class="r">In</th>${extra}</tr></thead>`;
  return html`
    <section class="card">
      <div class="toolbar"><h2>Bank statement</h2><span class="muted">The file is read on this computer only.</span></div>
      <div class="grid2">
        <label>The bank's file (CSV or Excel .xlsx) <input type="file" accept=".csv,.txt,.xlsx" data-chg="bankFile"></label>
        <label>Account currency <select data-chg="bankCur">${options([['ETB', 'ETB'], ['USD', 'USD']], currency)}</select></label>
      </div>
      ${file ? html`<p class="muted">${file}: ${Math.max(0, rows.length - header - 1)} rows read.</p>
        <div class="grid3">${FIELDS.map(([k, label]) => html`<label>${label} <select data-chg="bankCol" data-k="${k}">${options(cols, map[k] != null ? String(map[k]) : '')}</select></label>`)}</div>
        <p class="muted small">Columns are recognised by their names; change any that is wrong. They are kept for this bank's next statement.</p>` : ''}
    </section>
    ${file ? html`
    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Matched</span><strong>${by('matched').length}</strong><span class="muted">same reference and amount</span></div>
      <div class="kpi"><span class="kpi-label">Maybe</span><strong>${by('maybe').length}</strong><span class="muted">same amount within 5 days</span></div>
      <div class="kpi"><span class="kpi-label">Not found</span><strong class="${by('none').length ? 'bad' : ''}">${by('none').length}</strong><span class="muted">no entry in the Ledger</span></div>
      <div class="kpi"><span class="kpi-label">Marked in bank</span><strong>${by('done').length}</strong><span class="muted">this time</span></div>
    </section>
    <section class="card">
      <div class="toolbar"><h3>Matched</h3><span class="grow"></span>${by('matched').length ? html`<button class="btn primary" data-act="bankMarkAll">Mark the ${by('matched').length} as In bank</button>` : ''}</div>
      ${by('matched').length ? html`<table class="table compact">${thead(html`<th>Ledger entry</th>`)}<tbody>${by('matched').map(r => html`<tr>${lineCells(r.line)}${entryCell(entry(r.entryId))}</tr>`)}</tbody></table>` : html`<p class="empty">None.</p>`}
    </section>
    <section class="card">
      <h3>Maybe: check each</h3>
      ${by('maybe').length ? html`<table class="table compact">${thead(html`<th>Ledger entry</th><th></th>`)}<tbody>${by('maybe').map(r => html`<tr>${lineCells(r.line)}${entryCell(entry(r.entryId))}
        <td class="nowrap"><button class="btn small primary" data-act="bankYes" data-id="${r.line.id}">Same</button> <button class="btn small" data-act="bankNo" data-id="${r.line.id}">Not this</button></td></tr>`)}</tbody></table>` : html`<p class="empty">None.</p>`}
    </section>
    <section class="card">
      <h3>Not found in the Ledger</h3>
      ${by('none').length ? html`<table class="table compact">${thead(html`<th></th>`)}<tbody>${by('none').map(r => html`<tr>${lineCells(r.line)}
        <td class="nowrap"><select data-chg="bankCat" data-id="${r.line.id}" aria-label="Category">${options(Object.entries(LABEL), r.cat || 'overhead')}</select>
          <button class="btn small" data-act="bankAdd" data-id="${r.line.id}">Add ${r.line.in ? 'as received' : 'as a cost'}</button></td></tr>`)}</tbody></table>` : html`<p class="empty">Every line is in the Ledger.</p>`}
    </section>
    ${by('done').length ? html`<section class="card"><h3>Marked In bank this time</h3><table class="table compact">${thead(html`<th>Ledger entry</th>`)}<tbody>${by('done').map(r => html`<tr>${lineCells(r.line)}${entryCell(entry(r.entryId))}</tr>`)}</tbody></table></section>` : ''}` : ''}`;
}

const mark = (ws, r) => {
  const e = [...(ws.ledger || []), ...(ws.paycosts || [])].find(x => x.id === r.entryId);
  if (!e) return;
  e.bank = { date: r.line.date, ref: r.line.ref };
  if (!e.bankRef && r.line.ref) e.bankRef = r.line.ref;
  r.status = 'done';
};

export const bankActions = {
  bankMarkAll() { store.update(ws => { for (const r of results.filter(x => x.status === 'matched')) mark(ws, r); }); },
  bankYes(el) { const r = results.find(x => x.line.id === el.dataset.id); if (r) store.update(ws => mark(ws, r)); },
  bankNo(el) { const r = results.find(x => x.line.id === el.dataset.id); if (r) Object.assign(r, { status: 'none', entryId: '' }); },
  bankAdd(el) {
    const r = results.find(x => x.line.id === el.dataset.id);
    if (!r) return;
    const e = entryOfLine(r.line, uid('l'), currency, r.cat || 'overhead');
    store.update(ws => ws.ledger.push(e));
    Object.assign(r, { status: 'done', entryId: e.id });
  },
};

export const bankChanges = {
  async bankFile(el, c) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      rows = /\.xlsx$/i.test(f.name) ? await readXlsx(await f.arrayBuffer()) : parseCSV(await f.text());
    } catch (err) { tell(err.message); return; }
    file = f.name;
    ({ header, map } = detectColumns(rows));
    const kept = (store.company?.bankLayouts || {})[layoutKey(rows[header] || [])];   // the columns chosen before for this bank
    if (kept) map = { ...kept };
    rematch(c);
    store.notify();
  },
  bankCur(el, c) { currency = el.value; if (file) rematch(c); },
  bankCol(el, c) {
    const v = el.value;
    map = { ...map }; if (v === '') delete map[el.dataset.k]; else map[el.dataset.k] = +v;
    const key = layoutKey(rows[header] || []);
    if (store.isAdmin) store.updateCompany(co => { co.bankLayouts = { ...(co.bankLayouts || {}), [key]: map }; });   // company settings are the Admin's
    rematch(c);
  },
  bankCat(el) { const r = results.find(x => x.line.id === el.dataset.id); if (r) r.cat = el.value; },
};
