// v1.47.0 (owner, 10 Nov, P1–P5): People & Access. One table of every person with a Central Hub tick and a Field Report
// tick that give or take access at once (taking off asks first), Add person, Remove person (both apps off, reports
// kept), Import (CSV or Excel, preview first), search and filters, data conflicts. The Admin and the GM only; every
// read and change goes through the server (functions/peopleaccess.js), which checks again.
import { store } from '../core/store.js';
import { html, options } from './dom.js';
import { buildRows, filterRows, conflicts as findConflicts, parseCsv, readTable, EXECUTIVE, STATUS } from '../engine/peopleaccess.js';
import { readXlsx } from '../core/xlsx.js';
import { ROLES } from '../engine/positions.js';

const st = { data: null, busy: '', err: '', note: '', f: { search: '', role: '', project: '', app: '', show: '' }, adding: false, preview: null, fileName: '' };
/** The Admin and the GM (rank general_manager) open this page; the server refuses everyone else too. */
export const mayManage = (role, ranks = []) => role === 'owner' || (role === 'office' && ranks.includes('general_manager'));
const err = e => String(e?.message || e).replace(/^.*?: /, '');

async function load() {
  if (!store.cloud) { st.data = sample(); store.notify(); return; }
  st.busy = 'list'; store.notify();
  try { st.data = await store.callServer('peopleAccess', { act: 'list' }); st.err = ''; } catch (e) { st.err = err(e); }
  st.busy = ''; store.notify();
}
/** Local sample (?local): the Directory of the sample data; ticks are shown, not changed. */
function sample() {
  const staff = store.company?.staff || [], projects = store.projects || [];
  return { rows: buildRows({ staff, users: store.users || [], frPeople: [], projects, admins: [] }), conflicts: findConflicts({ staff, users: store.users || [] }), you: { admin: true, gm: false }, frOk: true, local: true, projects: projects.map(p => ({ id: p.id, name: p.name, code: p.fieldCode || '' })) };
}
async function call(body, done) {
  st.busy = body.act; st.err = ''; st.note = ''; store.notify();
  try { const r = await store.callServer('peopleAccess', body); st.note = done?.(r) || ''; if (r?.warning) st.note += ` ${r.warning}`; await load(); }
  catch (e) { st.err = err(e); st.busy = ''; store.notify(); }
}

const tick = (r, app, you, local) => {
  const on = r[app], name = app === 'ch' ? 'Central Hub' : 'Field Report';
  const locked = r.admin || r.left || !r.email || local || (!you.admin && r.title && /general manager|^gm$/i.test(r.title)) || (app === 'fr' && st.data && !st.data.frOk);
  const why = r.admin ? 'The Admin always has access' : r.left ? 'Has left' : !r.email ? 'Add a sign-in email first' : local ? 'Signed-in version only' : '';
  return html`<label class="pa-tick" title="${why || `${on ? 'Take off' : 'Give'} ${name} access`}"><input type="checkbox" data-chg="paTick" data-app="${app}" data-id="${r.id}" ${on ? 'checked' : ''} ${locked || st.busy ? 'disabled' : ''} aria-label="${name} access for ${r.name}"><span class="pa-tick-word">${name === 'Central Hub' ? 'CH' : 'FR'}</span></label>`;
};
const statusChip = r => html`<span class="chip ${r.status === STATUS.active || r.status === STATUS.admin ? 'ok' : r.status === STATUS.removed || r.status === STATUS.left ? 'muted' : 'warn'}">${r.status}</span>`;

function row(r, you, local) {
  const may = !r.admin && !local && (you.admin || !/general manager|^gm$/i.test(r.title));
  return html`<tr>
    <td data-l="Name"><b>${r.name || '—'}</b></td>
    <td data-l="Email" class="pa-email">${r.email || html`${may ? html`<button type="button" class="btn small ghost" data-act="paEmail" data-id="${r.id}">Add email</button>` : html`<span class="muted">none</span>`}`}</td>
    <td data-l="Role">${r.title || html`<span class="muted">—</span>`}</td>
    <td data-l="Project">${r.project || html`<span class="muted">none</span>`}</td>
    <td data-l="CH" class="c">${tick(r, 'ch', you, local)}</td>
    <td data-l="FR" class="c">${tick(r, 'fr', you, local)}</td>
    <td data-l="Status">${statusChip(r)}</td>
    <td data-l="Actions" class="pa-acts">${may && !r.removed && r.email ? html`<button type="button" class="btn small ghost danger" data-act="paRemove" data-id="${r.id}">Remove</button>` : ''}
      ${you.admin && r.email && !r.admin && !local ? html`<a class="btn small ghost" href="#access" data-act="paDetail" data-email="${r.email}">Pages</a>` : ''}</td>
  </tr>`;
}

