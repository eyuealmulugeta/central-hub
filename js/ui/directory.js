// Manpower Directory (Phase B1, v0.45.0). The Admin sees everybody who works for the company in two tables, Staff
// (Tiers 1, 2, 3 and 5) and Crew (Tier 4), and sets each person's position and project right in the row; each
// change is confirmed first. A person is added here, and each one is an employee-data record (People > HR).
// Everybody else keeps the staff directory of before: the open project's team by name and position, nothing private.

import { store } from '../core/store.js';
import { html, options, chip } from './dom.js';
import { uid, money } from '../core/util.js';
import { stamp } from '../core/division.js';
import { positionGroups, ROLES, ROLE_GROUPS, normRole, setExtraPositions, linkTrades } from '../engine/positions.js';
import { chooseGroups, chosenValue } from './choose.js';
import { assign, unassign, activeProjects, accountOf } from '../engine/people.js';
import { ratingOf } from '../engine/hr.js';
import { tierOfTitle, tierOfPerson, positionsOf, tableOf, payOf, projectOfRow, directoryRows, moveTo, addedStamp, rankPatchFor, TIER_WORDS } from '../engine/manpower.js';
import { syncPages, sendRules } from './prices.js';
import { focusOn, relink } from './hr.js';
import { sendListsFor } from './reports.js';
import { tell } from '../core/image.js';
import { makeLink, linkUrl } from '../engine/crewform.js';
import { unlinked } from '../engine/people.js';
import * as fieldusers from './fieldusers.js';
import * as crewforms from './crewforms.js';
import { actions as hrActions } from './hr.js';

let search = '';
let table = 'staff';      // staff | crew | all | lists | new (v0.46.0: New crew for approval; v0.57.0: All people, Positions & trades)
const filt = { search: '', position: '', tier: '', project: '', status: 'active' };

/** The active members of a project's team, as the directory shows them. Pure. */
export const directoryOf = (team, projectName) => team.filter(m => m.active !== false && String(m.name || '').trim())
  .map(m => ({ name: m.name.trim(), position: m.role || '', project: projectName }))
  .sort((a, b) => a.name.localeCompare(b.name));

const full = () => store.role === 'owner';

export function render(c) {
  return full() ? manpower(c) : teamList(c);
}

function teamList(c) {
  const all = directoryOf(c.ws.team, c.project.name);
  const q = search.trim().toLowerCase();
  const shown = all.filter(r => !q || `${r.name} ${r.position}`.toLowerCase().includes(q));
  return html`<section class="card">
    <div class="toolbar"><h2>Staff directory</h2>
      <input class="search" type="search" data-chg="search" data-fk="dir-search" value="${search}" placeholder="Search a name or position" aria-label="Search the staff">
      <span class="grow"></span><span class="muted">${shown.length} of ${all.length}</span></div>
    <p class="muted">The people working on ${c.project.name}. Choose another project at the top to see its team.</p>
    ${shown.length ? html`<table class="table">
      <thead><tr><th>Name</th><th>Job position</th><th>Project</th></tr></thead>
      <tbody>${shown.map(r => html`<tr><td><b>${r.name}</b></td><td>${r.position}</td><td>${r.project}</td></tr>`)}</tbody>
    </table>` : html`<p class="empty">${all.length ? 'Nobody matches.' : 'Nobody is on this project yet.'}</p>`}
  </section>`;
}

const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const photo = p => (p.photo ? html`<img class="avatar" src="${p.photo}" alt="">` : html`<span class="avatar">${initials(p.name)}</span>`);
const PER = { month: '/ month', day: '/ day', hour: '/ hour' };

