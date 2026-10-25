// App shell: sign-in, routing, project switcher, and one render loop.
// Every view is { render(ctx), actions?, changes?, submits?, onEnter? } and is
// re-rendered from derived state whenever the store changes.

import { firebaseConfig } from './config.js';
import { store } from './core/store.js';
import { derive } from './core/derive.js';
import { todayISO, downloadText } from './core/util.js';
import { html, options, icon } from './ui/dom.js';
import { driveConfig, saveToDrive } from './sync/drive.js';
import { prefs } from './core/prefs.js';
import * as home from './ui/home.js';
import * as dashboard from './ui/dashboard.js';
import * as reports from './ui/reports.js';
import * as schedule from './ui/schedule.js';
import * as ledger from './ui/ledger.js';
import * as prices from './ui/prices.js';
import * as docs from './ui/docs.js';
import * as finance from './ui/finance.js';
import * as trade from './ui/trade.js';
import * as hr from './ui/hr.js';
import * as contracts from './ui/contracts.js';
import * as discuss from './ui/discuss.js';
import * as meetings from './ui/meetings.js';
import * as contactsView from './ui/contacts.js';
import * as evaluation from './ui/evaluation.js';
import * as directory from './ui/directory.js';
import * as letters from './ui/letters.js';
import * as requests from './ui/requests.js';
import * as payroll from './ui/payroll.js';
import * as cashflow from './ui/cashflow.js';
import * as payments from './ui/payments.js';
import * as attendance from './ui/attendance.js';
import * as employment from './ui/employment.js';
import * as signatures from './ui/signatures.js';
import * as setup from './ui/setup.js';
import * as owners from './ui/owners.js';
import { openWizard } from './ui/wizard.js';
import { needsSync, syncTeam } from './engine/people.js';
import { alertCount as contractAlerts } from './engine/contracts.js';
import { alertCount as hrAlerts } from './engine/hr.js';
import { unseenAlerts, unseenCount, alertKeys, summaryOf, headline, moneyOf, markKeysSeen, reportsOf } from './ui/seen.js';
import * as badges from './core/badges.js';
import { autoSync as fieldAutoSync } from './ui/fieldprojects.js';
import { PROJECT_PAGES, TRADING_PAGES, SETTINGS_PAGES, pageOn, appOn, adminOnly, permKey, MONEY_PAGES } from './core/access.js';
import { scopedCompany, setCurrentDivision } from './core/division.js';
import { ALIASES, REDIRECT, baseOf, switchOf, resolve, hubsOf, pagesIn, divisionsOf, divisionFor, divisionLabel, PHONE_TABS } from './core/nav.js';
import { healthOf } from './engine/today.js';
import { footCss } from './ui/print.js';
import { openPalette } from './ui/palette.js';
import { showFind, refind } from './ui/finder.js';
import { buildIndex, indexPages } from './ui/searchindex.js';
import { describe as describeSession } from './engine/session.js';
import * as diagnostics from './core/diagnostics.js';
import { APP_VERSION } from './version.js';
import { describePaper, makePdf, canShareFile, shareFile, whatsappUrl, TELEGRAM_URL, downloadFile, sizeLabel } from './sync/share.js';
import { phoneDigits, whatsappTo, telegramTo } from './engine/contacts.js';

const APP = 'Amistad Prefab Central Hub';
const VIEWS = { home, dashboard, reports, schedule, ledger, evaluation, directory, letters, requests, payroll, cashflow, payments, docs, apps: prices, prices, access: prices, catalog: prices, company: prices, links: prices, finance, trade, stock: trade, hr, contracts, discuss, meetings, attendance, employment, signatures, setup, owners, contacts: contactsView };
// a second way into a screen that is already there (Invoices, Income, Status report...) uses the same screen
for (const [id, a] of Object.entries(ALIASES)) VIEWS[id] ||= VIEWS[a.view];
// screens about the whole company, not the open project
const COMPANY_VIEWS = { home: 'What needs you, across all projects', discuss: 'Messages between the people of Amistad', meetings: 'Meetings with colleagues, and those booked by clients and suppliers', finance: 'Construction and trading, in one currency', trade: 'Trading: buying and shipping', stock: 'Trading: stock and sales', hr: 'Staff and agreements, Admin only', letters: 'Letters of the office, Admin only', payroll: 'Monthly payroll, Admin only', contracts: 'Clients, suppliers and subcontractors',
  apps: 'Choose what Amistad uses', access: 'Who may sign in and what they may open', catalog: 'Shared by every project', company: 'Printed on every document' };
Object.assign(COMPANY_VIEWS, { summary: COMPANY_VIEWS.finance, crewletters: COMPANY_VIEWS.letters, employment: 'Employment agreements, Admin only', documentsign: 'Documents sent for signature', contacts: 'Email addresses and phone numbers, saved once', tradesummary: 'Trading: stock, sales and what is owed', owners: 'The owners of the company, Admin only' });
const TITLES = { home: 'Today', discuss: 'Discuss', meetings: 'Meetings', dashboard: 'Overview', reports: 'Daily report', schedule: 'Schedule', ledger: 'Costs', evaluation: 'Evaluation', directory: 'Staff directory', letters: 'Letters', requests: 'Requests', payroll: 'Payroll', cashflow: 'Cash flow', payments: 'Payments', docs: 'Invoices and documents', apps: 'Apps', prices: 'This project', access: 'People and access', catalog: 'Currencies', company: 'Company details', links: 'Field Report and import', finance: 'Company finance', trade: 'Shipments', stock: 'Stock and sales', hr: 'HR', contracts: 'Contracts' };
Object.assign(TITLES, { ledger: 'Ledger', reports: 'Daily field report', hr: 'Employee data', payroll: 'Salary', contracts: 'Agreements', requests: 'Material & manpower request', docs: 'Invoices', setup: 'Setup', owners: 'Company owners', contacts: 'Contacts' });
for (const [id, a] of Object.entries(ALIASES)) TITLES[id] = a.title;
// The menu is in core/nav.js: two divisions, each with its own sections, each section a row of tabs.
let division = (() => { try { return localStorage.getItem('sf:division') || 'installation'; } catch { return 'installation'; } })();
setCurrentDivision(division);
const myDivisions = () => divisionsOf({ role: store.role, divisions: store.divisions });
/** The company's records of the open division only: a page cannot mix the two businesses. */
const scoped = () => scopedCompany(store.company, division);
const hubs = () => hubsOf(division);
const hubOf = name => hubs().find(h => h.tabs.includes(name));
/** The page a section opens on: the one last opened in it, else its first page this person may open (v0.22.0: no grid of tiles). */
const entryOf = h => { const tabs = h.tabs.filter(allowed); return lastTab[h.id] && tabs.includes(lastTab[h.id]) ? lastTab[h.id] : tabs[0]; };
function setDivision(d) {
  division = d;
  setCurrentDivision(d);
  try { localStorage.setItem('sf:division', d); } catch { /* the choice is just not remembered */ }
}
const lastTab = {};   // hub id -> the tab last opened in it, so a section reopens where it was left
// What "+ New" offers. `act` runs that screen's own action; `focus` puts the cursor in its entry form.
const QUICK = [
  { label: 'Daily report', view: 'reports', focus: '[name=by]' },
  { label: 'Invoice', view: 'invoices', act: 'newInvoice' },
  { label: 'Quotation', view: 'quotations', act: 'newQuote' },
  { label: 'Cost or payment received', view: 'ledger', focus: '[name=description]' },
  { label: 'Follow-up', view: 'dashboard', focus: '[name=title]' },
  { label: 'Schedule task', view: 'schedule', act: 'add', office: true },
  { label: 'Shipment', view: 'trade', act: 'add' },
  { label: 'Contract', view: 'contracts', act: 'add' },
];
let pending = null;   // a quick action waiting for its screen to be drawn
/** "+ New" offers only what belongs to the open division: no daily report or invoice while in Trading (v0.22.3). */
const quickOk = q => allowed(q.view) && pagesIn(division).includes(q.view) && !(q.office && isSite());
const ROLE_NAME = { owner: 'Admin', office: 'Office', site: 'Site' };
const SIDE_KEY = 'sf:side';
const NEW_PROJECT = '__new';
const TOAST_MS = 5000;
const UNDO_MS = 60 * 1000;   // the Undo stays a minute unless used or replaced

