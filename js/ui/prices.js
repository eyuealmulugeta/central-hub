import { store } from '../core/store.js';
import { ALLOWED, isForeign, foreignSummary, convertGlobal, convertProject, convertCompany } from '../engine/currencies.js';
import { uid } from '../core/util.js';
import { html, options, field } from './dom.js';
import * as fieldsetup from './fieldsetup.js';
import * as fieldprojects from './fieldprojects.js';
import * as fieldusers from './fieldusers.js';
import { PROJECT_TYPES } from '../core/seed.js';
import { GRANTABLE, GRANT_GROUPS, SWITCHABLE, APPS, appOn, pagesOf, pageOn, grantableFor, tickPage, defaultPages, MONEY_PAGES } from '../core/access.js';
import { icon } from './dom.js';
import { record as recordFault } from '../core/diagnostics.js';
import { checkPack, packSummary, applyToWorkspace, applyToCompany, applyToProject } from '../core/pack.js';
import { OWNER_SECTIONS } from '../core/schema.js';
import { LEVELS, levelOf, levelLabel } from '../engine/evaluation.js';
const SHORT_TIERS = LEVELS.map(([k]) => [k, `Tier ${k.slice(1)}`]);
import { positionGroups } from '../engine/positions.js';
import { chooseGroups, groupOptions, chosenValue } from './choose.js';
import { TITLES, GROUPS, ONE_PROJECT, titleOf, titleLabel, titlePatch, mayJoin, mayTake } from '../engine/titles.js';
import { DIVISIONS, divisionsOf } from '../core/nav.js';
import { pictureFor, sizeNote, tell, LOGO } from '../core/image.js';
import { assign, unassign, dayRateOf, setDayRate, assignmentOf, unlinked, accountOf, activeProjects } from '../engine/people.js';
import { focusOn as focusPerson, relink } from './hr.js';
import { describe as describeSession } from '../engine/session.js';
import { targetFor, parseDates } from '../engine/calendar.js';
import { STATUSES, statusLabel, activitiesOf, parseList, isLimited, assignedUsers, LIMITS } from '../engine/deployment.js';
import { money, num, fmtFull } from '../core/util.js';
import { PAY_PERIODS, payPeriodOf, weekStartOf } from '../engine/attendance.js';
import { monthlyRolesOf } from '../engine/crewpay.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ROLES = [['office', 'Office: works from the office, on the projects ticked'], ['site', 'Site: works on site, on the projects ticked (active ones only)']];
const PAGE_NAME = Object.fromEntries(GRANTABLE);

// Settings is five pages, one per tab: this project, people and access, currencies,
// company details, and Field Report and import. Each shows its cards in full, so nothing has to
// be unfolded and nothing moves when a value is changed.
let section = 'prices';
export const setSection = s => { section = s; };
export const getSection = () => section;
/** All the text of a Settings page, every tab of it, for the search (one tab is on screen at a time). Put back as it was. */
export function indexText(c) {
  const keep = { projTab, accTab, linkTab };
  const parts = [];
  const tabs = section === 'prices' ? ['projTab', PROJ_TABS.map(t => t[0])] : section === 'access' ? ['accTab', ['people', 'crew', 'perms', 'you', 'problems']] : section === 'links' ? ['linkTab', ['field', 'projects', 'import']] : null;
  try {
    for (const k of tabs ? tabs[1] : [null]) {
      if (tabs) ({ projTab, accTab, linkTab } = { ...keep, [tabs[0]]: k });
      parts.push(String(render(c)));
    }
  } finally { ({ projTab, accTab, linkTab } = keep); }
  return parts.join(' ');
}
const SECTION_OF = { fx: 'catalog', company: 'company', monthly: 'company', field: 'links', import: 'links' };
/** Jump to the tab that holds a card (Setup's "Do this" buttons use the card's id). */
const PANEL_TAB = { project: 'basics', deploy: 'site', team: 'team', linked: 'team', rates: 'week' };
export const openPanel = id => { if (PANEL_TAB[id]) projTab = PANEL_TAB[id]; };
// Two pages are split in tabs: This project (Basics, Site, Team, Calendar and rates) and People and access
// (People, You, Problems). One tab is on screen at a time, so a page is short and nothing has to be scrolled past.
const PROJ_TABS = [['basics', 'Basics'], ['site', 'Site and deployment'], ['team', 'Team'], ['week', 'Calendar and rates']];
let projTab = 'basics';
let accTab = 'people';
let linkTab = 'field';
let who = null;                 // the email of the person open on the People tab
const tabStrip = (list, now, act) => html`<div class="emp-tabs set-tabs" role="tablist">${list.map(([k, label, n]) => html`
  <button type="button" role="tab" class="tab ${now === k ? 'on' : ''}" data-act="${act}" data-t="${k}" aria-selected="${now === k ? 'true' : 'false'}">${label}${n ? html` <span class="badge">${n}</span>` : ''}</button>`)}</div>`;