function row(p, i, c, edit) {
  const tier = tierOfPerson(p), more = positionsOf(p).slice(1), pay = payOf(p), r = ratingOf(p, c.company.evaluations || []);
  const proj = projectOfRow(p), names = activeProjects(p).map(id => store.projects.find(x => x.id === id)?.name).filter(Boolean);
  const dis = edit ? '' : 'disabled';
  return html`<tr class="${p.status === 'left' ? 'muted' : ''}">
    <td>${i + 1}</td>
    <td>${photo(p)}</td>
    <td><b>${p.name || 'No name yet'}</b>${p.nationality ? html`<br><span class="muted small">${p.nationality}</span>` : ''}</td>
    <td>${p.email || accountOf(p) || html`<span class="muted">—</span>`}</td>
    <td class="nowrap">${p.phone || html`<span class="muted">—</span>`}</td>
    <td><select data-chg="mpTitle" data-id="${p.id}" aria-label="Position of ${p.name}" ${dis}>${chooseGroups(positionGroups(p.title), normRole(p.title), 'No position')}</select>
      ${more.map(w => html`<span class="chip">${w}${edit ? html` <button type="button" class="mini" data-act="mpDropPos" data-id="${p.id}" data-w="${w}" aria-label="Remove ${w} from ${p.name}">✕</button>` : ''}</span>`)}
      ${edit && p.title ? html`<select data-chg="mpAddPos" data-id="${p.id}" aria-label="Another position for ${p.name}">${chooseGroups(positionGroups(), '', '+ Another position')}</select>` : ''}
      ${tier ? chip(TIER_WORDS[tier], tier === 4 ? '' : 'info') : chip('No tier', 'warn')}</td>
    <td><select data-chg="mpProject" data-id="${p.id}" aria-label="Project of ${p.name}" ${dis}>${options([['', 'No project'], ...(proj === '*' ? [['*', names.join(', ')]] : []), ...store.projects.map(x => [x.id, x.name])], proj)}</select></td>
    <td class="nowrap">${r == null ? html`<span class="muted">Not rated</span>` : html`${r.toFixed(1)} ★`}</td>
    <td class="nowrap">${pay ? `${money(pay.amount, pay.currency || c.global.fx.base)} ${PER[pay.per] || ''}` : html`<span class="muted">Not set</span>`}</td>
    <td>${p.addedBy || html`<span class="muted">—</span>`}${p.addedOn ? html`<br><span class="muted small">${p.addedOn}</span>` : ''}</td>
    <td class="nowrap">${edit ? html`<button type="button" class="btn small" data-act="mpEdit" data-id="${p.id}">Edit</button> <button type="button" class="btn ghost small" data-act="mpRemove" data-id="${p.id}">Remove</button>` : ''}</td>
    <td>${p.status === 'left' ? chip('Left', 'warn') : chip('Working', 'ok')}</td>
    <td><button type="button" class="btn ghost small" data-act="mpData" data-id="${p.id}">Employee data</button></td>
  </tr>`;
}

/** v0.57.0: the one list of positions and trades, by tier. Every position, tier and trade dropdown reads it; a new one is added here. */
function lists(edit) {
  const added = new Set((store.company?.extraPositions || []).map(x => x.name));
  return html`<div class="grid2">${ROLE_GROUPS.map(([g, l], i) => html`<div class="set-box"><h3>${g}</h3>
    <p>${l.map(w => chip(w, added.has(w) ? 'info' : ''))}</p></div>`)}</div>
    ${edit ? html`<form data-form="mpNewPos" class="entry"><input name="name" required placeholder="New position or trade" aria-label="New position or trade" class="wide">
      <select name="tier" aria-label="Tier">${options([1, 2, 3, 4, 5].map(t => [String(t), `Tier ${t}`]), '4')}</select><button class="btn primary">Add</button></form>` : ''}
    <p class="muted">Tier 4 and 5 positions are the site trades: Field Report, the day rates and the crew form links use them. The five tiers are fixed, as they decide who rates whom; a new position or trade goes in one of them.</p>`;
}