const $ = sel => document.querySelector(sel);
const root = $('#view');
$('#app-version').textContent = APP_VERSION;
diagnostics.install();
addEventListener('hub-toast', e => toast(e.detail));   // short messages from code that has no page of its own (see core/image.js)   // anything nobody handled is logged quietly and sent to the Admin later
let ctx, queued = false, lastKey = '';
let syncingTeam = false;
let timer = 0, deferred = false;
let byUser = false;   // the pending redraw was caused by something this person did on the page
let fresh = false;    // ...and it should start the forms from scratch (a submit, a Cancel)
let typing = false;   // something was typed since the last redraw
const DEFER_MS = 1000;
const TEXT_ENTRY = 'input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea';

// A redraw replaces the page, so what was typed into a form but not saved yet is carried over.
// Only fields the person changed are carried: untouched ones take the fresh values.
const LOOSE = 'input:not([data-chg]):not([type=file]), textarea:not([data-chg]), select:not([data-chg])';
const ticked = el => el.type === 'checkbox' || el.type === 'radio';
const signature = el => `${el.tagName}|${el.type}|${el.name}`;
const changedByUser = el => (ticked(el) ? el.checked !== el.defaultChecked
  : el.tagName === 'SELECT' ? [...el.options].some(o => o.selected !== o.defaultSelected)
  : el.value !== el.defaultValue);
const captureFields = () => [...root.querySelectorAll(LOOSE)].map(el => ({
  sig: signature(el), dirty: changedByUser(el), value: ticked(el) ? el.checked : el.value,
}));
function restoreFields(kept) {
  const now = [...root.querySelectorAll(LOOSE)];
  // the same form must still be on screen, field for field
  if (now.length !== kept.length || now.some((el, i) => signature(el) !== kept[i].sig)) return false;
  let any = false;
  now.forEach((el, i) => {
    const k = kept[i];
    if (!k.dirty) return;
    if (ticked(el)) el.checked = k.value;
    else if (el.tagName !== 'SELECT' || [...el.options].some(o => o.value === k.value)) el.value = k.value;
    any = true;
  });
  return any;
}

// A redraw rebuilds the page, which would send every scrolled list and form back to its top.
// Each scrolled box is remembered by where it sits in the page and put back afterwards.
const boxPath = el => {
  const path = [];
  for (let n = el; n !== root; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
  return path;
};
const captureScroll = () => [root, ...root.querySelectorAll('*')].filter(e => e.scrollTop > 0 || e.scrollLeft > 0)
  .map(e => ({ path: boxPath(e), tag: e.tagName, left: e.scrollLeft, top: e.scrollTop }));
function restoreScroll(saved) {
  for (const s of saved) {
    let el = root;
    for (const i of s.path) el = el?.children[i];
    if (el && el.tagName === s.tag) { el.scrollLeft = s.left; el.scrollTop = s.top; }
  }
}

const isSite = () => store.role === 'site';
// A page opens when this person has been given it and, for a project page, the project has not switched it off.
const allowed = raw => {
  const name = resolve(raw);
  const sw = switchOf(name);
  return !!VIEWS[name] && divisionFor(name, division, myDivisions()) !== null && store.can(name) && appOn(store.global, permKey(name))
    && (!PROJECT_PAGES.includes(sw) || pageOn(store.project, sw));
};
const route = () => {
  const raw = location.hash.slice(1);
  if (raw.startsWith('s-')) {
    const h = hubs().find(x => x.id === raw.slice(2));
    return (h && entryOf(h)) || 'home';
  }
  const name = resolve(raw);
  if (!allowed(name)) return 'home';
  const d = divisionFor(name, division, myDivisions());
  if (d !== division) setDivision(d);   // a link into the other division opens it
  return name;
};

const PERCENT_MEANS = {
  work: 'Work done, from the schedule and the daily reports',
  billed: 'Share of the contract value invoiced. This project has no schedule tasks yet, so there is no work progress to show',
  none: 'No schedule tasks and no invoices yet',
};

let lastCounts = { raw: {}, key: {} };   // what the red numbers counted at the last draw, for Mark as read
let lastShown = {};                      // the red numbers as the menu shows them (after Mark as read), for the apps on Home

let lastSummaries = [];

/** Mark things as read: the pages of the open section, or everything (every section and every project's alerts). */
function markRead(scope) {
  const pages = scope === 'all' ? Object.keys(lastCounts.raw) : (hubOf(resolve(location.hash.slice(1) || 'home')) || { tabs: [] }).tabs;
  for (const page of pages) {
    if (page === 'dashboard') { if (ctx) markKeysSeen(store.project.id, alertKeys(ctx.flags)); }
    else if (page === 'discuss') discuss.markAllRead(scoped());
    else if (page === 'meetings') meetings.markAllSeen(scoped());
    else if (lastCounts.key[page]) badges.dismiss(lastCounts.key[page], lastCounts.raw[page] || 0);
  }
  if (scope === 'all') for (const s of lastSummaries) if (s.project.id !== store.project?.id && s.keys) markKeysSeen(s.project.id, s.keys);
  refresh();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-markread]');
  if (b) markRead(b.dataset.markread);
});