function addForm(d) {
  return html`<form class="card pa-add" data-form="paAdd">
    <h3>Add person</h3>
    <p class="muted small">They go into the Manpower Directory (the one list of people) with this sign-in email. A GM is added by the Admin.</p>
    <div class="pa-add-grid">
      <label>Name <input name="name" required autocomplete="off"></label>
      <label>Email <input name="email" type="email" required autocomplete="off" placeholder="their Google account"></label>
      <label>Role <input name="title" list="pa-roles" autocomplete="off" placeholder="Position, or Executive"></label>
      <label>Project <select name="projectId">${options([['', 'None yet'], ...d.projects.map(p => [p.id, p.name])], '')}</select></label>
      <label class="pa-check"><input type="checkbox" name="ch"> Central Hub</label>
      <label class="pa-check"><input type="checkbox" name="fr"> Field Report</label>
    </div>
    <datalist id="pa-roles">${[EXECUTIVE, ...ROLES].map(r => html`<option value="${r}"></option>`)}</datalist>
    <div class="actions left"><button class="btn primary" ${st.busy ? 'disabled' : ''}>Add</button><button type="button" class="btn ghost" data-act="paAddClose">Cancel</button></div>
  </form>`;
}

function previewBox() {
  const p = st.preview, ok = p.filter(r => r.action !== 'Error');
  return html`<section class="card pa-preview">
    <h3>Import preview: ${st.fileName}</h3>
    <p class="muted small">${ok.filter(r => r.action === 'New').length} new, ${ok.filter(r => r.action === 'Update').length} already in the list (only their ticks, and an empty position or project, are applied), ${p.length - ok.length} with an error (left out). Nothing is saved until you press Import.</p>
    <div class="table-wrap pa-wrap"><table class="table compact pa-table"><thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Role</th><th>Project</th><th>CH</th><th>FR</th><th>Result</th></tr></thead><tbody>
      ${p.map(r => html`<tr class="${r.action === 'Error' ? 'pa-err' : ''}"><td data-l="Line">${r.line}</td><td data-l="Name">${r.name}</td><td data-l="Email" class="pa-email">${r.email}</td><td data-l="Role">${r.title}</td><td data-l="Project">${r.projectName || r.project}</td><td data-l="CH">${r.ch ? '✓' : ''}</td><td data-l="FR">${r.fr ? '✓' : ''}</td><td data-l="Result">${r.action === 'Error' ? html`<span class="chip warn">${r.error}</span>` : html`<span class="chip ok">${r.action}</span>`}</td></tr>`)}
    </tbody></table></div>
    <div class="actions left"><button type="button" class="btn primary" data-act="paImportGo" ${!ok.length || st.busy ? 'disabled' : ''}>Import ${ok.length} ${ok.length === 1 ? 'person' : 'people'}</button><button type="button" class="btn ghost" data-act="paImportClose">Cancel</button></div>
  </section>`;
}