function manpower(c) {
  const staff = (c.company.staff || []).filter(p => p.division !== 'trading');
  const edit = store.isAdmin;
  const rows = directoryRows(staff, table, filt);
  const count = t => directoryRows(staff, t, { status: filt.status }).length;
  const sel = (f, label, list) => html`<select data-chg="mpFilt" data-f="${f}" data-fk="mp-f-${f}" aria-label="${label}">${options(list, filt[f])}</select>`;
  const used = [...new Set(staff.filter(p => table === 'all' || tableOf(p) === table).map(p => normRole(p.title)).filter(Boolean))];
  const positions = [...ROLES.filter(r => used.includes(r)), ...used.filter(r => !ROLES.includes(r))];
  return html`<section class="card" id="panel-manpower">
    <div class="toolbar"><h2>Manpower Directory</h2><span class="muted">The only place a person is added. Each person has an employee-data record.</span>
      <span class="grow"></span>${edit ? html`<button type="button" class="btn primary" data-act="mpAdd">+ Add a person</button>` : ''}</div>
    <div class="emp-tabs set-tabs" role="tablist">
      ${[['staff', 'Staff · Tiers 1, 2, 3 and 5'], ['crew', 'Crew · Tier 4'], ['all', 'All people'], ['lists', 'Positions & trades'], ['new', 'New crew for approval']].map(([k, label]) => html`<button type="button" role="tab" class="tab ${table === k ? 'on' : ''}" data-act="mpTable" data-t="${k}" aria-selected="${table === k ? 'true' : 'false'}">${label} <span class="badge">${k === 'new' ? newCount(c) : k === 'lists' ? ROLES.length : count(k)}</span></button>`)}
    </div>
    ${table === 'new' ? newCrew(c) : table === 'lists' ? lists(edit) : html`
    <div class="toolbar wrap">
      <input class="search" type="search" data-chg="mpFilt" data-f="search" data-fk="mp-search" value="${filt.search}" placeholder="Search name, position, phone, email" aria-label="Search the directory">
      ${sel('position', 'Position', [['', 'Every position'], ...positions.map(x => [x, x])])}
      ${table === 'staff' ? sel('tier', 'Tier', [['', 'Every tier'], ['1', 'Tier 1'], ['2', 'Tier 2'], ['3', 'Tier 3'], ['5', 'Tier 5']]) : table === 'all' ? sel('tier', 'Tier', [['', 'Every tier'], ...[1, 2, 3, 4, 5].map(t => [String(t), `Tier ${t}`])]) : ''}
      ${sel('project', 'Project', [['', 'Every project'], ...store.projects.map(x => [x.id, x.name])])}
      ${sel('status', 'Status', [['active', 'Working'], ['left', 'Left'], ['all', 'All']])}
      <span class="grow"></span><span class="muted">${rows.length} shown</span>
    </div>
    ${rows.length ? html`<div class="table-wrap"><table class="table compact mp-table">
      <thead><tr><th>No.</th><th>Photo</th><th>Person</th><th>Email</th><th>Phone</th><th>Position &amp; Tier</th><th>Project</th><th>Rating</th><th>${table === 'crew' ? 'Wage' : table === 'all' ? 'Pay' : 'Salary'}</th><th>Added by</th><th>Edit / Remove</th><th>Status</th><th>Employee data</th></tr></thead>
      <tbody>${rows.map((p, i) => row(p, i, c, edit))}</tbody>
    </table></div>` : html`<p class="empty">${count(table) ? 'Nobody matches.' : table === 'crew' ? 'No crew yet. Add a person and choose a Tier 4 position.' : 'Nobody yet. Add the first person with "+ Add a person".'}</p>`}
    <p class="muted">Changing a position or a project asks first. Wages and salaries are set in Employee data (Pay); they are never shown to Site users.</p>`}
  </section>`;
}

// ---- v0.46.0: New crew for approval: every name the directory does not know yet, in one place ----

let asked = 0;
const formsWaiting = c => (c.company.crewforms || []).filter(f => f.status === 'new');
const looseTeam = c => (c.ws?.team ? unlinked(c.ws.team).filter(m => m.active !== false && String(m.name || '').trim()) : []);
const newCount = c => formsWaiting(c).length + fieldusers.crewWaiting().length + looseTeam(c).length;