function renderSidebar(name, summaries) {
  lastSummaries = summaries;
  const p = store.project;
  // the division switch: only for someone who works in both
  const mine = myDivisions();
  $('#division').hidden = mine.length < 2;
  $('#division').innerHTML = String(html`${mine.map(d => html`<button type="button" data-division="${d}" class="${d === division ? 'on' : ''}" aria-pressed="${d === division}">${divisionLabel(d)}</button>`)}`);
  const installation = division === 'installation';
  const choices = String(html`${options(store.projects.map(x => [x.id, x.name]), p?.id)}
    ${store.isAdmin ? html`<option value="${NEW_PROJECT}">+ New project</option>` : ''}`);
  // the same chooser twice: under the division switch in the menu (wide screens), and in the page header (phones, narrow menu)
  $('#project-select').innerHTML = choices;
  $('#side-project-select').innerHTML = choices;
  $('#btn-new-project').hidden = !store.isAdmin || !installation;
  $('#project-pick').hidden = !installation || !(store.projects.length || store.isAdmin);
  $('#side-project').hidden = $('#project-pick').hidden;
  $('#btn-settings').hidden = !store.isAdmin || !p;
  $('#btn-settings').href = `#${lastTab.settings || 'prices'}`;
  // deleting and settings are the Admin's: their buttons are hidden for everyone else
  document.body.classList.toggle('not-admin', !store.isAdmin);

  // red numbers: alerts on this project not opened yet, late shipments, contract dates, staff papers
  const unseen = ctx ? unseenAlerts(p.id, ctx.flags).size : 0;
  const late = store.can('trade') ? trade.lateCount(scoped(), todayISO()) : 0;
  const dated = store.can('contracts') ? contractAlerts(scoped().contracts, todayISO()) : 0;
  const people = store.isAdmin ? hrAlerts(scoped().staff, todayISO()) : 0;
  // requests waiting for an answer: the approvers' number
  const asked = ctx && store.role !== 'site' ? ctx.ws.requests.filter(r => r.status === 'requested').length : 0;
  // what the project still needs before it runs smoothly: the essentials left on its checklist
  const toSet = ctx && store.isAdmin ? setup.itemsOf(ctx).remaining : 0;
  const raw = { setup: toSet, requests: asked, dashboard: unseen, trade: late, contracts: dated, hr: people, discuss: name === 'discuss' ? 0 : discuss.unreadCount(scoped(), division), access: store.requests.length, meetings: name === 'meetings' || !store.can('meetings') ? 0 : meetings.unseenCount(scoped()) };
  // the counts that are only counts can be marked as read; alerts, chat and meetings remember what was opened
  const key = { setup: `${p?.id}:setup`, requests: `${p?.id}:requests`, trade: `${division}:trade`, contracts: `${division}:contracts`, hr: `${division}:hr`, access: 'access' };
  lastCounts = { raw, key };
  const settled = !store.loading && store.settled;   // while records are still arriving, a low count says nothing
  const count = Object.fromEntries(Object.entries(raw).map(([page, n]) => [page, key[page] ? badges.shown(key[page], n, settled) : n]));
  lastShown = count;
  const badge = n => (n ? html`<em>${n}</em>` : '');
  const here = hubOf(name);

  // the menu: one link per section that has at least one page this person may open; the Team pages at the foot
  const link = h => {
    const tabs = h.tabs.filter(allowed);
    if (!tabs.length) return '';
    return html`
      <a href="#${entryOf(h)}" class="side-link ${h === here ? 'on' : ''}" title="${h.label}" ${h === here ? html`aria-current="page"` : ''}>
        ${icon(h.icon)}<span>${h.label}</span>${badge(tabs.reduce((n, t) => n + (count[t] || 0), 0))}
      </a>`;
  };
  const teamLinks = !p ? [] : hubs().filter(h => h.team).map(link).filter(String);
  $('#nav-hubs').innerHTML = String(html`${!p ? '' : hubs().filter(h => !h.team).map(link)}
    ${teamLinks.length ? html`<div class="side-label">Team</div>${teamLinks}` : ''}`);
  // the open project's health under the chooser: progress and days behind, with a coloured dot
  const own = summaries.find(s => s.project === p);
  const health = own ? healthOf(own) : null;
  $('#side-health').hidden = !health || $('#side-project').hidden;
  $('#side-health').innerHTML = health ? String(html`<i class="dot ${health.tone}"></i><span>${Math.round(own.progress || 0)} % · ${health.label}</span>`) : '';
  // the phone's five tabs: Today, Project, Reports, Money, and More (the whole menu as a sheet)
  $('#phone-tabs').innerHTML = String(html`${!p ? '' : PHONE_TABS.map(([id, label]) => {
    const h = hubs().find(x => x.id === id);
    const to = h && entryOf(h);
    if (!to) return '';
    return html`<a href="#${to}" class="ptab ${h === here ? 'on' : ''}">${icon(h.icon)}<span>${label}</span>${badge(h.tabs.filter(allowed).reduce((n, t) => n + (count[t] || 0), 0))}</a>`;
  })}<button type="button" class="ptab ${document.body.classList.contains('more-open') ? 'on' : ''}" id="phone-more" aria-expanded="${document.body.classList.contains('more-open')}">${icon('apps')}<span>More</span></button>`);
  // the tabs of the open section, across the top of the page
  const tabs = here && p ? here.tabs.filter(allowed) : [];
  $('#tabs').innerHTML = String(html`${tabs.map(t => html`
    <a href="#${t}" class="tab ${t === name ? 'on' : ''}" ${t === name ? html`aria-current="page"` : ''}>${TITLES[t]}${badge(count[t])}</a>`)}
    ${here && PROJECT_PAGES.includes(switchOf(name)) && here.id !== 'projects' ? html`<span class="muted tab-note">For ${p.name}</span>` : ''}
    ${tabs.some(t => count[t]) ? html`<button type="button" class="tab mark-read" data-markread="hub" title="Hide the red numbers of this section until something new needs attention">✓ Mark as read</button>` : ''}`);
  // a section with a single page needs no row of tabs
  // Settings lists its pages down the left of the page instead
  $('#tabs').hidden = !here || !p || tabs.length < 2 || here.id === 'settings';

  $('#nav-foot').innerHTML = String(html`
    ${store.cloud ? html`<div class="side-user"><span title="${store.user.email}">${store.user.email}</span><button type="button" class="btn ghost small" id="btn-signout">Sign out</button></div>` : ''}`);
  $('#role-badge').textContent = store.cloud ? (store.readOnly ? 'Executive Partner, view only' : ROLE_NAME[store.role] || '') : 'Demo';
  $('#role-badge').title = store.cloud ? `Signed in as ${store.user.email}` : 'Demo data kept in this browser. Nobody is signed in.';
  $('#quick-menu').innerHTML = String(html`${!p ? '' : QUICK.filter(q => quickOk(q)).map((q, i) => html`<button type="button" data-q="${i}">${q.label}</button>`)}`);
  $('#quick').hidden = !p || !$('#quick-menu').children.length;
}

