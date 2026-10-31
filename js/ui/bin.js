// v0.26.0: Admin settings, Recycle bin. Everything deleted anywhere in the hub waits here: what it was, who
// deleted it, when and from which page. Only the Admin restores an item or empties the bin. The records and
// the rules are in engine/bin.js; the store fills the bin.
import { html } from './dom.js';
import { store } from '../core/store.js';
import { fmtDate } from '../core/util.js';
import { binList, binDaysLeft, binDays, holds, BIN_DAYS } from '../engine/bin.js';

let notice = '';
const when = t => { const d = new Date(t); return isNaN(d) ? '' : `${fmtDate(t.slice(0, 10))} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };

export function binPage(c) {
  const days = binDays(c.global);
  const list = binList(store.bin);
  return html`<div class="side settings">
    <section class="card" id="panel-bin">
      <div class="toolbar"><h2>Recycle bin</h2><span class="muted">${list.length ? `${list.length} deleted item${list.length === 1 ? '' : 's'}` : 'Empty'}</span></div>
      <p class="muted">Whatever is deleted, on any page, waits here first. Restore puts it back where it was, with what was deleted with it. Each item is erased for good ${days} days after it was deleted.</p>
      ${notice ? html`<p class="callout ok" role="status"><b>✓</b> <span>${notice}</span></p>` : ''}
      ${list.length ? html`<div class="table-wrap"><table class="table compact bin-t">
        <thead><tr><th>What</th><th>Page</th><th>Deleted by</th><th>When</th><th class="r">Days left</th><th></th></tr></thead>
        <tbody>${list.map(e => html`<tr>
          <td><b>${e.what}</b>${e.projectName && e.kind !== 'project' ? html` <span class="muted">${e.projectName}</span>` : ''}<span class="muted note">${holds(e)}</span></td>
          <td>${e.page || ''}</td><td>${e.byName || e.by || ''}</td><td class="nowrap">${when(e.at)}</td>
          <td class="r ${binDaysLeft(e, days) <= 3 ? 'bad' : ''}">${binDaysLeft(e, days)}</td>
          <td class="r nowrap"><button class="btn small primary" data-act="binRestore" data-id="${e.id}">Restore</button>
            <button class="btn ghost small" data-act="removeBin" data-id="${e.id}">Erase</button></td></tr>`)}</tbody>
      </table></div>
      <div class="actions left"><button class="btn danger" data-act="removeBinAll">Empty the bin</button></div>` : html`<p class="empty">Nothing deleted.</p>`}
    </section>
    <section class="card set-box"><h3>How long deleted items are kept</h3>
      <label>Days in the bin <input type="number" min="7" max="3650" step="1" data-chg="binDays" data-fk="bin-days" value="${days}" class="amount"></label>
      <p class="muted">${BIN_DAYS} unless you change it. Between 7 and 3650 days.</p>
    </section>
  </div>`;
}

/** Clear what has been in the bin too long, when the Admin opens Settings. */
export function purgeOld() { notice = ''; if (store.isAdmin && !store.readOnly) store.purgeBin(); }

export const binActions = {
  async binRestore(el) {
    const out = await store.restoreBin(el.dataset.id);
    notice = out.message;
    store.notify();
  },
  /** Admin only: the name starts with "remove", which the shell reserves for the Admin. */
  removeBin(el) {
    const e = store.bin.find(x => x.id === el.dataset.id);
    if (!e || !confirm(`Erase "${e.what.replace(/^Deleted /, '')}" for good? It cannot be brought back.`)) return;
    store.eraseBin(e.id);
    notice = 'Erased for good.';
  },
  removeBinAll() {
    const n = store.bin.length;
    if (!n || !confirm(`Empty the recycle bin? The ${n} item${n === 1 ? '' : 's'} in it are erased for good${store.bin.some(e => e.kind === 'project') ? ', with every project in it and all its records' : ''}. This cannot be undone.`)) return;
    for (const e of [...store.bin]) store.eraseBin(e.id);
    notice = 'The bin is empty.';
  },
};

export const binChanges = {
  binDays(el) {
    const d = Math.round(+el.value);
    if (d >= 7 && d <= 3650) store.updateGlobal(g => { g.binDays = d; });
  },
};