function newCrew(c) {
  // the site crew comes with the Field Report feed: asked at most once a minute from here, even when it fails
  if (store.cloud && Date.now() - asked > 60e3) { asked = Date.now(); fieldusers.load(); }
  const forms = formsWaiting(c), site = fieldusers.crewWaiting(), loose = looseTeam(c), edit = store.isAdmin;
  const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  const rows = [
    ...forms.map(f => ({ name: f.name, trade: f.trade, from: 'Crew form', project: (c.company.crewlinks || []).find(l => l.id === f.link)?.projectName || '', at: f.at,
      act: html`<button type="button" class="btn small primary" data-act="mpForms">Review the form</button>` })),
    ...site.map(r => ({ name: r.name, trade: r.trade, from: `Field Report${r.by ? `, ${r.by}` : ''}`, project: r.proj, at: r.at,
      act: html`<button type="button" class="btn small primary" data-act="fuCrew" data-p="${r.proj}" data-id="${r.id}" data-v="approve">Approve</button> <button type="button" class="btn small ghost" data-act="fuCrew" data-p="${r.proj}" data-id="${r.id}" data-v="reject">Reject</button>` })),
    ...loose.map(m => ({ name: m.name, trade: m.role, from: 'Project team list', project: c.project.name, at: '', act: '' })),
  ];
  return html`<p class="muted">Names typed in Field Report or Central Hub, and forms people filled in, that are not in the directory yet. Approving adds the person to the directory and to the project.</p>
    ${rows.length ? html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Name</th><th>Trade</th><th>From</th><th>Project</th><th>Sent</th><th></th></tr></thead>
      <tbody>${rows.map(r => html`<tr><td><b>${r.name}</b></td><td>${r.trade || html`<span class="muted">—</span>`}</td><td>${r.from}</td><td>${r.project || html`<span class="muted">—</span>`}</td><td class="nowrap">${when(r.at)}</td><td class="nowrap">${edit ? r.act : ''}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="empty">Nobody is waiting.</p>`}
    ${loose.length && edit ? html`<div class="actions left"><button type="button" class="btn small" data-act="mpFromTeam">Add the ${loose.length} from ${c.project.name}'s team list to the directory</button></div>` : ''}
    ${store.cloud && fieldusers.isBusy() ? html`<p class="muted">Asking Field Report for the crew sent from site…</p>` : ''}`;
}

/**
 * v0.47.0 "+ Add a position": a name not in the list is added to it with the tier the Admin or GM gives
 * (company.extraPositions). Returns the position, '' for none, or null when nothing is to be done.
 */
function known(value) {
  if (value === null || value === '' || tierOfTitle(value)) return value;
  if (!(store.isAdmin || (store.profile?.ranks || []).includes('general_manager'))) { tell('Only the Admin or the General Manager adds a position.'); return null; }
  const t = Number((typeof prompt === 'function' ? prompt(`"${value}" is a new position. Its tier (1 to 5)?\n1 Owner, GM · 2 Project Engineer, Accountant, HR · 3 Site Engineer, Foreman, office · 4 daily crew · 5 Security`) : '') || 0);
  if (![1, 2, 3, 4, 5].includes(t)) { tell('Not added: the tier must be 1, 2, 3, 4 or 5.'); return null; }
  store.updateCompany(co => { co.extraPositions = [...(co.extraPositions || []).filter(x => x.name !== value), { name: value, tier: t }]; });
  setExtraPositions([...(store.company?.extraPositions || []), { name: value, tier: t }]);
  tell(`✓ "${value}" added to the positions, ${TIER_WORDS[t]}.`);
  return value;
}

/** v0.45.1, v0.47.0: the sign-in follows all the person's positions: its ranks (highest tier first), pages and access rules. */
function signIn(id, c) {
  const p = find(c, id);
  const u = p && accountOf(p) && store.users.find(x => x.email === accountOf(p));
  if (!u) return;
  const patch = rankPatchFor(positionsOf(p));
  store.setUser(u.email, patch); syncPages([{ ...u, ...patch }]); sendRules();
}

const find = (c, id) => (c.company.staff || []).find(p => p.id === id);
const ask = text => confirm(`${text}\n\nPress OK to apply, Cancel to leave it as it is.`);

/** Tell each project that gained or lost the person, and Field Report with it; the sign-in follows. */
function follow(person, on, off, a) {
  for (const [pid, isOn] of [...on.map(id => [id, true]), ...off.map(id => [id, false])]) {
    const project = store.projects.find(x => x.id === pid);
    const entry = a.find(x => x.projectId === pid);
    Promise.resolve(store.updateOther(pid, ws => (isOn ? assign(ws, person, entry) : unassign(ws, person))))
      .then(ws => sendListsFor(project, ws)).catch(() => {});
    relink(person, pid, isOn);
  }
}

export const actions = {
  mpTable(el) { table = el.dataset.t; filt.position = ''; filt.tier = ''; },
  mpAdd(el, c) {
    const name = (typeof prompt === 'function' ? prompt('Full name of the new person:') : '') || '';
    if (!name.trim()) return;
    const p = { id: uid('st'), name: name.trim(), title: table === 'crew' ? 'Labourer' : '', department: '', projectId: '', status: 'active', started: c.today,
      agreement: {}, documents: [], notes: '', level: 'crew', accountEmail: '', assignments: [], ...stamp(), ...addedStamp(store.profile?.name || store.user?.name || store.user?.email, c.today) };
    store.updateCompany(co => co.staff.push(p));
    // v0.46.0: the person may fill in their own details (Fayda ID or passport, photo) with a 7-day link
    if (!confirm(`${p.name} is added. Send them a link to fill in their own details (photo, Fayda ID or passport)?`)) return tell(`✓ ${p.name} added. Choose the position and project in the row.`);
    const l = makeLink({ kind: 'one', name: p.name, trades: linkTrades(), by: store.user?.email || 'local', byName: store.signature || store.user?.name || '' });
    store.updateCompany(co => { (co.crewlinks ||= []).push(l); });
    const url = `${linkUrl(l.id, location.hostname === 'localhost' ? `${location.origin}/` : 'https://hub.amistadprefab.com/')}${store.cloud ? '' : '&local'}`;
    Promise.resolve(navigator.clipboard?.writeText(url)).then(() => tell(`✓ ${p.name} added. Their link is copied: paste it in WhatsApp, Telegram or an email. It works 7 days; the form comes back under New crew for approval.`), () => tell(`✓ ${p.name} added. Their link: ${url}`));
  },
  mpForms() { crewforms.openReview(); location.hash = '#crewforms'; },
  mpFromTeam: (...a) => hrActions.fromTeam(...a),
  fuCrew: (...a) => fieldusers.actions.fuCrew(...a),
  mpDropPos(el, c) {
    const p = find(c, el.dataset.id), w = el.dataset.w;
    if (!p || !ask(`Take the position ${w} away from ${p.name}?`)) return;
    store.updateCompany(co => { const x = co.staff.find(y => y.id === p.id); x.titles = positionsOf(x).slice(1).filter(v => v !== w); });
    signIn(p.id, c);
  },
  mpEdit(el) { focusOn(el.dataset.id, 'work'); location.hash = '#hr'; },
  mpData(el) { focusOn(el.dataset.id, 'private'); location.hash = '#hr'; },
  mpRemove(el, c) {
    const p = find(c, el.dataset.id);
    if (!p || !confirm(`Remove ${p.name || 'this person'} from the directory, with their employee data? To keep the record of someone who has left, set them to Left in Employee data instead.`)) return;
    const was = activeProjects(p);
    store.updateCompany(co => { co.staff = co.staff.filter(x => x.id !== p.id); });
    follow(p, [], was, []);
  },
};

export const changes = {
  search(el) { search = el.value; },
  mpFilt(el) { filt[el.dataset.f] = el.value; },
  mpTitle(el, c) {
    const p = find(c, el.dataset.id);
    const value = known(chosenValue(el, 'position'));
    if (!p || value === null || value === normRole(p.title)) { store.notify(); return; }
    const t = tierOfTitle(value);
    if (!ask(`Make ${p.name} ${value || 'no position'}${t ? ` (${TIER_WORDS[t]})` : ''}? It was ${p.title || 'no position'}.`)) { store.notify(); return; }
    let a = [];
    store.updateCompany(co => {
      const x = co.staff.find(y => y.id === p.id);
      x.title = value;
      x.titles = (x.titles || []).map(normRole).filter(w => w && w !== value);   // the others stay
      x.assignments = (x.assignments || []).map(y => (y.active !== false ? { ...y, role: value } : y));
      a = x.assignments;
    });
    // v0.45.1: the sign-in follows the position: its title (rank), and so its pages and access rules
    const u = accountOf(p) && store.users.find(x => x.email === accountOf(p));
    signIn(p.id, c);
    const live = a.filter(y => y.active !== false);
    for (const y of live) store.updateOther(y.projectId, ws => assign(ws, { ...p, title: value }, y));
    if (tableOf(find(c, p.id) || {}) !== table) tell(`✓ ${p.name} is now in the ${table === 'crew' ? 'Staff' : 'Crew'} table.`);
  },
  /** v0.47.0: one more position; the highest tier of all counts. */
  mpAddPos(el, c) {
    const p = find(c, el.dataset.id);
    const value = known(chosenValue(el, 'position'));
    if (!p || !value || positionsOf(p).includes(value)) { store.notify(); return; }
    const t = tierOfTitle(value);
    if (!ask(`Give ${p.name} the position ${value}${t ? ` (${TIER_WORDS[t]})` : ''} as well? Main position stays ${p.title}.`)) { store.notify(); return; }
    store.updateCompany(co => { const x = co.staff.find(y => y.id === p.id); x.titles = [...positionsOf(x).slice(1), value]; });
    signIn(p.id, c);
  },
  mpProject(el, c) {
    const p = find(c, el.dataset.id);
    if (!p || el.value === '*') { store.notify(); return; }
    const pn = store.projects.find(x => x.id === el.value)?.name;
    const was = activeProjects(p).map(id => store.projects.find(x => x.id === id)?.name).filter(Boolean);
    if (!ask(el.value ? `Put ${p.name} on ${pn}${was.length ? `, and take them off ${was.join(', ')}` : ''}?` : `Take ${p.name} off ${was.join(', ') || 'every project'}?`)) { store.notify(); return; }
    const m = moveTo(p, el.value);
    store.updateCompany(co => { const x = co.staff.find(y => y.id === p.id); x.assignments = m.assignments; });
    follow(p, m.on, m.off, m.assignments);
  },
};

export const submits = {
  /** v0.57.0: a new position or trade, under the tier chosen, from the Positions & trades tab. */
  mpNewPos(fd) {
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' ');
    const t = Number(fd.get('tier'));
    if (!name || ![1, 2, 3, 4, 5].includes(t)) return false;
    if (!(store.isAdmin || (store.profile?.ranks || []).includes('general_manager'))) { tell('Only the Admin or the General Manager adds a position.'); return false; }
    if (ROLES.some(r => r.toLowerCase() === name.toLowerCase()) || tierOfTitle(normRole(name))) { tell(`"${name}" is already in the list.`); return false; }
    const list = [...(store.company?.extraPositions || []).filter(x => x.name !== name), { name, tier: t }];
    store.updateCompany(co => { co.extraPositions = list; });
    setExtraPositions(list);
    tell(`✓ "${name}" added to the positions, ${TIER_WORDS[t]}.`);
  },
};