function render() {
  queued = false;
  const name = route();
  const view = VIEWS[name];
  const p = store.project;
  const today = todayISO();
  const key = p ? `${name}|${p.id}` : '';
  if (TRADING_PAGES.includes(name)) trade.setTab(name === 'stock' ? 'stock' : 'ship');
  if (SETTINGS_PAGES.includes(name)) prices.setSection(name);

  // A change from somewhere else (another person, a background check) arrived while this
  // person is typing in a field: wait until they leave it rather than redraw under them.
  const active = document.activeElement;
  if (!byUser && typing && key && key === lastKey && !store.loading && root.contains(active) && active.matches(TEXT_ENTRY)) {
    refresh(DEFER_MS);
    return;
  }
  const keepForms = !fresh, wasTyping = typing;
  byUser = false; fresh = false; typing = false;

  // nothing to show yet: no project, or the project's data is still arriving
  if (!p || store.loading) {
    ctx = null;
    renderSidebar(name, store.projects.map(x => ({ project: x, progress: x.summary?.progress || 0, basis: x.summary?.basis, slip: x.summary?.slip || 0 })));
    $('#page-title').textContent = p ? TITLES[name] : APP;
    $('#project-meta').textContent = '';
      root.className = 'view';
    root.innerHTML = String(html`<p class="empty">${p ? 'Loading project…'
      : isSite() ? 'No project has been assigned to you yet. Ask the Admin to add you to one.'
      : 'No projects yet. Create the first one with “+ New project” in the sidebar.'}</p>`);
    lastKey = '';
    return;
  }

  ctx = { ...derive(p, store.ws, store.global, today), role: store.role, company: scoped(), division, admin: store.isAdmin, money: store.seesMoney };
  // an alert that leads to a page this person cannot open, or that the project has switched off, is not shown
  ctx.flags.auto = ctx.flags.auto.filter(f => allowed(f.link));
  // the directory is the master: team members linked to it follow it. Only the Admin holds the directory, so only the Admin brings the team up to date.
  if (store.isAdmin && !store.readOnly && !syncingTeam && needsSync(store.ws.team, store.company.staff, p.id, store.ws.crewRates || [])) {
    syncingTeam = true;
    queueMicrotask(() => { store.update(ws => syncTeam(ws, store.company.staff, p.id)); syncingTeam = false; });
  }

  // Sidebar progress for the other projects: derived from their own workspaces in local mode,
  // read from the summary saved on each project in the cloud (only the open project is loaded there).
  // The red number on a project is its alerts this person has not opened yet. A Site user cannot
  // open every alert, so for them it is shown for the open project only.
  const summaries = store.projects.map(x => {
    if (x === p) return { project: x, keys: alertKeys(ctx.flags), ...headline(ctx), slip: ctx.sched.slip, unseen: unseenAlerts(p.id, ctx.flags).size, money: store.seesMoney ? moneyOf(ctx) : null, budget: ctx.led.budget, ...reportsOf(ctx.ws) };
    if (store.cloud) return { project: x, keys: x.summary?.alerts || [], progress: x.summary?.progress || 0, basis: x.summary?.basis, slip: x.summary?.slip || 0, unseen: isSite() ? 0 : unseenCount(x.id, x.summary?.alerts), money: store.seesMoney ? x.summary?.money || null : null, budget: x.budget || 0, waiting: x.summary?.waiting || 0, lastReport: x.summary?.lastReport || '' };
    const d = derive(x, store.peek(x.id), store.global, today);
    return { project: x, keys: alertKeys(d.flags), ...headline(d), slip: d.sched.slip, unseen: unseenCount(x.id, alertKeys(d.flags)), money: moneyOf(d), budget: d.led.budget, ...reportsOf(d.ws) };
  });
  ctx.summaries = summaries;
  ctx.can = allowed;
  renderSidebar(name, summaries);
  ctx.counts = lastShown;
  if (appOn(store.global, 'discuss')) discuss.announce(scoped(), name === 'discuss');   // a ring and a note for a new message
  if (appOn(store.global, 'meetings') && store.can('meetings')) meetings.announce(scoped());   // a note for a new invitation
  store.saveSummary(summaryOf(ctx));

  $('#page-title').textContent = TITLES[name];
  $('#project-meta').textContent = (name === 'trade' && division === 'installation' ? 'Shipments bought for the projects' : name === 'home' && division === 'trading' ? 'What needs you in Trading' : COMPANY_VIEWS[name]) || [p.location, MONEY_PAGES.includes(permKey(name)) ? p.currency : ''].filter(Boolean).join(' · ');   // the project is in the chooser; the currency only where money is shown
  if (hubOf(name)) lastTab[hubOf(name).id] = name;
  document.title = COMPANY_VIEWS[name] ? `${TITLES[name]} · ${APP}` : `${TITLES[name]} · ${p.name} · ${APP}`;

  // keep focus and scroll position across the re-render
  const focusKey = document.activeElement?.dataset?.fk;
  const scroll = key === lastKey ? captureScroll() : [];
  const kept = keepForms && key === lastKey ? captureFields() : null;
  root.className = `view view-${baseOf(name) === 'stock' ? 'trade' : SETTINGS_PAGES.includes(name) ? 'prices' : baseOf(name)}`;
  // opened from the menu as Invoices, Income, Status report...: the screen starts the way that entry means
  if (key !== lastKey) view.preset?.(ALIASES[name]?.preset || {});
  try {
    root.innerHTML = String(view.render(ctx));
    groupShare(root);
    printFoot(root);
  } catch (err) {
    // one broken page must not take the rest of the app down
    diagnostics.record(err, `render ${name}`);
    root.innerHTML = String(html`<section class="card"><h2>This page could not be shown</h2>
      <p class="muted">The problem was saved quietly and the Admin will see it. The rest of Central Hub still works.</p>
      <div class="actions left"><a class="btn primary" href="#home">Go to Today</a><button class="btn" type="button" onclick="location.reload()">Reload</button></div></section>`);
  }
  if (kept && restoreFields(kept)) typing = wasTyping;
  if (key === lastKey) {
    restoreScroll(scroll);
  } else {
    root.scrollTop = 0;
    view.onEnter?.(root, ctx);
    if (!lastKey.endsWith(`|${p.id}`)) checkSoon();
  }
  $('#btn-print').hidden = name === 'home' || !!root.querySelector('.share-menu, [data-act="print"], [data-act="printDoc"]');
  lastKey = key;
  fieldAutoSync();   // keeps Field Report's projects in step with this one when that is switched on
  if (findNext) { showFind(root, findNext); findNext = ''; } else refind(root);   // the words that were searched for stay marked
  if (focusKey) root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus();

  // a quick action chosen from "+ New" or the search box runs once its screen is on the page
  if (pending && pending.view === name) {
    const q = pending;
    pending = null;
    if (q.act) { byUser = true; view.actions?.[q.act]?.(root, ctx); refresh(); }
    else root.querySelector(q.focus)?.focus();
  }
}