const box = (id, title, body, sub = '') => html`<section class="card set-box" id="panel-${id}"><h3>${title}${sub ? html` <span class="muted">${sub}</span>` : ''}</h3>${body}</section>`;
/** A row of tick boxes drawn as small pills. */
const pills = list => html`<div class="pills">${list}</div>`;
const panel = (id, title, sub, body) => (SECTION_OF[id] !== section ? '' : html`
  <section class="card" id="panel-${id}">
    <div class="toolbar"><h2>${title}</h2><span class="muted">${sub}</span></div>
    ${body()}
  </section>`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The pages of Settings, listed down the left with their icons, the way a settings screen
// usually is: the list stays put and only the right side changes.
const NAV = [['apps', 'Apps', 'apps'], ['prices', 'This project', 'dashboard'], ['access', 'People and access', 'access'],
  ['catalog', 'Currencies', 'ledger'], ['company', 'Company details', 'company'], ['links', 'Field Report and import', 'links']];
const link = ([k, label, ic]) => html`
      <a href="#${k}" class="side-link ${k === section ? 'on' : ''}" ${k === section ? html`aria-current="page"` : ''}>${icon(ic)}<span>${label}</span>${k === 'access' && store.requests.length ? html`<em title="Waiting for your approval">${store.requests.length}</em>` : ''}</a>`;
// v0.24.0: My settings for everyone, then the Admin settings (backup and clear cache are the Admin's tools)
const nav = () => html`
  <nav class="card set-nav" aria-label="Settings pages">
    <div class="set-group">My settings</div>
    ${link(['mine', 'My settings', 'access'])}
    ${store.isAdmin ? html`<div class="set-group">Admin settings</div>
    ${NAV.map(link)}
    <hr>
    <button type="button" class="side-link" id="btn-backup">${icon('backup')}<span>Backup</span></button>
    <button type="button" class="side-link" id="btn-clear-cache" title="Fixes a page that looks old or broken. Your records are kept.">${icon('backup')}<span>Clear cache</span></button>` : ''}
  </nav>`;

const THEMES = [['auto', 'Same as this device'], ['light', 'Light'], ['dark', 'Dark']];
const themeNow = () => { try { return localStorage.getItem('sf:theme') || 'auto'; } catch { return 'auto'; } };
let problemNotice = '';
const flushNow = () => dispatchEvent(new Event('hub-faults'));
/** v0.24.0: My settings, for everyone: theme, notifications, sign out and report a problem. */
function minePage() {
  const t = themeNow();
  const notif = typeof Notification === 'undefined' ? 'none' : Notification.permission;
  return html`<div class="side settings">
    <div class="set-head"><h2>My settings</h2><span class="muted">${store.cloud ? store.user?.email || '' : 'Demo'}</span></div>
    <div class="set-cols">
      ${box('theme', 'Look', html`<div class="seg" role="group" aria-label="Theme">${THEMES.map(([k, label]) => html`<button type="button" class="${t === k ? 'on' : ''}" aria-pressed="${t === k}" data-act="setTheme" data-t="${k}">${label}</button>`)}</div>`)}
      ${box('notify', 'Notifications', html`
        <p class="muted">${notif === 'granted' ? 'On for this device.' : notif === 'denied' ? 'Blocked in this browser. Allow notifications for this site in the browser settings, then reload.' : notif === 'none' ? 'This browser cannot show notifications.' : 'Off for this device.'}</p>
        ${notif === 'default' ? html`<button type="button" class="btn" data-act="askNotify">Turn on for this device</button>` : ''}`)}
      ${box('problem', 'Report a problem', html`
        <form data-form="reportProblem" class="entry">
          <textarea name="what" rows="3" required placeholder="What went wrong, and on which page?" aria-label="What went wrong" class="wide"></textarea>
          <button class="btn">Send to the Admin</button>
        </form>
        ${problemNotice ? html`<p class="ok">${problemNotice}</p>` : ''}`)}
      ${store.cloud ? box('signout', 'Sign out', html`<p class="muted">Signed in as ${store.user?.email || ''} on this device.</p><button type="button" class="btn" data-act="signOutHere">Sign out</button>`) : ''}
    </div>
  </div>`;
}

let rulesNotice = '';
let transferNotice = '';
let coOwnerNotice = '';
let fxNotice = '';
let coOwnerBad = false;
let pack = null;        // a data pack that has been chosen and is waiting for confirmation
let packFor = '';       // the project that was open when it was chosen: it is imported there and nowhere else
let packNotice = '';
let packBad = false;
const SETTING_NAME = { currency: 'currency', contractValue: 'contract value' };

/** Preview of a chosen data pack, and the button that merges it into the open project. */
function importBody(c) {
  const p = c.project;
  const chooser = html`
    <p class="muted">A data pack is a file prepared from your Excel sheets. Choosing one only shows what is in it: nothing is saved until you confirm.</p>
    <label class="btn">Choose a data pack<input type="file" accept="application/json,.json" data-chg="pack" hidden></label>
    ${packNotice ? html`<p class="${packBad ? 'bad' : 'ok'}">${packNotice}</p>` : ''}`;
  if (!pack) return chooser;

  const s = packSummary(pack);
  const m = v => money(v, s.currency || p.currency, 2);
  const line = (n, text) => (n ? html`<li>${text}</li>` : '');
  const changes = Object.entries(pack.project || {}).filter(([k, v]) => typeof v !== 'object' && p[k] !== v);
  return html`
    <h3>${s.title}</h3>
    <p class="muted">From ${s.source || 'an unnamed file'}${s.made ? `, prepared ${fmtFull(s.made)}` : ''}. It will be added to <b>${p.name}</b>.</p>
    <ul class="plain">
      ${line(s.reports, `${s.reports} daily reports, ${fmtFull(s.from)} to ${fmtFull(s.to)}, ${num(s.personDays)} person-days`)}
      ${line(s.invoices, `${s.invoices} invoices: ${m(s.invoiced)} issued${s.drafts ? `, ${m(s.drafts)} still a draft` : ''}`)}
      ${line(s.payments, `${s.payments} payments received, ${m(s.received)}`)}
      ${line(s.costs, `${s.costs} cost entries, ${m(s.spent)}`)}
      ${line(s.tasks, `${s.tasks} schedule tasks`)}
      ${line(s.team, `${s.team} team members`)}
      ${line(s.rates, `${s.rates} client day rates`)}
      ${line(s.shipments, `${s.shipments} shipments`)}
      ${line(s.contracts, `${s.contracts} contracts`)}
      ${line(s.staff, store.role === 'owner' ? `${s.staff} HR records` : `${s.staff} HR records, left out: only the Owner can import those`)}
    </ul>
    ${changes.length ? html`<p><b>Project settings that change:</b> ${changes.map(([k, v]) => `${SETTING_NAME[k] || k} from ${p[k] ?? 'none'} to ${v}`).join('; ')}.${pack.project.billing ? ' Billing terms are set to those of the pack.' : ''}</p>` : ''}
    ${changes.some(([k]) => k === 'currency') ? html`<p class="bad">The project's currency changes. Invoices and amounts already in this project are not converted, so import into a project that holds no real figures yet.</p>` : ''}
    ${s.notes.length ? html`<details class="setup" open><summary>Notes from the conversion</summary><ul class="plain">${s.notes.map(n => html`<li class="muted">${n}</li>`)}</ul></details>` : ''}
    <div class="actions left">
      ${packFor && packFor !== p.id ? html`<p class="bad">This pack was chosen while "${store.projects.find(x => x.id === packFor)?.name || 'another project'}" was open. Choose it again for ${p.name}, or go back to that project.</p>` : ''}
      <button class="btn primary" data-act="importPack" ${packFor && packFor !== p.id ? 'disabled' : ''}>Import into ${p.name}</button>
      <button class="btn ghost" data-act="dropPack">Cancel</button>
    </div>
    <p class="muted">Importing the same pack again replaces what it added the first time. It does not duplicate.</p>`;
}

const MARKUPS = [['overhead', 'Overhead'], ['contingency', 'Contingency'], ['profit', 'Profit'], ['vat', 'VAT']];

/** Problems the devices reported, for the Admin. */
function diagBody() {
  const list = store.faults.slice(0, 30);
  return html`
    <p class="muted">When something breaks on a phone or computer, it is saved quietly and sent here when that device is online. The person sees nothing. Send this list to whoever maintains Central Hub.</p>
    ${list.length ? html`<table class="table compact">
      <thead><tr><th>When</th><th>Who</th><th>Where</th><th>Problem</th><th class="r">Times</th></tr></thead>
      <tbody>${list.map(f => html`<tr><td class="nowrap">${String(f.at).slice(0, 16).replace('T', ' ')}</td><td>${f.by}</td><td>${f.where} <span class="muted">${f.page}</span></td><td>${f.message}</td><td class="r">${f.count || 1}</td></tr>`)}</tbody>
    </table>
    <div class="actions left"><button class="btn small" data-act="clearFaults">Clear the list</button></div>` : html`<p class="muted">Nothing reported.</p>`}`;
}

const initialsOf = text => String(text || '?').trim().split(/[\s@.]+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const ROLE_NAME = { office: 'Office', site: 'Site' };

/** The person open on the People tab: the one chosen, else the first. */
const openUser = () => store.users.find(u => u.email === who) || store.users[0] || null;

/** One title, from the one list for everybody. An older free-text title that is not in the list is shown and kept until another is chosen. */
function titleSelect(u) {
  const key = titleOf(u);
  const old = !key && u.title ? u.title : '';
  return html`<select class="emp-job" data-chg="userTitle" data-id="${u.email}" data-fk="ut-${u.email}" aria-label="Title of ${u.email}">
    <option value="" ${key ? '' : 'selected'}>${old ? `${old} (not in the list)` : 'Choose a title…'}</option>
    ${GROUPS.map(g => html`<optgroup label="${g}">${options(TITLES.filter(t => t[2] === g).map(([k, label]) => [k, label]), key || null)}</optgroup>`)}</select>`;
}

/** The pages a person may open, ticked in groups, with a way back to what a role starts with. */
function pageTicks(u) {
  const may = grantableFor(u).map(([k]) => k);
  const have = pagesOf(u);
  const money = MONEY_PAGES.filter(k => have.includes(k));
  return html`
    ${GRANT_GROUPS.map(([g, list]) => {
      const here = list.filter(([k]) => may.includes(k));
      return here.length ? html`<h4 class="tick-group">${g}</h4>${pills(here.map(([k, label]) => html`<label class="check pill"><input type="checkbox" data-chg="userPage" data-id="${u.email}" data-p="${k}" ${have.includes(k) ? 'checked' : ''}> ${label}</label>`))}` : '';
    })}
    ${u.role === 'site' && money.length ? html`<p class="bad">This Site person sees the money of their projects (${money.map(k => PAGE_NAME[k]).join(', ')}). With Costs ticked they also enter costs; with Invoices and documents, drafts only.</p>` : ''}
    <div class="actions left">
      <button class="btn small ghost" type="button" data-act="resetPages" data-id="${u.email}" data-r="site">Site defaults</button>
      <button class="btn small ghost" type="button" data-act="resetPages" data-id="${u.email}" data-r="office">Office defaults</button>
    </div>
    <p class="muted">HR, Payroll, Letters, Company owners and Settings stay yours alone. Home and Discuss are open to everyone.</p>`;
}

function personDetail(u) {
  const s = store.sessions.find(x => x.email === u.email && !x.released);
  return html`
    <section class="card person" id="panel-person">
      <header class="person-head">
        <span class="who-avatar big">${initialsOf(u.name || u.email)}</span>
        <div class="person-id">
          <input class="emp-name" data-chg="userField" data-id="${u.email}" data-f="name" data-fk="un-${u.email}" value="${u.name || ''}" placeholder="Full name" aria-label="Name of ${u.email}">
          ${titleSelect(u)}
          <span class="muted">${u.email}</span>
        </div>
        <button class="btn ghost small" data-act="removeUser" data-id="${u.email}">Remove access</button>
      </header>

      <div class="set-cols">
        <div class="set-box">
          <h3>Role</h3>
          <select data-chg="userRole" data-id="${u.email}" data-fk="ur-${u.email}" aria-label="Role of ${u.email}">${options(ROLES, u.role)}</select>
          <h3>Division <span class="muted">signs in to this one only</span></h3>
          <select data-chg="userDivision" data-id="${u.email}" data-fk="ud-${u.email}" aria-label="Division of ${u.email}">${divisionsOf(u).length ? '' : html`<option value="">Not assigned: cannot sign in</option>`}${options(DIVISIONS, divisionsOf(u)[0] || null)}</select>
          <h3>Signed in</h3>
          ${s ? html`<div class="split"><span class="muted">${describeSession(s)}</span><button class="btn small" data-act="resetSession" data-id="${u.email}" title="Ends that session so this person can sign in on another device">Reset session</button></div>`
            : html`<span class="muted">Not signed in on any device</span>`}
        </div>

        <div class="set-box">
          <h3>Pages this person may open</h3>
          ${pageTicks(u)}
          ${u.role === 'office' ? html`<label class="check"><input type="checkbox" data-chg="userApprover" data-id="${u.email}" ${u.approver ? 'checked' : ''}> May approve and issue client reports</label>` : ''}
          <h3>Projects <span class="muted">${ONE_PROJECT.includes(titleOf(u)) ? `a ${titleLabel(titleOf(u))} is on one only` : 'one or several'}</span></h3>
          ${pills(store.projects.map(p => html`<label class="check pill"><input type="checkbox" data-chg="userProject" data-id="${u.email}" data-p="${p.id}" ${(u.projects || []).includes(p.id) ? 'checked' : ''}> ${p.name}</label>`))}
          ${(u.projects || []).length ? '' : html`<p class="bad">Not on any project: they sign in and see nothing yet.</p>`}
        </div>
      </div>
    </section>`;
}

function peopleTab() {
  const list = store.users;
  const u = openUser();
  return html`
    ${store.requests.length ? html`
      <div class="requests">
        <h3>Waiting for your approval <span class="badge">${store.requests.length}</span></h3>
        <p class="muted">These people signed in but cannot open anything yet. Approve only addresses you recognise.</p>
        <ul class="list">${store.requests.map(r => html`
          <li class="split">
            <span><b>${r.name || r.email}</b> <span class="muted">${r.name ? `${r.email}, ` : ''}asked ${fmtFull(String(r.at || '').slice(0, 10))}</span></span>
            <span class="actions">
              <select class="req-dept" aria-label="Division of ${r.email}"><option value="">Choose division…</option>${options(DIVISIONS, null)}</select>
              <button class="btn small primary" data-act="answer" data-id="${r.email}" data-r="site">Approve as Site</button>
              <button class="btn small" data-act="answer" data-id="${r.email}" data-r="office">Approve as Office</button>
              <button class="btn ghost small" data-act="answer" data-id="${r.email}" data-r="">Decline</button>
            </span>
          </li>`)}</ul>
      </div>` : ''}
    <div class="people-grid">
      <aside class="card people-list">
        <form data-form="user" class="add-person">
          <input type="email" name="email" placeholder="Add: name@gmail.com" required aria-label="Google account email">
          <input name="name" placeholder="Full name" aria-label="Full name">
          <select name="role" aria-label="Role">${options([['site', 'Site'], ['office', 'Office']], 'site')}</select>
          <select name="division" required aria-label="Division"><option value="">Choose division…</option>${options(DIVISIONS, null)}</select>
          <select name="projectId" class="span2" aria-label="Link to a project"><option value="">No project yet</option>${options(store.projects.map(p => [p.id, `Link to ${p.name}`]), null)}</select>
          <button class="btn primary span2">Add person</button>
        </form>
        ${list.length ? html`<p class="muted pad-s">Switch on to link a person to <b>${store.project?.name || 'the open project'}</b>.</p><ul class="who-list">${list.map(x => {
          const live = store.sessions.some(s => s.email === x.email && !s.released);
          const linkedHere = (x.projects || []).includes(store.project?.id);
          return html`<li class="pwho-row ${u && x.email === u.email ? 'on' : ''}"><button type="button" class="pwho" data-act="pickUser" data-id="${x.email}">
            <span class="who-avatar">${initialsOf(x.name || x.email)}</span>
            <span class="who-text"><b>${x.name || x.email}</b><span class="muted">${x.title || x.email}</span></span>
            ${divisionsOf(x).length ? html`<span class="chip ${x.role === 'office' ? 'info' : ''}">${ROLE_NAME[x.role] || x.role}</span>` : html`<span class="chip warn" title="Cannot sign in until a division is chosen">No division</span>`}
            <i class="dot ${live ? 'live' : ''}" title="${live ? 'Signed in now' : 'Not signed in'}"></i>
          </button>
          <label class="switch" title="${linkedHere ? 'Linked to this project. Switch off to unlink' : 'Switch on to link to this project'}"><input type="checkbox" data-chg="userLink" data-id="${x.email}" ${linkedHere ? 'checked' : ''} aria-label="Linked to ${store.project?.name || 'the open project'}"><i></i></label></li>`;
        })}</ul>` : html`<p class="muted pad">Nobody else has access yet. Add the first person above.</p>`}
      </aside>
      ${u ? personDetail(u) : html`<section class="card"><p class="empty">Add a person to give them access.</p></section>`}
    </div>`;
}

/** Every person and every app in one table: the permission list for all roles. */
function permsTab() {
  const list = store.users;
  if (!list.length) return html`<section class="card"><p class="empty">Nobody else signs in yet. Add people on the People tab.</p></section>`;
  const order = [['office', 'Office'], ['site', 'Site']];
  const roleOf = u => (u.role === 'office' ? 'office' : 'site');
  return html`<section class="card" id="panel-perms">
    <div class="toolbar"><h2>Permissions</h2><span class="muted">Each person and each app: tick to let them open it. It applies on the projects they are on.</span></div>
    <div class="table-wrap"><table class="table compact perm-table">
      <thead>
        <tr><th colspan="2"></th>${GRANT_GROUPS.map(([g, l]) => html`<th class="c grp" colspan="${l.length}">${g}</th>`)}</tr>
        <tr><th>Person</th><th>Role</th>${GRANTABLE.map(([, label]) => html`<th class="c">${label}</th>`)}</tr>
      </thead>
      <tbody>${order.map(([r, rl]) => list.filter(u => roleOf(u) === r).map(u => {
        const may = grantableFor(u).map(([k]) => k), have = pagesOf(u), name = u.name || u.email;
        return html`<tr>
          <th scope="row"><button type="button" class="linklike" data-act="openUser" data-id="${u.email}" title="Open ${name} on the People tab">${name}</button></th><td>${rl}</td>
          ${GRANTABLE.map(([k, label]) => html`<td class="c">${may.includes(k) ? html`<input type="checkbox" data-chg="userPage" data-id="${u.email}" data-p="${k}" ${have.includes(k) ? 'checked' : ''} aria-label="${label} for ${name}">` : html`<span class="muted" title="Not for Installation">–</span>`}</td>`)}
        </tr>`;
      }))}</tbody>
    </table></div>
    <p class="muted">Never ticked, yours alone: HR, Payroll, Letters, Company owners and Settings. Evaluation lets a person rate the tier below them; it starts ticked for anyone whose title rates someone.</p>
  </section>`;
}

// Allocated Crew: everyone who works on the projects, one row each, one column per project.
let crewShow = '';        // '' everybody, 'none' on no project, or a project id
let crewApps = null;      // the email whose app ticks are open under their row

/** The rows: the directory's people still working (Installation), then sign-ins that have no directory record. */
export function crewRows(staff, users) {
  const rows = staff.filter(p => p.status !== 'left' && p.division !== 'trading').map(p => {
    const mail = accountOf(p);
    return { key: p.id, person: p, user: (mail && users.find(u => u.email === mail)) || null, on: activeProjects(p) };
  });
  const known = new Set(rows.map(x => x.user?.email).filter(Boolean));
  const loose = users.filter(u => !known.has(u.email) && (divisionsOf(u)[0] || 'installation') === 'installation')
    .map(u => ({ key: u.email, person: null, user: u, on: u.projects || [] }));
  return [...rows, ...loose];
}

function crewRow(row, projects) {
  const u = row.user, name = row.person?.name || u?.name || u?.email || 'No name yet';
  const sub = row.person?.title || u?.title || '';
  const live = projects.map(p => p.id);
  return html`<tr>
    <th scope="row"><b>${name}</b>${sub ? html`<br><span class="muted">${sub}</span>` : ''}${row.person ? '' : html`<br><span class="chip warn" title="Signs in, but has no record under Crew, Employee data">Not in the directory</span>`}</th>
    ${projects.map(p => {
      const on = row.on.includes(p.id);
      const may = !on && u ? mayJoin(u, p.id, live) : { ok: true };
      return html`<td class="c"><input type="checkbox" data-chg="crewOn" data-k="${row.key}" data-p="${p.id}" ${on ? 'checked' : ''} ${may.ok ? '' : 'disabled'} title="${may.ok ? `${on ? 'Take off' : 'Put on'} ${p.name}` : may.reason}" aria-label="${name} on ${p.name}"></td>`;
    })}
    <td class="nowrap">${u ? html`<span class="chip ${u.role === 'office' ? 'info' : ''}">${ROLE_NAME[u.role] || u.role}</span> <button type="button" class="btn small" data-act="crewApps" data-id="${u.email}" aria-expanded="${crewApps === u.email ? 'true' : 'false'}">${crewApps === u.email ? 'Close' : 'Apps'}</button>` : html`<span class="muted">No sign-in</span>`}</td>
  </tr>
  ${u && crewApps === u.email ? html`<tr class="crew-apps"><td colspan="${projects.length + 2}"><b>Apps ${name} may open</b>${pageTicks(u)}</td></tr>` : ''}`;
}

function crewTab(c) {
  if (c.division === 'trading') return html`<section class="card"><p class="empty">Projects belong to Installation. Switch to Installation to allocate the crew.</p></section>`;
  const projects = store.projects;
  const all = crewRows(c.company.staff || [], store.cloud ? store.users : []);
  const rows = all.filter(x => !crewShow || (crewShow === 'none' ? !x.on.length : x.on.includes(crewShow)));
  return html`<section class="card" id="panel-crew">
    <div class="toolbar"><h2>Allocated Crew</h2><span class="muted">Tick to put a person on a project, untick to take them off. Their place on the team, the Field Report lists and their sign-in follow.</span></div>
    <div class="actions left"><label>Show <select data-chg="crewShow" aria-label="Who to show">${options([['', `Everybody (${all.length})`], ['none', 'On no project'], ...projects.map(p => [p.id, `On ${p.name}`])], crewShow)}</select></label></div>
    ${rows.length ? html`<div class="table-wrap"><table class="table compact crew-table">
      <thead><tr><th>Person</th>${projects.map(p => html`<th class="c">${p.name}${statusLabel(p) !== statusLabel({}) ? html`<br><span class="muted">${statusLabel(p)}</span>` : ''}</th>`)}<th>Sign-in</th></tr></thead>
      <tbody>${rows.map(x => crewRow(x, projects))}</tbody>
    </table></div>` : html`<p class="empty">${all.length ? 'Nobody matches.' : 'Nobody yet. People are added under Crew, Employee data.'}</p>`}
    <p class="muted">A Project Engineer or Site Engineer is on one project at a time: their other boxes are greyed out. The role and day rate on each project are set on the person's record (Crew, Employee data, Projects).</p>
  </section>`;
}

function youTab() {
  return html`
    <div class="set-cols">
      ${box('you', 'You', html`
        <p class="muted">Signed in as ${store.user.email}, the Admin. Only you can delete records, change settings, open HR and manage people.</p>
        <div class="grid2">
          <label>Your name <input data-chg="myProfile" data-f="name" data-fk="me-name" value="${store.profile.name}" placeholder="${store.user.name}"></label>
          <label>Your title <input data-chg="myProfile" data-f="title" data-fk="me-title" value="${store.profile.title}" placeholder="e.g. General Manager"></label>
        </div>
        <p class="muted">Documents you approve are signed "${store.signature}".</p>`)}
      ${store.isPrimary ? box('coowners', 'Executive Partners', html`
        <p class="muted">An Executive Partner sees everything in both divisions, including HR and payroll, but cannot add, edit or delete anything, or change settings and permissions. Only you add or remove Executive Partners.</p>
        ${store.coOwners.length ? html`<ul class="list">${store.coOwners.map(e => html`<li class="split"><span>${e}</span><button class="btn ghost small" data-act="removeCoOwner" data-id="${e}">Remove</button></li>`)}</ul>` : html`<p class="muted">No Executive Partner yet.</p>`}
        <form data-form="coOwner" class="entry">
          <input type="email" name="email" placeholder="partner@gmail.com" required aria-label="Executive Partner's Google account" class="wide">
          <button class="btn primary">Make Executive Partner</button>
        </form>
        ${coOwnerNotice ? html`<p class="${coOwnerBad ? 'bad' : 'ok'}">${coOwnerNotice}</p>` : ''}`) : ''}
      ${box('rules', 'Database rules', html`
        <p class="muted">The database enforces who may read, change and delete. After an update, paste the rules in the Firebase console: Firestore Database, Rules, then Publish.</p>
        <div class="actions left">
          <button class="btn small" type="button" data-act="copyRules" title="Copies the database access rules, ready to paste into the Firebase console">Copy the access rules</button>
          ${rulesNotice ? html`<span class="muted">${rulesNotice}</span>` : ''}
        </div>`)}
      ${box('admin', 'Move the Admin', html`
        <p class="muted">Use this when you change to a company address. The new address becomes the Admin; this one stays on as an Office user. It cannot be undone from this account, only by the new Admin.</p>
        <form data-form="transferAdmin" class="entry">
          <input type="email" name="email" placeholder="new.address@amistadprefab.com" required aria-label="New Admin address" class="wide">
          <button class="btn danger">Make this address the Admin</button>
        </form>
        ${transferNotice ? html`<p class="bad">${transferNotice}</p>` : ''}`)}
    </div>`;
}

function accessPage(c) {
  if (store.role !== 'owner') return html`<div class="side settings"><section class="card"><p class="empty">Only the Admin manages people and access.</p></section></div>`;
  // the demo has nobody who signs in: only the crew of the directory can be allocated there
  const demo = !store.cloud;
  if (demo) accTab = 'crew';
  const tabs = demo ? [['crew', 'Allocated Crew']]
    : [['people', 'People', store.requests.length || 0], ['crew', 'Allocated Crew'], ['perms', 'Permissions'], ['you', 'Admin'], ['problems', 'Problems reported', store.faults.length || 0]];
  return html`<div class="side settings">
    <div class="set-head"><h2>People and access</h2><span class="muted">You and ${plural(store.users.length, 'other')} can sign in</span></div>
    ${projectBar(c, 'The switches link people to')}
    ${tabStrip(tabs, accTab, 'accTab')}
    ${demo ? html`<p class="muted">Nobody signs in to the demo, so People and Permissions are only in the signed-in version.</p>` : ''}
    ${accTab === 'you' ? youTab() : accTab === 'problems' ? html`<section class="card">${diagBody()}</section>` : accTab === 'crew' ? crewTab(c) : accTab === 'perms' ? permsTab() : peopleTab()}
  </div>`;
}

/** The project a page is about, said plainly with a way to change it right there: setting up the wrong project is the easy mistake. */
const projectBar = (c, what) => html`
  <div class="project-bar">
    <span class="project-bar-what">${what}</span>
    <select data-chg="switchProject" aria-label="Project being set up">${options(store.projects.map(x => [x.id, x.name]), c.project.id)}</select>
    <span class="chip ${statusLabel(c.project) === 'Active' ? 'ok' : 'warn'}">${statusLabel(c.project)}</span>
  </div>`;


/** Field Report and import: the connection (three steps) and the data pack, one tab each. */
function linksPage(c) {
  return html`<div class="side settings">
    ${projectBar(c, 'Field Report and import for')}
    ${tabStrip([['field', 'Field Report'], ['projects', 'All projects'], ['users', 'Field Report users', fieldusers.waiting().length], ['import', 'Import data', pack ? 1 : 0]], linkTab, 'linkTab')}
    ${linkTab === 'import' ? html`<section class="card set-box" id="panel-import">${importBody(c)}</section>` : linkTab === 'projects' ? fieldprojects.body() : linkTab === 'users' ? fieldusers.body() : fieldsetup.body(c)}
  </div>`;
}

/** The open project, as four tabs. */
function projectPage(c) {
  const { global: g, project: p, ws } = c;
  const currencies = Object.keys(g.fx.rates).filter(k => ALLOWED.includes(k)).map(k => [k, k]);
  const linked = assignedUsers(store.users, p.id).length;
  const t = targetFor(p, c.ws, c.today);
  const reported = t.nonWorking.filter(d => !(p.nonWorking || []).includes(d));
  const tabs = PROJ_TABS.map(([k, label]) => [k, label, k === 'team' ? ws.team.length : 0]);

  const basics = html`
    <div class="set-cols">
      ${box('project', 'The project', html`
        <label>Project name <input data-chg="project" data-f="name" data-fk="pj-name" value="${p.name}"></label>
        <div class="grid2">
          <label>Type of work <select data-chg="project" data-f="type" data-fk="pj-type">${options(PROJECT_TYPES, p.type || 'steel')}</select></label>
          <label>Currency <select data-chg="project" data-f="currency" data-fk="pj-cur">${options(currencies, p.currency)}</select></label>
          <label>Budget <input type="number" min="0" step="any" data-chg="project" data-f="budget" data-fk="pj-budget" value="${p.budget}"></label>
          <label>Contract value <input type="number" min="0" step="any" data-chg="project" data-f="contractValue" data-fk="pj-contract" value="${p.contractValue}"></label>
          <label title="The labour line of the budget: crew and staff pay. Printed on the labour cost sheet (Payments).">Labour budget <input type="number" min="0" step="any" data-chg="project" data-f="labourBudget" data-fk="pj-labour" value="${p.labourBudget || ''}"></label>
        </div>`)}
      <div class="set-stack">
        ${box('markups', 'Markups %', html`<div class="grid4">${MARKUPS.map(([k, label]) => html`
          <label>${label} <input type="number" min="0" step="any" data-chg="markup" data-k="${k}" data-fk="mk-${k}" value="${p.markups[k]}"></label>`)}</div>`)}
        ${box('pages', 'Pages this project uses', html`
          ${pills(SWITCHABLE.map(k => html`<label class="check pill"><input type="checkbox" data-chg="pageOn" data-p="${k}" ${pageOn(p, k) ? 'checked' : ''}> ${PAGE_NAME[k]}</label>`))}
          <p class="muted">Untick a page this project does not need. It leaves the menu for everyone; the records stay.</p>`)}
      </div>
    </div>
    <div class="actions left"><button class="btn danger" data-act="deleteProject">Delete this project</button></div>`;

  const site = html`
    <div class="set-cols">
      ${box('deploy', 'Where and what', html`
        <p class="muted">A project shows for a person only when their email is linked (Team tab) and the project is Active. ${statusLabel(p)}.</p>
        <div class="grid2">
          <label>Status <select data-chg="project" data-f="status" data-fk="pj-status">${options(STATUSES, p.status || 'active')}</select></label>
          <label>Site location <input data-chg="project" data-f="location" data-fk="pj-location" maxlength="${LIMITS.location}" value="${p.location || ''}" placeholder="Town, site name, GPS"></label>
          <label>Site map link <input type="url" data-chg="project" data-f="mapLink" data-fk="pj-map" value="${p.mapLink || ''}" placeholder="https://maps.google.com/..."></label>
          <label>Layout or drawings link <input type="url" data-chg="project" data-f="layoutLink" data-fk="pj-layout" value="${p.layoutLink || ''}" placeholder="https://..."></label>
        </div>
        <label>Scope of work <textarea data-chg="project" data-f="scope" data-fk="pj-scope" maxlength="${LIMITS.scope}" rows="4" placeholder="What this project covers">${p.scope || ''}</textarea></label>`)}
      ${box('acts', 'Activity types for the daily report', html`
        <textarea data-chg="activities" data-fk="pj-acts" rows="9" aria-label="Activity types, one per line">${activitiesOf(p).join('\n')}</textarea>
        <p class="muted">One per line, at most ${LIMITS.activities} of ${LIMITS.activity} characters. They go to Field Report with the project's other lists. Links must start with http:// or https://.</p>`)}
    </div>`;

  const team = html`
    <div class="set-cols team-cols">
      ${box('team', 'On this project', html`
        ${ws.team.length ? html`<ul class="list">${ws.team.map(m => m.personId ? html`
          <li class="team-row team-linked">
            <span class="tm-name" title="Kept in the directory">${m.name} <span class="chip">Directory</span></span>
            <span>${m.role || ''}</span>
            <span class="muted">${m.contact || ''}</span>
            <span title="${levelLabel(levelOf(m))}">Tier ${levelOf(m).slice(1)}</span>
            <span class="muted">${m.active === false ? 'Off site' : 'On site'}</span>
            <span class="muted nowrap">${dayRateOf(ws, m.id) ? `${dayRateOf(ws, m.id)} ${p.currency}` : 'No rate'}</span>
            ${store.isAdmin ? html`<span class="nowrap"><button class="btn ghost small" data-act="openPerson" data-pid="${m.personId}">Edit in the directory</button> <button class="btn ghost small" data-act="removeMember" data-id="${m.id}">Remove</button></span>` : html`<span></span>`}
          </li>` : html`
          <li class="team-row">
            <input data-chg="member" data-id="${m.id}" data-f="name" data-fk="tm-n-${m.id}" value="${m.name}" placeholder="Name" aria-label="Name">
            <select data-chg="member" data-id="${m.id}" data-f="role" data-what="role" data-fk="tm-r-${m.id}" aria-label="Role of ${m.name}">${chooseGroups(positionGroups(m.role), m.role, 'Role…')}</select>
            <input data-chg="member" data-id="${m.id}" data-f="contact" data-fk="tm-c-${m.id}" value="${m.contact || ''}" placeholder="Email or phone" aria-label="Contact of ${m.name}">
            <select data-chg="member" data-id="${m.id}" data-f="level" data-fk="tm-l-${m.id}" aria-label="Evaluation tier of ${m.name}" title="Decides who evaluates this person: the tier above">${options(SHORT_TIERS, levelOf(m))}</select>
            <label class="check" title="Untick when the person leaves this project"><input type="checkbox" data-chg="memberActive" data-id="${m.id}" ${m.active === false ? '' : 'checked'}> On site</label>
            <input class="price" type="number" min="0" step="any" data-chg="memberRate" data-id="${m.id}" data-fk="mr-${m.id}" value="${dayRateOf(ws, m.id) || ''}" placeholder="Day rate" title="Day rate in ${p.currency}" aria-label="Day rate of ${m.name}">
            <button class="btn ghost small" data-act="removeMember" data-id="${m.id}">Remove</button>
          </li>`)}</ul>
          <p class="muted">People marked Directory are changed in Crew, Employee data. Day rates are in ${p.currency}.</p>` : html`<p class="muted">Add the people working on this project to assign tasks and follow-ups.</p>`}
        ${store.isAdmin && c.company.staff.some(x => x.status !== 'left' && !assignmentOf(x, p.id)) ? html`<form data-form="fromDirectory" class="entry">
          <select name="personId" aria-label="Person from the directory">${options(c.company.staff.filter(x => x.status !== 'left' && !assignmentOf(x, p.id)).map(x => [x.id, x.title ? `${x.name}, ${x.title}` : x.name]), null)}</select>
          <select name="role" aria-label="Role here"><option value="">Role: same as their job</option>${groupOptions(positionGroups(), null)}</select>
          <input name="dayRate" type="number" min="0" step="any" placeholder="Day rate" aria-label="Day rate" class="amount">
          <button class="btn primary">Add from the directory</button></form>` : ''}
        ${store.isAdmin && unlinked(ws.team).length ? html`<p class="muted">${unlinked(ws.team).length} on this team ${unlinked(ws.team).length === 1 ? 'is' : 'are'} not in the directory. <a href="#hr">Add them under Crew, Employee data</a>.</p>` : ''}
        <form data-form="member" class="entry"><span class="muted">Not in the directory, for example a casual worker:</span>
          <input name="name" placeholder="Name" required aria-label="Name" class="wide">
          <select name="role" aria-label="Role"><option value="">Role…</option>${groupOptions(positionGroups(), null)}</select>
          <input name="contact" placeholder="Email or phone" aria-label="Email or phone" class="wide">
          <select name="level" aria-label="Evaluation tier">${options([['crew', 'Tier by role'], ...SHORT_TIERS], 'crew')}</select>
          <button class="btn">Add</button>
        </form>`)}
      ${box('linked', 'Who can open this project', html`
        ${linked ? '' : html`<p class="bad">Nobody is linked yet. Until someone is, only the Admin and managers can work on it in Field Report.</p>`}
        ${store.users.length ? html`<ul class="list">${store.users.map(u => html`
          <li class="split">
            <span><b>${u.name || u.email}</b> <span class="muted">${ROLE_NAME[u.role] || u.role}${titleOf(u) ? `, ${titleLabel(titleOf(u))}` : ''}</span></span>
            <label class="check"><input type="checkbox" data-chg="userProject" data-id="${u.email}" data-p="${p.id}" ${(u.projects || []).includes(p.id) ? 'checked' : ''}> Linked</label>
          </li>`)}</ul>` : html`<p class="muted">Nobody else has access yet. Add people under People and access.</p>`}`)}
    </div>`;

  const week = html`
    <div class="set-cols">
      <div class="set-stack">
        ${box('week', 'Working week', html`
          ${pills(WEEKDAYS.map((d, i) => html`<label class="check pill"><input type="checkbox" data-chg="weekday" data-d="${i}" ${p.workDays.includes(i) ? 'checked' : ''}> ${d}</label>`))}`)}
        ${box('payperiod', 'Pay period of the crew', html`
          <p class="muted">How often the site crew of this project is paid. The Attendance sheet shows the same period.</p>
          <div class="grid2">
            <label>Paid <select data-chg="payPeriod" data-fk="pp-kind">${options(PAY_PERIODS, payPeriodOf(p))}</select></label>
            ${payPeriodOf(p) === 'monthly' ? '' : html`<label>A pay week starts on <select data-chg="payWeekStart" data-fk="pp-start">${options(WEEKDAYS.map((d, i) => [String(i), d]), String(weekStartOf(p)))}</select></label>`}
          </div>`)}
        ${box('calendar', 'Non-working dates and target date', html`
          <label>One date per line (YYYY-MM-DD): holidays and days nobody works
            <textarea data-chg="nonWorking" data-fk="pj-nw" rows="3" placeholder="2026-11-12">${(p.nonWorking || []).join('\n')}</textarea></label>
          <p class="muted">Weekly off days: ${t.nwDow.length ? t.nwDow.map(d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]).join(', ') : 'none'}. ${reported.length ? `Also counted: ${reported.length} day${reported.length === 1 ? '' : 's'} the site reported no work.` : ''}</p>
          ${t.targetDate ? html`<p>Target date: <b>${fmtFull(t.targetDate)}</b>, ${t.plannedWorkingDays} planned working days, ${t.workingDaysLeft} left. Each non-working day moves it one working day later.</p>` : html`<p class="muted">The target date appears once the schedule has tasks.</p>`}`)}
      </div>
      ${box('rates', 'Labour day rates', html`
        <div class="grid2">${Object.entries(ws.laborRates).map(([trade, rate], i) => html`
          <label>${trade} <input type="number" min="0" step="any" data-chg="labor" data-t="${trade}" data-fk="lb-${i}" value="${rate}"></label>`)}</div>
        <form data-form="trade" class="entry">
          <input name="trade" placeholder="New trade" required aria-label="Trade" class="wide">
          <input type="number" name="rate" min="0" step="any" placeholder="Day rate" required aria-label="Day rate" class="amount">
          <button class="btn">Add</button>
        </form>`, p.currency)}
    </div>`;

  return html`<div class="side settings">
    ${projectBar(c, 'Setting up')}
    <p class="muted project-bar-sub">${plural(linked, 'person', 'people')} linked. ${p.currency}. Everything on this page is for this project only.</p>
    ${tabStrip(tabs, projTab, 'projTab')}
    ${projTab === 'site' ? site : projTab === 'team' ? team : projTab === 'week' ? week : basics}
  </div>`;
}

/** Choose your apps: every app as a tile, grouped like the menu, switched on or off for the whole company. */
function appsPage(c) {
  const g = c.global;
  const all = APPS.flatMap(x => x.apps);
  const on = all.filter(a => appOn(g, a.page)).length;
  return html`
    <div class="side settings">
      <section class="apps-hero">
        <h2>Choose your apps</h2>
        <p>Switch on what Amistad uses. An app that is off disappears from the menu for everyone; its records are kept and come back when you switch it on again.</p>
        <div class="actions left">
          ${chipText(`${on} of ${all.length} apps on`)}
          ${on < all.length ? html`<button class="btn small" data-act="appsAll">Switch all on</button>` : ''}
        </div>
      </section>
      ${APPS.map(grp => html`
        <section class="apps-group">
          <div class="apps-head"><h3>${grp.group}</h3><span class="muted">${grp.about}</span></div>
          <div class="apps-grid">${grp.apps.map(a => {
            const live = appOn(g, a.page);
            return html`
              <button type="button" class="app-tile ${live ? 'on' : 'off'}" data-act="app" data-p="${a.page}" aria-pressed="${live ? 'true' : 'false'}" ${a.fixed ? html`disabled title="Always on: every project needs it"` : html`title="${live ? 'Click to switch off' : 'Click to switch on'}"`}>
                <span class="app-icon">${icon(a.page)}</span>
                <span class="app-text"><b>${a.name}</b><span class="muted">${a.does}</span></span>
                <span class="app-state">${a.fixed ? 'Always on' : live ? 'On' : 'Off'}</span>
              </button>`;
          })}</div>
        </section>`)}
      <p class="muted">Who may open each app is set under People and access. Pages a single project does not need are switched off under This project.</p>
    </div>`;
}
const chipText = text => html`<span class="chip ok">${text}</span>`;

export function render(c) {
  if (section === 'mine' || !store.isAdmin) return html`${nav()}${minePage()}`;
  if (section === 'apps') return html`${nav()}${appsPage(c)}`;
  if (section === 'prices') return html`${nav()}${projectPage(c)}`;
  if (section === 'access') return html`${nav()}${accessPage(c)}`;
  if (section === 'links') return html`${nav()}${linksPage(c)}`;
  const { global: g, project: p } = c;
  const co = g.company || {};

  return html`
    ${nav()}
    <div class="side settings">
    ${panel('fx', 'Exchange rates', Object.keys(g.fx.rates).join(', '), () => html`
        <p class="muted">Central Hub works in ETB, USD and AED. Units per 1 ${g.fx.base}. Sample values: enter your own.</p>
        <div class="grid2">${Object.entries(g.fx.rates).map(([k, v]) => html`
          <label>${k} <input type="number" min="0" step="any" data-chg="fx" data-k="${k}" data-fk="fx-${k}" value="${v}" ${k === g.fx.base ? 'disabled' : ''}></label>`)}</div>
        ${(() => {
          const left = [...foreignSummary(g, store.projects, store.company), ...((store.ws?.ledger || []).some(e => isForeign(e.currency)) ? [`Costs of ${p.name} in another currency`] : [])];
          return left.length ? html`<div class="card"><b>Still in other currencies</b>
            <ul>${left.map(r => html`<li>${r}</li>`)}</ul>
            <p class="muted">Converting changes them to USD at the rates above, for every project. The original amount and currency stay in a note on each record. Export a backup first (Backup, Export JSON).</p>
            ${store.isAdmin && !store.readOnly ? html`<button class="btn primary" data-act="convertCurrencies">Convert to USD</button>` : ''}
          </div>` : html`<p class="ok">Everything is in ETB, USD or AED.</p>`;
        })()}
        ${fxNotice ? html`<p class="ok">${fxNotice}</p>` : ''}
        ${ALLOWED.some(k => !g.fx.rates[k]) ? html`<form data-form="currency" class="entry">
          <select name="code" aria-label="Currency">${options(ALLOWED.filter(k => !g.fx.rates[k]).map(k => [k, k]))}</select>
          <input type="number" name="rate" min="0" step="any" placeholder="Per 1 ${g.fx.base}" required aria-label="Units per 1 ${g.fx.base}" class="amount">
          <button class="btn">Add</button>
        </form>` : ''}`)}

    ${panel('company', 'Company letterhead', co.name || 'Name, address, bank details and logo for printed documents', () => html`
        <p class="muted">Printed at the top of every invoice, quotation, purchase order and report. Shared by all projects.</p>
        <div class="form">
          <label>Company name <input data-chg="company" data-f="name" data-fk="co-name" value="${co.name || ''}"></label>
          <label>Address <textarea data-chg="company" data-f="address" data-fk="co-addr" rows="2">${co.address || ''}</textarea></label>
          <div class="grid2">
            <label>Phone <input data-chg="company" data-f="phone" data-fk="co-phone" value="${co.phone || ''}"></label>
            <label>Email <input data-chg="company" data-f="email" data-fk="co-email" value="${co.email || ''}"></label>
          </div>
          <label>Tax ID <input data-chg="company" data-f="taxId" data-fk="co-tax" value="${co.taxId || ''}"></label>
          <label>Bank details for invoices <textarea data-chg="company" data-f="bank" data-fk="co-bank" rows="3">${co.bank || ''}</textarea></label>
          <label>Logo <input type="file" accept="image/*" data-chg="logo"></label>
          ${co.logo ? html`<div class="split"><img class="logo-preview" src="${co.logo}" alt="Company logo"><button class="btn ghost small" data-act="removeLogo">Remove logo</button></div>` : ''}
        </div>`)}

    ${panel('monthly', 'Paid monthly', monthlyRolesOf(g).join(', ') || 'Nobody: everyone is paid per day', () => html`
        <p class="muted">These positions are paid by the month; everyone else on site is paid per day. Attendance is taken for everyone: for the monthly-paid it is a record and does not change the pay. An HR agreement that says "per day" or "per month" wins. A monthly position with no monthly wage in its agreement is flagged on Payments, never paid per day.</p>
        ${positionGroups().filter(([grp]) => grp !== 'Old').map(([grp, list]) => html`<h4 class="tick-group">${grp}</h4>${pills(list.map(r => html`<label class="check pill"><input type="checkbox" data-chg="monthlyRole" data-v="${r}" ${monthlyRolesOf(g).includes(r) ? 'checked' : ''}> ${r}</label>`))}`)}`)}
    </div>`;
}

export const actions = {
  ...fieldsetup.actions,
  /** Edit in the directory: the person's record in Crew, Employee data, on its Projects tab. */
  openPerson(el) { focusPerson(el.dataset.pid, 'projects'); location.hash = '#hr'; },
  ...fieldprojects.actions,
  ...fieldusers.actions,
  dropPack() { pack = null; packNotice = ''; },
  projTab(el) { projTab = el.dataset.t; },
  accTab(el) { accTab = el.dataset.t; },
  // v0.24.0: My settings
  setTheme(el) { try { localStorage.setItem('sf:theme', el.dataset.t); } catch { /* this visit only */ } globalThis.applyTheme?.(); },
  async askNotify() { try { await Notification.requestPermission(); } catch { /* the browser says no */ } store.notify(); },
  signOutHere() { store.signOut(); },
  linkTab(el) { linkTab = el.dataset.t; },
  pickUser(el) { who = el.dataset.id; },
  /** From the Permissions table: open the person on the People tab. */
  openUser(el) { who = el.dataset.id; accTab = 'people'; },
  crewApps(el) { crewApps = crewApps === el.dataset.id ? null : el.dataset.id; },
  /** Put a person back on what a role starts with (they keep their role). */
  resetPages(el) {
    const u = store.users.find(x => x.email === el.dataset.id);
    if (!u) return;
    const want = defaultPages({ ...u, role: el.dataset.r });
    store.setUser(u.email, { pages: grantableFor(u).map(([k]) => k).filter(k => want.includes(k)), pagesV: 2 });
    tell(`✓ ${u.name || u.email} now opens the ${el.dataset.r === 'site' ? 'Site' : 'Office'} pages.`);
  },
  /** Switch one app on or off for the whole company. */
  app(el) {
    const page = el.dataset.p;
    store.updateGlobal(g => {
      const off = (g.appsOff || []).filter(k => k !== page);
      if (appOn(g, page)) off.push(page);
      g.appsOff = off;
    });
  },
  appsAll() { store.updateGlobal(g => { g.appsOff = []; }); },
  async copyRules() {
    try {
      const res = await fetch('firestore.rules', { cache: 'no-store' });
      if (!res.ok) throw new Error('the rules file is not in this copy of Central Hub. Upload firestore.rules to the central-hub repository on GitHub with the other files, or open the file in the Central Hub folder on your computer and copy its text');
      await navigator.clipboard.writeText(await res.text());
      rulesNotice = 'Rules copied. In the Firebase console open Firestore Database, Rules, select everything, paste, and click Publish.';
    } catch (err) {
      rulesNotice = `Not copied: ${err.message}.`;
    }
    store.notify();
  },
  /** Merge the chosen pack into the open project, its settings, and the company records. */
  importPack(el, c) {
    if (!pack) return;
    if (packFor && packFor !== c.project.id) { alert('This pack was chosen for another project. Choose it again here.'); return; }
    const title = pack.title || 'data pack';
    if (!confirm(`Import "${title}" into ${c.project.name}?`)) return;
    let count = { added: 0, replaced: 0 };
    const tally = r => { count = { added: count.added + r.added, replaced: count.replaced + r.replaced }; };
    const chosen = pack;
    store.updateProject(p => applyToProject(p, chosen));
    store.update(ws => tally(applyToWorkspace(ws, chosen)));
    if (chosen.company) store.updateCompany(co => tally(applyToCompany(co, chosen, c.project.id, store.role === 'owner' ? [] : OWNER_SECTIONS)));
    pack = null;
    packBad = false;
    packNotice = `"${title}" imported: ${count.added} records added${count.replaced ? `, ${count.replaced} replaced` : ''}. Check Daily report, Costs, and Invoices and documents.`;
  },
  /** Approve (as Site or Office) or decline someone who asked to come in. */
  answer(el) {
    const as = el.dataset.r;
    if (!as && !confirm(`Decline ${el.dataset.id}? They can ask again by signing in.`)) return;
    const division = el.closest('li')?.querySelector('.req-dept')?.value || '';
    if (as && !division) { alert('Choose the division (Installation or Trading) first. Nobody is approved without one.'); return; }
    store.answerRequest(el.dataset.id, as, division);
  },
  clearFaults() { if (confirm('Clear the list of reported problems?')) store.clearFaults(); },
  /** End someone's session, for example when their phone is lost, so they can sign in on another device. */
  resetSession(el) { if (confirm(`End the session of ${el.dataset.id}? They are signed out on that device and can sign in on another.`)) store.resetSession(el.dataset.id); },
  /** Everything in another currency to USD, at today's table: every project, the company records, then the shared settings. */
  async convertCurrencies(el, c) {
    if (!store.isAdmin || store.readOnly) return;
    if (!confirm('Convert everything that is in another currency to USD, at the rates in this table?\n\nThis changes every project. The original amount and currency stay in a note on each record. Export a backup first if you have not.')) return;
    const fx = structuredClone(store.global.fx), on = c.today;
    let n = 0;
    for (const p of [...store.projects]) {
      let next = null;
      await store.updateOther(p.id, ws => { const r = convertProject(p, ws, fx, on); n += r.changes.length; next = r.project; Object.assign(ws, r.ws); });
      if (next && next !== p) store.patchProject(p.id, { currency: next.currency, budget: next.budget, contractValue: next.contractValue, fxFrom: next.fxFrom });
    }
    const co = convertCompany(store.company, fx, on);
    if (co.changes.length) store.updateCompany(x => Object.assign(x, co.sections));
    const gl = convertGlobal(store.global, on);
    store.updateGlobal(g => { g.fx = gl.global.fx; g.regions = gl.global.regions; g.prices = gl.global.prices; });
    fxNotice = `Converted to USD: ${n + co.changes.length + gl.changes.length} item${n + co.changes.length + gl.changes.length === 1 ? '' : 's'}. The rate table now holds ETB, USD and AED.`;
    store.notify();
  },
  removeCoOwner(el) {
    if (!confirm(`Remove ${el.dataset.id} as an Executive Partner? They can no longer sign in to see everything.`)) return;
    store.removeCoOwner(el.dataset.id).catch(err => { coOwnerNotice = err.message; coOwnerBad = true; store.notify(); });
  },
  removeUser(el) { if (confirm(`Remove access for ${el.dataset.id}?`)) store.removeUser(el.dataset.id); },
  removeLogo() { store.updateGlobal(g => { g.company = { ...g.company, logo: '' }; }); },
  /** Take someone off this project's team. A person from the directory keeps their record there; only this project is taken off it. */
  removeMember(el, c) {
    const id = el.dataset.id;
    const m = c.ws.team.find(x => x.id === id);
    if (!m || !confirm(`Remove ${m.name || 'this person'} from the team of ${c.project.name}?${m.personId ? ' Their record in the directory stays.' : ''}`)) return;
    const person = m.personId && c.company.staff.find(x => x.id === m.personId);
    if (person) {
      store.updateCompany(co => { const x = co.staff.find(y => y.id === person.id); if (x) x.assignments = (x.assignments || []).filter(a => a.projectId !== c.project.id); });
      // their sign-in is unlinked from the project too, as when HR takes them off it
      const u = store.users.find(x => x.email === accountOf(person));
      if (u) store.setUser(u.email, { projects: (u.projects || []).filter(id => id !== c.project.id) });
    }
    store.update(ws => {
      ws.team = ws.team.filter(m => m.id !== id);
      for (const t of ws.tasks) if (t.assigneeId === id) t.assigneeId = '';
    });
  },
  deleteProject(el, c) {
    if (store.projects.length < 2) { alert('This is the only project, so it cannot be deleted.'); return; }
    if (confirm(`Delete "${c.project.name}" and all of its reports, schedule, costs and estimate? This cannot be undone.`)) {
      store.removeProject(c.project.id);
    }
  },
};

export const changes = {
  ...fieldsetup.changes,
  ...fieldprojects.changes,
  ...fieldusers.changes,
  /** Read the chosen file and show what is in it. Nothing is saved here. */
  async pack(el) {
    const file = el.files[0];
    if (!file) return;
    try {
      pack = checkPack(JSON.parse(await file.text()));
      packFor = store.project?.id || '';
      packNotice = '';
    } catch (err) {
      pack = null;
      packBad = true;
      packNotice = err instanceof SyntaxError ? 'This file could not be read as a data pack.' : err.message;
    }
    store.notify();
  },
  /** Change the project that the Settings pages are about. */
  switchProject(el) { store.switchTo(el.value); },
  userRole(el) {
    store.setUser(el.dataset.id, { role: el.value });
  },
  /** One title, which is also the person's one rank for evaluations. */
  userTitle(el) {
    const u = store.users.find(x => x.email === el.dataset.id);
    const ok = el.value ? mayTake(u, el.value, store.projects.map(x => x.id)) : { ok: confirm('Clear this person\'s title?') };
    if (!ok.ok) { if (ok.reason) tell(`✗ ${ok.reason}`); store.notify(); return; }
    store.setUser(el.dataset.id, titlePatch(el.value));
  },
  /** Switch a person on or off the open project: on puts the project in their list, off takes it out. */
  userLink(el) {
    const u = store.users.find(x => x.email === el.dataset.id);
    const project = store.project;
    if (!u || !project) return;
    const live = store.projects.map(x => x.id);
    const projects = (u.projects || []).filter(id => id !== project.id && live.includes(id));   // a deleted project is dropped from the list
    if (el.checked) {
      const may = mayJoin(u, project.id, live);
      if (!may.ok) { tell(`✗ ${may.reason}`); store.notify(); return; }
      projects.push(project.id);
    }
    store.setUser(u.email, { projects });
    tell(`${el.checked ? '✓ Linked' : '✓ Unlinked'} ${u.name || u.email} ${el.checked ? 'to' : 'from'} ${project.name}.`);
  },
  /** The one division a person signs in to (Installation or Trading). */
  userDivision(el) {
    const u = store.users.find(x => x.email === el.dataset.id);
    const next = { ...u, divisions: [el.value] };
    store.setUser(el.dataset.id, { divisions: [el.value], ...(Array.isArray(u?.pages) ? { pages: u.pages.filter(p => grantableFor(next).some(([k]) => k === p)) } : {}) });
  },
  /** The dates nobody works on the open project, one per line. */
  nonWorking(el) { store.updateProject(p => { p.nonWorking = parseDates(el.value); }); },
  /** Open a person's directory record, on its Projects tab. */
  memberActive(el) { store.update(ws => { const m = ws.team.find(x => x.id === el.dataset.id); if (m) m.active = el.checked; }); },
  /** The activity types of the open project, one per line. */
  activities(el) { store.updateProject(p => { p.activities = parseList(el.value); }); },
  userApprover(el) { store.setUser(el.dataset.id, { approver: el.checked }); },
  userField(el) { store.setUser(el.dataset.id, { [el.dataset.f]: el.value.trim() }); },
  myProfile(el) { store.setProfile({ [el.dataset.f]: el.value.trim() }); },
  /** Tick or untick one page for a person (Office or Site). */
  userPage(el) {
    const u = store.users.find(x => x.email === el.dataset.id);
    if (u) store.setUser(u.email, tickPage(u, el.dataset.p, el.checked));
  },
  crewShow(el) { crewShow = el.value; },
  payPeriod(el) { store.updateProject(p => { p.payPeriod = el.value; }); },
  payWeekStart(el) { store.updateProject(p => { p.payWeekStart = +el.value; }); },
  /** Allocated Crew: put a person on a project or take them off. A directory person goes the way of their HR record. */
  crewOn(el, c) {
    const pid = el.dataset.p, on = el.checked;
    const project = store.projects.find(p => p.id === pid);
    const person = (c.company.staff || []).find(p => p.id === el.dataset.k);
    const mail = person ? accountOf(person) : el.dataset.k;
    const u = mail && store.users.find(x => x.email === mail);
    if (on && u) {
      const may = mayJoin(u, pid, store.projects.map(x => x.id));
      if (!may.ok) { tell(`✗ ${may.reason}`); store.notify(); return; }
    }
    if (person) {
      let a;
      store.updateCompany(co => {
        const x = co.staff.find(y => y.id === person.id);
        const old = assignmentOf(x, pid);
        a = { ...(old || { projectId: pid, role: x.title || '', dayRate: 0 }), active: on };
        x.assignments = [...(x.assignments || []).filter(y => y.projectId !== pid), a];
      });
      store.updateOther(pid, ws => (on ? assign(ws, person, a) : unassign(ws, person)));
      relink(person, pid, on);
    } else if (u) {
      const live = store.projects.map(x => x.id);
      const projects = (u.projects || []).filter(id => id !== pid && live.includes(id));
      if (on) projects.push(pid);
      store.setUser(u.email, { projects });
    }
    tell(`✓ ${person?.name || u?.name || mail} ${on ? 'is on' : 'is off'} ${project?.name || 'the project'}.`);
  },
  /** Switch a page on or off for the open project. */
  pageOn(el) {
    store.updateProject(p => {
      const off = (p.off || []).filter(k => k !== el.dataset.p);
      if (!el.checked) off.push(el.dataset.p);
      p.off = off;
    });
  },
  userProject(el) {
    const u = store.users.find(x => x.email === el.dataset.id);
    const live = store.projects.map(x => x.id);
    const projects = (u?.projects || []).filter(id => id !== el.dataset.p && live.includes(id));
    if (el.checked) {
      const may = mayJoin(u, el.dataset.p, live);
      if (!may.ok) { tell(`✗ ${may.reason}`); store.notify(); return; }
      projects.push(el.dataset.p);
    }
    store.setUser(el.dataset.id, { projects });
  },
  company(el) { store.updateGlobal(g => { g.company = { ...g.company, [el.dataset.f]: el.value.trim() }; }); },
  monthlyRole(el) {
    store.updateGlobal(g => {
      const list = monthlyRolesOf(g).filter(r => r !== el.dataset.v);
      g.monthlyRoles = el.checked ? [...list, el.dataset.v] : list;
    });
  },
  /** Any picture is accepted: it is scaled down to fit (about 200 KB), keeping a transparent background. */
  async logo(el) {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    try {
      const r = await pictureFor(file, LOGO, 'logo');
      store.updateGlobal(g => { g.company = { ...g.company, logo: r.dataUrl }; });
      tell(sizeNote('Logo', r) || 'Logo added.');
    } catch (err) { tell(err.message); }
  },
  fx(el) {
    const rate = field(el);
    if (rate > 0) store.updateGlobal(g => { g.fx.rates[el.dataset.k] = rate; });
  },
  project(el) {
    const f = el.dataset.f;
    const value = field(el);
    if (f === 'name' && !value.trim()) return;
    store.updateProject(p => { p[f] = typeof value === 'number' ? Math.max(0, value) : value; });
  },
  markup(el) { store.updateProject(p => { p.markups[el.dataset.k] = Math.max(0, field(el)); }); },
  weekday(el) {
    const d = +el.dataset.d;
    store.updateProject(p => {
      const days = p.workDays.filter(x => x !== d);
      if (el.checked) days.push(d);
      if (days.length) p.workDays = days.sort(); // a week needs at least one working day
    });
  },
  /** Change the name, role or contact of someone already on the team. A name cannot be left empty. */
  member(el) {
    const f = el.dataset.f;
    const value = f === 'role' ? chosenValue(el, 'role') : el.value.trim();
    if (value === null) { store.notify(); return; }
    if (f === 'name' && !value) return;
    store.update(ws => { const m = ws.team.find(x => x.id === el.dataset.id); if (m) m[f] = value; });
  },
  memberRate(el) { store.update(ws => { if (ws.team.some(x => x.id === el.dataset.id)) setDayRate(ws, el.dataset.id, field(el)); }); },
  labor(el) { store.update(ws => { ws.laborRates[el.dataset.t] = Math.max(0, field(el)); }); },
};

export const submits = {
  /** v0.24.0: My settings, Report a problem: it joins the Admin's "Problems reported" (sent now, or once online). */
  reportProblem(fd) {
    const what = String(fd.get('what') || '').trim();
    if (!what) return false;
    recordFault({ message: `Reported by ${store.user?.email || 'someone'}: ${what}` }, 'reported');
    flushNow();
    problemNotice = 'Sent to the Admin. Thank you.';
  },
  ...fieldprojects.submits,
  ...fieldusers.submits,
  currency(fd) {
    const code = fd.get('code').trim().toUpperCase();
    const rate = +fd.get('rate');
    if (ALLOWED.includes(code) && rate > 0) store.updateGlobal(g => { g.fx.rates[code] = rate; });
  },
  coOwner(fd) {
    const email = String(fd.get('email') || '').trim().toLowerCase();
    if (!confirm(`Make ${email} an Executive Partner? They can view everything in both divisions, including HR and payroll, but cannot edit, delete or change settings and permissions.`)) return false;
    coOwnerNotice = '';
    store.addCoOwner(email).then(() => { coOwnerNotice = `${email} is an Executive Partner (view only). Publish the latest access rules first, or they will not see the data.`; coOwnerBad = false; store.notify(); })
      .catch(err => { coOwnerNotice = /permission/i.test(`${err.code} ${err.message}`) ? 'The database refused it. Publish the latest access rules first, then try again.' : err.message; coOwnerBad = true; store.notify(); });
    return false;
  },
  transferAdmin(fd) {
    const email = fd.get('email').trim().toLowerCase();
    if (!confirm(`Make ${email} the Admin of Central Hub?\n\nYou will be signed out. Sign in again with ${email} to manage Central Hub. ${store.user.email} stays on as an Office user.`)) return false;
    transferNotice = '';
    store.transferAdmin(email).then(() => store.signOut()).catch(err => {
      transferNotice = /permission/i.test(`${err.code} ${err.message}`) ? 'The database refused it. Publish the latest access rules first, then try again.' : err.message;
      store.notify();
    });
    return false;
  },
  /** Give a person access, in one division and, when chosen, linked to a project; then show them. */
  user(fd) {
    const email = String(fd.get('email') || '').trim().toLowerCase();
    const division = fd.get('division');
    if (!email || !DIVISIONS.some(([k]) => k === division)) { alert('Choose the division first: nobody is given access without one.'); return false; }
    const role = fd.get('role') === 'office' ? 'office' : 'site';
    const pid = String(fd.get('projectId') || '');
    store.setUser(email, { role, projects: pid ? [pid] : [], name: String(fd.get('name') || '').trim(), title: '', divisions: [division] });
    who = email;
    accTab = 'people';
  },
  /** Put a person from the directory on this project's team; their record keeps the role and day rate. */
  fromDirectory(fd, c) {
    const person = c.company.staff.find(x => x.id === fd.get('personId'));
    if (!person) return false;
    const a = { projectId: c.project.id, role: String(fd.get('role') || '').trim(), dayRate: Math.max(0, +fd.get('dayRate') || 0), active: true };
    store.updateCompany(co => { const x = co.staff.find(y => y.id === person.id); x.assignments = [...(x.assignments || []).filter(y => y.projectId !== a.projectId), a]; });
    store.update(ws => assign(ws, person, a));
  },
  member(fd) {
    const name = fd.get('name').trim();
    if (name) store.update(ws => ws.team.push({ id: uid('m'), name, role: fd.get('role').trim(), contact: fd.get('contact').trim(), level: fd.get('level') || 'crew' }));
  },
  trade(fd) {
    const trade = fd.get('trade').trim();
    if (trade) store.update(ws => { ws.laborRates[trade] = Math.max(0, +fd.get('rate') || 0); });
  },
};