export function render() {
  if (!mayManage(store.role, store.ranks)) return html`<section class="card"><p class="empty">Only the Admin and the GM manage people and access.</p></section>`;
  if (!st.data && !st.busy && !st.err) load();
  const d = st.data;
  const head = html`<div class="toolbar pa-bar"><h2>People &amp; Access</h2>
    <div class="actions left pa-buttons">
      <button type="button" class="btn primary" data-act="paAddOpen" ${!d || d.local ? 'disabled' : ''}>Add person</button>
      <label class="btn ${!d || d.local ? 'disabled' : ''}">Import<input type="file" data-chg="paImport" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden ${!d || d.local ? 'disabled' : ''}></label>
      <button type="button" class="btn ghost" data-act="paLoad" ${st.busy ? 'disabled' : ''}>${st.busy === 'list' ? 'Reading…' : 'Refresh'}</button>
    </div></div>`;
  if (!d) return html`<section class="card wide">${head}${st.err ? html`<p class="callout warn">${st.err}</p>` : html`<p class="muted">Reading who has access…</p>`}</section>`;
  const rows = filterRows(d.rows, st.f), roles = [...new Set(d.rows.map(r => r.title).filter(Boolean))].sort();
  return html`<section class="card wide pa">
    ${head}
    <p class="muted small">Tick to give access at once; untick takes it off (asked first). The Directory stays the one list of people: positions, projects and HR details are kept there. ${d.you.admin ? '' : 'You manage everyone but the Admin and the GM.'}</p>
    ${d.local ? html`<p class="callout info small">Sample data: ticks change nothing here. Sign in to manage access.</p>` : ''}
    ${!d.frOk ? html`<p class="callout warn small">Field Report's access list could not be read just now: the FR ticks are locked. Press Refresh.</p>` : ''}
    ${st.err ? html`<p class="callout warn" role="alert">${st.err}</p>` : ''}${st.note ? html`<p class="callout info small" role="status">${st.note}</p>` : ''}
    ${(d.conflicts || []).length ? html`<details class="callout warn small pa-conf"><summary><b>${d.conflicts.length} data conflict${d.conflicts.length === 1 ? '' : 's'} to look at</b></summary><ul>${d.conflicts.map(x => html`<li>${x.text}</li>`)}</ul></details>` : ''}
    ${st.adding ? addForm(d) : ''}
    ${st.preview ? previewBox() : ''}
    <div class="pa-filters">
      <input class="search" type="search" data-chg="paF" data-k="search" data-fk="pa-search" value="${st.f.search}" placeholder="Search name, email, role or project" aria-label="Search people">
      <select data-chg="paF" data-k="role" aria-label="Role">${options([['', 'All roles'], ...roles.map(r => [r, r])], st.f.role)}</select>
      <select data-chg="paF" data-k="project" aria-label="Project">${options([['', 'All projects'], ...d.projects.map(p => [p.id, p.name])], st.f.project)}</select>
      <select data-chg="paF" data-k="app" aria-label="App access">${options([['', 'Any access'], ['ch', 'Central Hub'], ['fr', 'Field Report'], ['both', 'Both apps'], ['none', 'No access']], st.f.app)}</select>
      <select data-chg="paF" data-k="show" aria-label="Who">${options([['', 'Current people'], ['removed', 'Removed and left'], ['all', 'Everyone']], st.f.show)}</select>
      <span class="muted small">${rows.length} of ${d.rows.length}</span>
    </div>
    <div class="table-wrap pa-wrap"><table class="table pa-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Project</th><th class="c">CH</th><th class="c">FR</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => row(r, d.you, d.local)) : html`<tr><td colspan="8" class="muted">Nobody matches.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

const rowOf = id => st.data?.rows.find(r => r.id === id);
export const changes = {
  paF(el) { st.f[el.dataset.k] = el.value; },
  paTick(el) {
    const r = rowOf(el.dataset.id), app = el.dataset.app, name = app === 'ch' ? 'Central Hub' : 'Field Report';
    if (!r) return false;
    if (!el.checked && !confirm(`Remove ${r.name}'s access to ${name}?`)) { el.checked = true; return false; }
    call({ act: app, id: r.id, on: el.checked }, () => `${r.name}: ${name} access ${el.checked ? 'given' : 'taken off'}.`);
  },
  async paImport(el) {
    const file = el.files?.[0]; el.value = '';
    if (!file) return false;
    try {
      const cells = /\.xlsx$/i.test(file.name) ? (await readXlsx(await file.arrayBuffer())).map(r => r.map(c => (c == null ? '' : String(c)))) : parseCsv(await file.text());
      const { rows, missing } = readTable(cells);
      if (missing.length) { st.err = `The file has no ${missing.join(' or ')} column. Columns: Name, Email, Role, Project, CH, FR.`; store.notify(); return false; }
      st.fileName = file.name; st.busy = 'import'; store.notify();
      const r = await store.callServer('peopleAccess', { act: 'import', rows });
      st.preview = r.preview; st.err = '';
    } catch (e) { st.err = err(e); }
    st.busy = ''; store.notify();
  },
};
export const submits = {
  paAdd(fd) {
    const body = { act: 'add', name: fd.get('name'), email: fd.get('email'), title: fd.get('title'), projectId: fd.get('projectId'), ch: fd.get('ch') === 'on', fr: fd.get('fr') === 'on' };
    st.adding = false;
    call(body, () => `${body.name} added.`);
  },
};
export const actions = {
  paLoad() { load(); },
  paAddOpen() { st.adding = true; st.preview = null; },
  paAddClose() { st.adding = false; },
  paImportClose() { st.preview = null; },
  paImportGo() {
    const rows = st.preview.filter(r => r.action !== 'Error');
    st.preview = null;
    call({ act: 'import', commit: true, rows }, r => `Import: ${r.added} added, ${r.updated} already there.${r.errors?.length ? ` Not done: ${r.errors.join(' ')}` : ''}`);
  },
  paRemove(el) {
    const r = rowOf(el.dataset.id);
    if (r && confirm(`Remove ${r.name}? Their Central Hub and Field Report access is taken off; their reports are kept.`)) call({ act: 'remove', id: r.id }, () => `${r.name} removed.`);
  },
  paEmail(el) {
    const r = rowOf(el.dataset.id), email = r && prompt(`Sign-in email (Google account) of ${r.name}:`);
    if (email) call({ act: 'email', id: r.id, email: email.trim() }, () => `${r.name}: sign-in email saved.`);
  },
  paDetail(el) { globalThis.sessionStorage?.setItem('pa-person', el.dataset.email); },
};