// v0.22.1: the document on screen gives the footer printed on every page (company, document, reference, date)
function printFoot(box) {
  let style = document.getElementById('print-foot');
  if (!style) { style = document.createElement('style'); style.id = 'print-foot'; document.head.append(style); }
  const papers = [...box.querySelectorAll('.paper[data-foot]')];
  style.textContent = footCss(papers.length ? papers[0].dataset.foot : '');
}

// v0.22.0: one "Print and share" menu on every page instead of a row of Print, Email, WhatsApp and CSV buttons.
// The buttons themselves move into the menu, so each still does what its page says.
const SHARE_ORDER = ['print', 'printDoc', 'email', 'emailDoc', 'emailSlip', 'share', 'csv'];
const shareKey = b => (b.hasAttribute('data-share') ? 'share' : b.dataset.act);
function groupShare(box) {
  for (const bar of box.querySelectorAll('.toolbar')) {
    const items = [...bar.children].filter(b => b.matches('button, a') && SHARE_ORDER.includes(shareKey(b)));
    if (items.length < 2) continue;
    const menu = document.createElement('details');
    menu.className = 'share-menu no-print';
    menu.innerHTML = '<summary class="btn">Print and share</summary><div class="menu" role="menu"></div>';
    items[0].before(menu);
    const list = menu.querySelector('.menu');
    for (const b of items.sort((x, y) => SHARE_ORDER.indexOf(shareKey(x)) - SHARE_ORDER.indexOf(shareKey(y)))) {
      b.classList.remove('btn', 'primary', 'ghost', 'small');
      b.classList.add('menu-item');
      b.setAttribute('role', 'menuitem');
      if (shareKey(b) === 'print' || shareKey(b) === 'printDoc') b.textContent = 'Print or save as PDF';
      list.append(b);
    }
  }
}
// a menu closes when something in it is chosen, or something else is clicked
document.addEventListener('click', e => {
  for (const m of document.querySelectorAll('.share-menu[open]')) if (!m.contains(e.target) || e.target.closest('.menu-item')) m.open = false;
});

/** Go to a page; `before` runs first (for example to select the record to show there). */
function goTo(page, before) {
  before?.();
  if (location.hash === `#${page}`) refresh(); else location.hash = `#${page}`;
}
function startNew(q) {
  pending = q;
  goTo(q.view);
}

/** Everything the search box can find, built from what this person may open right now (see ui/searchindex.js). */
function searchItems() {
  const items = [];
  const add = (kind, label, hint, run) => { if (label) items.push({ kind, label, hint, body: '', run, nofind: true }); };
  const seen = new Set();
  const installation = division === 'installation';
  for (const h of hubsOf(division)) for (const t of h.tabs.filter(allowed)) {
    if (seen.has(t)) continue;
    seen.add(t);
    add('Page', TITLES[t], h.label, () => goTo(t));
  }
  for (const q of QUICK.filter(x => quickOk(x))) add('New', q.label, 'Start a new one', () => startNew(q));
  if (installation) for (const p of store.projects) {
    add('Project', p.name, 'Open this project', () => { store.switchTo(p.id); goTo(allowed('dashboard') ? 'dashboard' : 'home'); });
    if (p.client?.name && store.can('docs')) add('Client', p.client.name, p.name, () => { store.switchTo(p.id); goTo('docs'); });
  }
  if (ctx) items.push(...buildIndex(indexEnv()));
  return items;
}

/** What the search index needs to know (ui/searchindex.js). */
const indexEnv = () => ({
  store, company: scoped(), ctx, allowed, goTo, division, titles: TITLES, views: VIEWS, baseOf, hubs: hubsOf(division),
  focus: { hr, contracts, trade, docs, schedule, letters, owners, payroll },
  settings: { get: prices.getSection, set: prices.setSection },
});

/** The words just searched for are marked on the page that opens. */
let findNext = '';
const palette = () => openPalette(searchItems(), {
  onChoose: (text, item) => { if (!item.nofind) findNext = text; },
  later: (push, cancelled) => indexPages({ ...indexEnv(), cancelled }, push),
  extra: text => [{ kind: 'This page', label: `Find "${text}" on this page`, hint: 'Marks every match here', body: '', run: () => showFind(root, text) }],
});

// A timer rather than a microtask: a `change` event fires before focus moves to
// the next field, and the render has to run after that to restore focus correctly.
function refresh(delay = 0) {
  // something this person did does not wait behind a postponed redraw
  if (queued && deferred && delay === 0) { clearTimeout(timer); queued = false; }
  if (!queued) { queued = true; deferred = delay > 0; timer = setTimeout(render, delay); }
}

function dispatch(kind, attr, e) {
  const el = e.target.closest(`[data-${attr}]`);
  const handler = ctx && el && VIEWS[route()][kind]?.[el.dataset[attr]];
  if (!handler) return;
  byUser = true;
  // deleting, and anything that is a setting, is the Admin's alone
  if (!store.isAdmin && adminOnly(route(), el.dataset[attr])) {
    if (kind === 'submits') e.preventDefault();
    toast('Only the Admin can do that.');
    fresh = true;   // put a changed field back as it was
    refresh();
    return;
  }
  store.userEdit(true);   // what this handler deletes or clears can be undone
  try {
    if (kind === 'submits') {
      e.preventDefault();
      // a submit empties its form, unless the handler says nothing was saved (returns false)
      if (handler(new FormData(el), ctx, el) !== false) fresh = true;
    } else {
      handler(el, ctx, e);
      if (el.hasAttribute('data-fresh')) fresh = true;
    }
  } catch (err) {
    diagnostics.record(err, `${kind} ${el.dataset[attr]}`);
    toast('That did not work. The problem was saved quietly.');
    fresh = true;
  } finally {
    store.userEdit(false);
  }
  refresh();
}
root.addEventListener('click', e => dispatch('actions', 'act', e));
$('#division').addEventListener('click', e => {
  const b = e.target.closest('[data-division]');
  if (!b || b.dataset.division === division) return;
  setDivision(b.dataset.division);
  // stay on the page when the other division has it too, otherwise start at Home
  if (!pagesIn(division).includes(resolve(location.hash.slice(1)))) location.hash = '#home';
  refresh();
});

// "WhatsApp / Telegram" on any printable page: the page's sheet becomes a PDF file, and a bar offers to send it.
// The file is made first and the share sheet opens on a second tap, because a browser only opens it
// for a tap that has just happened, and making the PDF can take a few seconds.
let sharing = false;
root.addEventListener('click', async e => {
  const button = e.target.closest('[data-share]');
  if (!button || sharing) return;
  const paper = root.querySelector('.paper');
  if (!paper) { toast('There is no document on this page to send.'); return; }
  sharing = true;
  button.disabled = true;
  toast('Preparing the PDF…');
  try {
    const info = describePaper(paper);
    const file = await makePdf(paper, info.name);
    showShareBar(file, button.dataset.text || info.text);
  } catch (err) {
    diagnostics.record(err, 'share');
    toast(`The PDF could not be made (${err.message}). Use Print, then Save as PDF.`);
  }
  sharing = false;
  button.disabled = false;
});

function showShareBar(file, text) {
  const bar = $('#share');
  const can = canShareFile(file);
  $('#share-text').textContent = `${file.name} is ready (${sizeLabel(file.size)}).${can ? '' : ' Download it, then attach it in the chat.'}`;
  $('#share-send').hidden = !can;
  $('#share-wa').hidden = can;
  $('#share-tg').hidden = can;
  $('#share-wa').href = whatsappUrl(text);
  $('#share-tg').href = TELEGRAM_URL;
  // a saved contact with a phone number: WhatsApp and Telegram open on that person
  const withPhone = (store.company?.contacts || []).filter(x => phoneDigits(x.phone));
  const pick = $('#share-contact');
  pick.hidden = !withPhone.length;
  pick.replaceChildren(new Option('Send to a saved contact…', ''), ...withPhone.map(x => new Option(`${x.name} ${x.phone}`, x.id)));
  pick.onchange = () => {
    const who = withPhone.find(x => x.id === pick.value);
    $('#share-wa').hidden = !who && can;
    $('#share-tg').hidden = !who && can;
    $('#share-wa').href = who ? whatsappTo(who.phone, text) : whatsappUrl(text);
    $('#share-tg').href = who ? telegramTo(who.phone) : TELEGRAM_URL;
    $('#share-wa').textContent = who ? `WhatsApp ${who.name}` : 'Open WhatsApp';
    $('#share-tg').textContent = who ? `Telegram ${who.name}` : 'Open Telegram';
  };
  $('#share-wa').textContent = 'Open WhatsApp';
  $('#share-tg').textContent = 'Open Telegram';
  $('#share-send').onclick = async () => {
    try { if (await shareFile(file, text) === 'shared') bar.hidden = true; }
    catch (err) { diagnostics.record(err, 'share'); toast('Sharing did not work here. Download the PDF and attach it in the chat.'); }
  };
  $('#share-dl').onclick = () => downloadFile(file);
  $('#share-x').onclick = () => { bar.hidden = true; };
  toast('The PDF is ready.');
  bar.hidden = false;
}
root.addEventListener('change', e => dispatch('changes', 'chg', e));
root.addEventListener('submit', e => dispatch('submits', 'form', e));

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, TOAST_MS);
}

// ---- shell controls ----

/** New project: the three-step wizard (ui/wizard.js). */
function newProject() { openWizard(); }
$('#btn-new-project').addEventListener('click', newProject);
$('#btn-print').addEventListener('click', () => print());
$('#btn-search').addEventListener('click', palette);
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && store.project) { e.preventDefault(); palette(); }
  if (e.key === 'Escape' && root.querySelector('.drawer')) { root.querySelector('.drawer-hd [data-act]')?.click(); return; }
  // single keys only when no field has the cursor (v0.22.0): / search, n new
  if (e.ctrlKey || e.metaKey || e.altKey || !store.project || e.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
  if (e.key === '/') { e.preventDefault(); palette(); }
  else if (e.key === 'n' && !$('#quick').hidden) { e.preventDefault(); $('#quick').open = true; }
});
// the phone's More: the whole menu as a sheet over the page; choosing a page closes it
document.addEventListener('click', e => {
  if (e.target.closest('#phone-more')) { document.body.classList.toggle('more-open'); refresh(); }
  else if (e.target.closest('.sidebar a, .sidebar-x')) document.body.classList.remove('more-open');
});
addEventListener('hashchange', () => document.body.classList.remove('more-open'));
$('#quick-menu').addEventListener('click', e => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  $('#quick').open = false;
  startNew(QUICK[+b.dataset.q]);
});
// the "+ New" list closes when something else is clicked
document.addEventListener('click', e => { if (!e.target.closest('#quick')) $('#quick').open = false; });
const narrow = on => {
  document.body.classList.toggle('side-narrow', on);
  try { localStorage.setItem(SIDE_KEY, on ? 'narrow' : ''); } catch { /* the menu just opens wide next time */ }
};
$('#btn-collapse').addEventListener('click', () => narrow(!document.body.classList.contains('side-narrow')));
try { if (localStorage.getItem(SIDE_KEY) === 'narrow') document.body.classList.add('side-narrow'); } catch { /* no saved choice */ }
const pickProject = e => {
  if (e.target.value !== NEW_PROJECT) return store.switchTo(e.target.value);
  e.target.value = store.project?.id || '';
  newProject();
};
$('#project-select').addEventListener('change', pickProject);
$('#side-project-select').addEventListener('change', pickProject);

/** Forget the saved app files (not the records) and load the newest version. Needs the internet, to fetch it again. */
async function clearCache() {
  if (navigator.onLine === false) { alert('You are offline. Clearing the cache needs the internet to load the app again. Try when you are connected.'); return; }
  if (!confirm('Clear the saved app files on this device and reload? Your records, and changes still waiting to be sent, are kept.')) return;
  try { for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister(); } catch { /* none */ }
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* none */ }
  location.reload();
}

const status = text => { $('#bk-status').textContent = text; };
const snapshot = async () => JSON.stringify(await store.exportAll(), null, 2);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_LAST = 'sf:backup-last';   // when the last weekly copy was saved (kept on the Admin's account: every device knows it)
const BACKUP_EVERY = 7 * 864e5;
/** The weekly full copy to Drive: only the first Admin, only with the backup link set up, only when the last one is a week old. */
async function weeklyBackup() {
  if (!store.cloud || !store.isAdmin || store.readOnly || !store.isPrimary || store.loading || !store.settled) return;
  const { endpoint, token } = driveConfig.get();
  if (!endpoint || !token) return;
  if (Date.now() - (+prefs.get(BACKUP_LAST) || 0) < BACKUP_EVERY) return;
  try {
    await saveToDrive(`central-hub-weekly-${stamp()}.json`, await snapshot());
    prefs.set(BACKUP_LAST, Date.now());
  } catch { /* tried again at the next check */ }
}
const backupLine = () => {
  const last = +prefs.get(BACKUP_LAST) || 0;
  return last ? `Last weekly copy to Drive: ${new Date(last).toLocaleString()}. The next one is made by itself a week later, when you have Central Hub open.` : 'No weekly copy yet. Once the web app link and secret are set, Central Hub saves a full copy to Drive by itself once a week, while you have it open.';
};

document.addEventListener('click', e => {
  if (e.target.closest('#btn-signout')) { store.signOut(); return; }
  if (e.target.closest('#btn-clear-cache')) { clearCache(); return; }
  if (!e.target.closest('#btn-backup')) return;
  const cfg = driveConfig.get();
  $('#bk-endpoint').value = cfg.endpoint || '';
  $('#bk-token').value = cfg.token || '';
  $('#bk-reply').value = cfg.replyTo || '';
  $('#bk-where').textContent = store.cloud
    ? 'Data is stored in your Firebase project and shared with everyone who has access. Export a copy from time to time.'
    : 'Data is stored in this browser. Export it regularly, or push a snapshot to Google Drive through your Apps Script web app.';
  $('#bk-reset').hidden = store.cloud;
  $('#bk-last').textContent = store.cloud && store.isAdmin ? backupLine() : '';
  status('');
  $('#dlg-backup').showModal();
});
$('#bk-export').addEventListener('click', async () => downloadText(`central-hub-${stamp()}.json`, await snapshot(), 'application/json'));
$('#bk-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const question = store.cloud
      ? `Upload the ${data.meta?.projects?.length || 0} project(s) in this backup to the shared database? Projects with the same id and the shared prices are replaced for everyone.`
      : `Replace everything in this browser with the backup from ${data.exportedAt || 'an unknown date'}?`;
    if (!confirm(question)) return;
    status('Importing…');
    await store.importAll(data);
    status('Backup imported.');
  } catch (err) {
    status(err.message);
  }
});
$('#bk-reset').addEventListener('click', () => {
  if (confirm('Delete all projects in this browser and reload the demo data?')) { store.reset(); status('Demo data reloaded.'); }
});
/** Put one of the Apps Script files on the clipboard, so nobody has to find and open the file. */
async function copyScript(file) {
  const res = await fetch(`apps-script/${file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('The script file could not be read.');
  await navigator.clipboard.writeText(await res.text());
}
$('#bk-copy').addEventListener('click', async () => {
  try {
    await copyScript('Code.gs');
    status('Script copied. In Apps Script, select all the old code, paste, save, then Deploy > Manage deployments > pencil > New version.');
  } catch (err) {
    status(`Not copied: ${err.message}`);
  }
});
/** The web app link, the secret and the reply address are kept the moment they change: pressing another button first is not needed. */
const keepDriveFields = () => {
  driveConfig.set({ endpoint: $('#bk-endpoint').value.trim(), token: $('#bk-token').value, replyTo: $('#bk-reply').value.trim().toLowerCase() });
  status('Saved in this browser.');
};
for (const id of ['#bk-endpoint', '#bk-token', '#bk-reply']) $(id).addEventListener('change', keepDriveFields);
$('#bk-drive').addEventListener('click', async () => {
  keepDriveFields();
  status('Saving…');
  try {
    const out = await saveToDrive(`central-hub-${stamp()}.json`, await snapshot());
    status(`Saved to Drive as ${out.name}.`);
  } catch (err) {
    status(`Not saved: ${err.message}`);
  }
});

// ---- boot ----

const AUTO_PULL_MS = 60_000;
// With the Daily report page open, the open project is checked again this long after the last answer
// came back. The Field Report script needs a second or more to answer, so this is as close to
// "at once" as it gets without flooding it.
const FAST_PULL_MS = 5000;
let checkSoon = () => {};   // set once the app has started

let started = false;
function start() {
  if (!started) {
    started = true;
    // New field reports are fetched once a minute while the tab is in view.
    root.addEventListener('input', () => { typing = true; });
    const check = () => { if (!document.hidden && ctx) reports.autoPull(); };
    setInterval(check, AUTO_PULL_MS);
    setTimeout(check, 3000);
    // coming back to the tab or the window checks straight away instead of waiting out the minute
    document.addEventListener('visibilitychange', check);
    addEventListener('focus', check);
    checkSoon = () => setTimeout(check, 1500);
    // the division lock: the first Admin's Central Hub gives the old records their division, once they have all arrived
    setTimeout(async () => { if (store.cloud && store.isPrimary && store.isAdmin && !store.readOnly && !store.loading) { try { await store.stampDivisions(); } catch { /* tried again next time */ } } }, 30_000);
    // 0.18.0: day rates move off the team records (which Site reads) into crewRates, once, by the first Admin
    setTimeout(async () => { if (store.isPrimary && store.isAdmin && !store.readOnly && !store.loading) { try { await store.movePay(); } catch { /* tried again next start */ } } }, 35_000);
    // the weekly full copy: checked a minute after start, then every 6 hours
    setTimeout(weeklyBackup, 60_000);
    setInterval(weeklyBackup, 6 * 3600_000);
    const quick = async () => {
      if (!document.hidden && ctx && route() === 'reports') { try { await reports.autoPull(true); } catch { /* shown by the next full check */ } }
      setTimeout(quick, FAST_PULL_MS);
    };
    setTimeout(quick, FAST_PULL_MS);
    store.subscribe(() => refresh());
    addEventListener('storage', e => { if (e.key === 'sf:company' || e.key === 'sf:booking') store.reloadCompany(); });
    store.onError(toast);
    addEventListener('hashchange', () => refresh());

    // connection and unsent changes, shown only when there is something to say
    const net = $('#net');
    const showNet = () => {
      const off = navigator.onLine === false, n = store.pending;
      net.hidden = !store.cloud || (!off && !n);
      net.className = `chip net${off ? ' off' : ''}`;
      net.textContent = off ? (n ? `Offline · ${n} change${n === 1 ? '' : 's'} waiting` : 'Offline: changes will be sent later') : `Sending ${n} change${n === 1 ? '' : 's'}…`;
    };
    store.onNet(showNet);
    addEventListener('online', showNet);
    addEventListener('offline', showNet);
    showNet();

    // after something is deleted or cleared: a floating Undo that stays until used, dismissed or replaced
    const bar = $('#undo');
    let job = null, barTimer;
    const hideUndo = () => { bar.hidden = true; job = null; clearTimeout(barTimer); };
    const doUndo = () => { if (!job) return; const j = job; hideUndo(); j.undo(); toast('Restored.'); };
    store.onUndoable(next => {
      job = next;
      $('#undo-text').textContent = next.label;
      bar.hidden = false;
      clearTimeout(barTimer);
      barTimer = setTimeout(hideUndo, UNDO_MS);
    });
    $('#undo-btn').addEventListener('click', doUndo);
    $('#undo-x').addEventListener('click', hideUndo);
    addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && job && !e.target.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); doUndo(); }
    });
  }
  render();
}

/** The sign-in screen. `state` is 'signin', 'waiting', 'refused', 'sent', or a plain message. */
let gateNote = '';   // a line under the sign-in form, for example why an activation link was not accepted
function gate(state, user, canLeave = false) {
  const el = $('#gate');
  el.hidden = state === null;
  if (state === null) return;
  $('#gate-msg').textContent = state === 'signin' ? 'Sign in to continue.'
    : state === 'waiting' ? `${user.email} is waiting for the Admin's approval. Your request has been sent. You can come in as soon as the Admin approves it.`
    : state === 'locked' ? `${user.email} is already signed in on another device (${describeSession(store.lockedBy)}). Only one device can be signed in at a time. Sign out there, or ask the Admin to reset your session, then click Check again. If that device is lost or broken, only the Admin can free it.`
    : state === 'unassigned' ? `${user.email} has access, but the Admin has not assigned a division yet (Installation or Trading). Nobody comes in before that. Ask the Admin to choose one under Settings, People and access, then click Check again.`
    : state === 'refused' ? `${user.email} has not been given access yet. Ask the Admin to add this address under Settings, People and access.`
    : state === 'sent' ? "An activation email has been successfully sent. Check your spam folder if you don't get it within 3 minutes."
    : state;
  $('#gate-note').textContent = state === 'signin' ? gateNote
    : state === 'sent' ? 'The link is valid for 5 minutes and must be opened in this same browser.' : '';
  const stuck = state === 'waiting' || state === 'refused' || state === 'locked' || state === 'unassigned';
  $('#gate-signin').hidden = state !== 'signin';
  $('#gate-link').hidden = state !== 'signin';
  $('#gate-stay-row').hidden = state !== 'signin';
  // someone signed in who cannot get further must still be able to switch account
  $('#gate-signout').hidden = !stuck && !canLeave;
  $('#gate-again').hidden = !stuck && state !== 'sent';
  $('#gate-again').textContent = state === 'sent' ? 'Back to sign-in' : 'Check again';
  $('#gate-again').dataset.do = state === 'sent' ? 'back' : 'reload';
}

const stayChecked = () => $('#gate-stay').checked;

async function startCloud() {
  gate('Connecting…');
  let api;
  try {
    const { connectCloud } = await import('./core/cloud.js');
    api = await connectCloud(firebaseConfig);
    // 1C: Field Report requests go through the server, which holds the key and checks who asks
    const { fieldServer } = await import('./sync/fieldreport.js');
    fieldServer.call = body => api.call('fieldAction', { body });
  } catch (err) {
    console.warn(err);
    gate('Could not reach the server. Check the internet connection and reload.');
    return;
  }
  let signedIn = false;
  $('#gate-signin').addEventListener('click', () => api.signIn(stayChecked()).catch(err => gate(`Sign-in did not complete (${err.code || err.message}). Try again.`)));
  $('#gate-signout').addEventListener('click', () => store.signOut());
  // another device took this person's session, or the Admin reset it: sign out here and say why
  store.onSessionEnded(reason => {
    gateNote = reason === 'reset' ? 'The Admin ended your session. Sign in again.' : 'You were signed out because this account was signed in on another device.';
    api.signOut();
  });
  $('#gate-again').addEventListener('click', e => { if (e.target.dataset.do === 'back') { gateNote = ''; gate('signin'); } else location.reload(); });
  $('#gate-link').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#gate-email').value.trim();
    if (!email) return;
    gate('Sending the activation email…');
    try {
      await api.sendLink(email, stayChecked());
      gate('sent');
    } catch (err) {
      console.warn(err);
      gateNote = /operation-not-allowed/.test(err.code || '')
        ? 'Activation links are not switched on yet. Until the Admin switches them on, use Sign in with Google.'
        : `The activation email could not be sent (${err.code || err.message}).`;
      gate('signin');
    }
  });

  // the page may have been opened from an activation link
  let linked = null;
  try { linked = await api.finishLink(); } catch (err) { console.warn(err); linked = 'failed'; }
  gateNote = linked === 'expired' ? 'That activation link is more than 5 minutes old. Ask for a new one.'
    : linked === 'other' ? 'Open the activation link in the same browser you asked for it from, or ask for a new one.'
    : linked === 'failed' ? 'That activation link did not work. It may have been used already. Ask for a new one.'
    : '';
  if (gateNote && !signedIn) gate('signin');

  api.onUser(async user => {
    signedIn = !!user;
    if (!user) { gate('signin'); return; }
    gate('Loading…');
    // the database only accepts addresses whose owner has been confirmed; an activation link confirms one
    if (!user.email || !user.verified) {
      gate(`${user.email || 'This account'} is signed in, but the address has not been confirmed yet. Click "Use a different account", then type the address under "or" and use the activation link sent to it.`, null, true);
      return;
    }
    try {
      let allowed;
      try {
        allowed = await store.connect(api, user);
      } catch (err) {
        // refused on the very first read: renew the sign-in token and try once more
        if (!/permission/i.test(`${err.code} ${err.message}`)) throw err;
        await api.refresh();
        allowed = await store.connect(api, user);
      }
      if (allowed === 'locked') { gate('locked', user); return; }
      if (allowed === 'unassigned') { gate('unassigned', user); return; }
      if (!allowed) {
        // nobody comes in without the Admin's yes: the address is put in front of the Admin
        let asked = true;
        try { await store.requestAccess(); } catch (err) { console.warn(err); asked = false; }
        gate(asked ? 'waiting' : 'refused', user);
        return;
      }
    } catch (err) {
      console.warn(err);
      gate(/permission/i.test(`${err.code} ${err.message}`)
        ? `The database refused ${user.email} (signed in with ${user.via || 'an unknown method'}) while reading ${err.step || 'the data'}. Send this line to whoever set up Central Hub. If the access rules were changed today, publish them again and reload.`
        : 'Could not load the data. Check the internet connection and reload.', null, true);
      return;
    }
    gate(null);
    start();
    if (!flushWired) {
      flushWired = true;
      // faults kept on this device go to the Admin whenever it is online and signed in
      const sendFaults = () => diagnostics.flush(api, user.email);
      sendFaults();
      addEventListener('online', sendFaults);
      setInterval(sendFaults, 5 * 60 * 1000);
    }
  });
}
let flushWired = false;

// Lets the app open with no signal: the files last seen are kept (see sw.js).
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => diagnostics.record(err, 'service worker')));

// "?local" keeps everything in this browser, with demo data and no sign-in: useful for trying things out.
if (firebaseConfig && !new URLSearchParams(location.search).has('local')) {
  startCloud();
} else {
  store.init();
  start();
}
