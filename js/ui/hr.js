// HR: employees. The Admin's alone: the records hold personal data, so nobody
// else loads them and the database refuses them.
//
// Laid out the way HR systems usually are: a wall of employee cards to find
// someone, and a form per employee with a header (photo, name, job) and tabs
// for work details, private details, the agreement and pay, and their papers.

import { PAY_OPTIONS } from '../engine/currencies.js';
import { store } from '../core/store.js';
import { AGREEMENT_TYPES, PAY_PERIODS, DOCUMENT_KINDS, RATING_FILTERS, agreementLabel, hrSummary, filterStaff, ratingOf } from '../engine/hr.js';
import { uid, money, fmtFull } from '../core/util.js';
import { ratingsOf, rankLabel, scaleLabel, averages, LEVELS, levelOf } from '../engine/evaluation.js';
import { assign, unassign, assignmentOf, activeProjects, accountOf, memberId, fromTeam as fromTeamPlan, unlinked, duplicates } from '../engine/people.js';
import { DIVISIONS, divisionsOf } from '../core/nav.js';
import { pictureFor, sizeNote, tell, PHOTO, PASSPORT } from '../core/image.js';
import { passportBlock, toggleZoom, resetZoom } from './docimage.js';
import { divOf, stamp, TRADING, INSTALLATION } from '../core/division.js';
import { scanInto, scanButton } from './ocr.js';
import { TITLES, GROUPS, titleOf, titlePatch, mayJoin, mayTake } from '../engine/titles.js';
import { positionGroups, departmentChoices, nationalityChoices, normDepartment } from '../engine/positions.js';
import { chooseOptions, chooseGroups, groupOptions, chosenValue } from './choose.js';
import { ownerFromStaff } from '../engine/owners.js';
import { paperHtml } from '../sync/mail.js';
import { docHead, docSec, footText } from './print.js';
import { companyCode } from '../engine/docref.js';
import { openMail, emailIn } from './maildialog.js';
import { html, options, field, chip } from './dom.js';
import { personSummary, methodLabel } from '../engine/crewpay.js';

let selected = null;
let tab = 'work';       // work | private | pay | papers
const filt = { search: '', position: '', department: '', rating: '', status: 'active', project: '' };   // the employee list's filters ('' = any)
let notice = '';

const TABS = [['work', 'Work information'], ['private', 'Private information'], ['pay', 'Agreement and pay'], ['papers', 'Papers'], ['projects', 'Projects'], ['crewpay', 'Payments'], ['access', 'Sign-in access'], ['history', 'Work history and ratings']];
let mode = 'form';      // form | sheet (the profile sheet that is printed or emailed)
// What goes on the profile sheet. Pay, private address and phone, ID number, emergency contact, bank and notes never do.
const SHEET_OPTIONS = [
  ['photo', 'Photo'], ['contact', 'Work phone and email'], ['nationality', 'Nationality'], ['passport', 'Passport number and expiry'], ['passportImage', 'Passport image'],
  ['certificate', 'Highest certificate'], ['papers', 'Other papers (kind and expiry only)'], ['history', 'Work history'], ['rating', 'Rating summary'],
];
const sheetOpts = Object.fromEntries(SHEET_OPTIONS.map(([k]) => [k, true]));
sheetOpts.passportImage = false;   // a picture of the passport goes on the sheet only when asked for
const stars = n => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));
const score = n => (n == null ? '—' : n.toFixed(1))
const GENDERS = [['', 'Not stated'], ['male', 'Male'], ['female', 'Female']];
const MARITAL = [['', 'Not stated'], ['single', 'Single'], ['married', 'Married'], ['widowed', 'Widowed'], ['divorced', 'Divorced']];
const TONES = ['#17788a', '#b47d14', '#0a3440', '#8a4b17', '#3c6e47', '#6a4c93'];

/** Select a person from outside this screen (search, quick links). */
export const focusOn = (id, onTab = 'work') => { selected = id; tab = onTab; mode = 'form'; };

const find = company => company.staff.find(p => p.id === selected);
const isLink = v => /^https?:\/\//i.test(v || '');
/** Opens the person's file in Drive: the folder link kept on their record, else a Drive search for their name. */
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const tone = id => TONES[[...String(id)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TONES.length];
const avatar = (p, cls = '') => (p.photo
  ? html`<img class="avatar ${cls}" src="${p.photo}" alt="">`
  : html`<span class="avatar ${cls}" style="background:${tone(p.id)}">${initials(p.name)}</span>`);

export function render(c) {
  const { company, global } = c;
  const cur = global.fx.base;
  const sum = hrSummary(company.staff, global.fx, c.today, cur);
  const row = sum.rows.find(r => r.p.id === selected);
  return row ? (mode === 'sheet' ? profileSheet(row, c) : form(row, c)) : wall(sum, c, cur);
}

// ---- the wall of employee cards ----

function wall(sum, c, cur) {
  const projectName = id => store.projects.find(p => p.id === id)?.name || '';
  const staff = c.company.staff, evals = c.company.evaluations;
  const used = key => [...new Set(staff.map(p => (key === 'department' ? normDepartment(p[key]) : p[key])).filter(Boolean))].sort();
  const pass = new Set(filterStaff(staff, filt, evals));
  const shown = sum.rows.filter(({ p }) => pass.has(p));
  const sel = (f, label, list) => html`<select data-chg="filt" data-f="${f}" data-fk="hr-f-${f}" aria-label="${label}">${options(list, filt[f])}</select>`;
  const kpi = (label, value, sub, cls = '') => html`
    <div class="kpi"><span class="kpi-label">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${sub}</span></div>`;

  return html`
    <section class="kpis">
      ${kpi('Employees', sum.active, 'Currently working')}
      ${kpi('Monthly pay', money(sum.payroll, cur), 'Daily and hourly pay counted as 26 days a month')}
      ${kpi('Needs attention', sum.alerts, sum.urgent ? `${sum.urgent} already run out` : 'Papers and agreements running out', sum.urgent ? 'bad' : '')}
    </section>

    ${directoryNotes(c)}
    <div class="toolbar">
      <button class="btn primary" data-act="add">New employee</button>
      <input class="search" type="search" data-chg="filt" data-f="search" data-fk="hr-search" value="${filt.search}" placeholder="Search name, job, department, phone" aria-label="Search employees">
      <span class="grow"></span>
      <span class="muted">${notice || `${shown.length} shown`}</span>
    </div>
    <div class="toolbar wrap">
      ${sel('position', 'Job position', [['', 'Every job position'], ...used('title').map(x => [x, x])])}
      ${sel('department', 'Department', [['', 'Every department'], ...used('department').map(x => [x, x])])}
      ${sel('rating', 'Rating', RATING_FILTERS)}
      ${sel('status', 'Status', [['active', 'Working'], ['left', 'Left'], ['all', 'Working and left']])}
      ${sel('project', 'Project', [['', 'Every project'], ...store.projects.map(x => [x.id, x.name])])}
    </div>

    <section class="emp-wall">
      ${shown.length ? shown.map(({ p, alerts }) => html`<div class="emp-item">
        <button type="button" class="emp-card ${p.status === 'left' ? 'left' : ''}" data-act="select" data-id="${p.id}">
          ${avatar(p)}
          <span class="emp-text">
            <b>${p.name || 'New employee'}</b>
            <span>${p.title || 'No job position'}</span>
            <span class="muted">${[normDepartment(p.department), projectName(p.projectId)].filter(Boolean).join(' · ') || 'Head office'}</span>
            ${(r => (r == null ? html`<span class="muted emp-stars">Not rated yet</span>` : html`<span class="emp-stars" title="${scaleLabel(r)}">${stars(r)} ${score(r)}</span>`))(ratingOf(p, evals))}
            ${p.email ? html`<span class="muted">${p.email}</span>` : ''}
            ${p.phone ? html`<span class="muted">${p.phone}</span>` : ''}
            <span class="emp-tags">${p.status === 'left' ? chip('Left') : ''}${alerts.length ? chip(alerts.length === 1 ? alerts[0].text : `${alerts.length} things need attention`, alerts.some(a => a.sev === 'high') ? 'high' : 'warn') : ''}</span>
          </span>
        </button></div>`)
      : html`<p class="empty">${c.company.staff.length ? 'Nobody matches.' : 'No employees yet. Add the first one with "New employee".'}</p>`}
    </section>
    <p class="muted">Only you, the Admin, can open this page. Office and Site users cannot, and the database does not send them these records.</p>`;
}

/** Everything written about this person across projects, for the Admin: summary, then each evaluation and feedback note. */
function ratingBlock(p, c) {
  const r = ratingsOf(c.company.evaluations, p);
  if (!r.evals.length && !r.notes.length) return html`<p class="muted">No evaluation or feedback written about ${p.name || 'this person'} yet. They are matched by work or private email, or by exact name.</p>`;
  const rows = [
    ...r.evals.map(e => ({ when: e.date, kind: `Evaluation, ${e.projectName || ''}`, by: e, value: score(averages(e.scores).overall), text: e.comment })),
    ...r.notes.map(n => ({ when: n.at.slice(0, 10), kind: n.category, by: n, value: stars(n.stars), text: n.notes })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  return html`
    <p><b>${score(r.overall)}</b> overall from ${r.evals.length} evaluation${r.evals.length === 1 ? '' : 's'} <span class="muted">${r.overall != null ? scaleLabel(r.overall) : ''}</span>
      ${r.stars != null ? html` · feedback ${stars(r.stars)} from ${r.notes.length} note${r.notes.length === 1 ? '' : 's'}` : ''}</p>
    <table class="table compact">
      <thead><tr><th>Date</th><th>What</th><th>Score</th><th>Written by</th><th>Notes</th></tr></thead>
      <tbody>${rows.map(x => html`<tr><td class="nowrap">${fmtFull(x.when)}</td><td>${x.kind}</td><td class="nowrap">${x.value}</td>
        <td>${x.by.byName || x.by.by}<span class="muted note">${rankLabel(x.by.byRank)}</span></td><td>${x.text || ''}</td></tr>`)}</tbody>
    </table>`;
}

/** One page about a person for a client: the details the Admin ticks, to print or to email as a PDF. */
function profileSheet({ p }, c) {
  const o = sheetOpts;
  const r = ratingsOf(c.company.evaluations, p);
  const passport = (p.documents || []).find(d => d.kind === 'Passport');
  const passNo = passport?.number || p.passportNumber || '';
  const project = store.projects.find(x => x.id === p.projectId)?.name || '';
  const other = (p.documents || []).filter(d => d !== passport && d.kind);
  const history = [...(p.history || [])].sort((a, b) => (b.from || '').localeCompare(a.from || ''));
  const fact = (k, v) => (v ? html`<dt>${k}</dt><dd>${v}</dd>` : '');
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="sheetBack">← ${p.name || 'Employee'}</button>
      <span class="muted">${notice}</span>
      <span class="grow"></span>
      <button class="btn" data-act="emailSheet">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="printSheet">Print</button>
    </div>
    <section class="card no-print">
      <h3>What goes on the sheet</h3>
      <div class="week">${SHEET_OPTIONS.map(([k, label]) => html`<label class="check"><input type="checkbox" data-chg="sheetOpt" data-k="${k}" ${o[k] ? 'checked' : ''}> ${label}</label>`)}</div>
      <p class="muted">Pay, private address and phone, ID number, emergency contact, bank account and notes are never on the sheet. ${o.rating ? 'The rating summary shares what the evaluators wrote with the client: untick it if that is not what you want. ' : ''}${o.passport ? 'The passport number is personal data: include it only when the client needs it.' : ''}</p>
    </section>
    <section class="card sheet"><div class="paper dsr doc-paper profile-paper" data-foot="${footText(c, 'Crew profile', `${companyCode(c.global.company)}-CV-${(p.id || '').slice(-6).toUpperCase()}`, { project: false })}">
      ${docHead(c, { title: 'Crew profile', sub: p.name || '', ref: `${companyCode(c.global.company)}-CV-${(p.id || '').slice(-6).toUpperCase()}`, facts: [['Position', p.title || ''], ['Department', p.department || ''], ['Prepared', fmtFull(c.today)]] })}
      <table class="profile-top"><tr>
        ${o.photo && p.photo ? html`<td style="width:150px;border:0"><img src="${p.photo}" alt="" style="width:130px;height:130px"></td>` : ''}
        <td style="border:0"><h2 style="text-transform:none;font-size:20px">${p.name || ''}</h2>
          <p><b>${p.title || ''}</b>${p.department ? html` · ${p.department}` : ''}</p>
          <dl class="facts">
            ${fact('With the company since', p.started && fmtFull(p.started))}
            ${fact('Works on', project)}
            ${fact('Work location', p.location)}
            ${o.contact ? html`${fact('Work mobile', p.phone)}${fact('Work email', p.email)}` : ''}
            ${o.nationality ? fact('Nationality', p.nationality) : ''}
            ${o.passport ? html`${fact('Passport No.', passNo)}${fact('Passport expires', passport?.expiry && fmtFull(passport.expiry))}` : ''}
            ${o.certificate ? fact('Highest certificate', p.certificate) : ''}
          </dl></td></tr></table>
      ${o.passportImage && p.passportImage ? docSec('', 'Passport', html`<img src="${p.passportImage}" alt="" style="max-width:100%;max-height:430px">`) : ''}
      ${o.papers && other.length ? docSec('', 'Papers', html`<table class="dsr-t"><thead><tr><th>Paper</th><th>Valid until</th></tr></thead>
        <tbody>${other.map(d => html`<tr><td>${d.kind}</td><td>${d.expiry ? fmtFull(d.expiry) : ''}</td></tr>`)}</tbody></table>`) : ''}
      ${o.history && history.length ? docSec('', 'Projects worked on', html`<table class="dsr-t">
        <thead><tr><th>Project</th><th>Role</th><th>From</th><th>To</th></tr></thead>
        <tbody>${history.map(h => html`<tr><td>${h.project}${h.note ? html`<br><span class="muted">${h.note}</span>` : ''}</td><td>${h.role || ''}</td><td class="nowrap">${h.from ? fmtFull(h.from) : ''}</td><td class="nowrap">${h.to ? fmtFull(h.to) : 'Present'}</td></tr>`)}</tbody></table>`) : ''}
      ${o.rating ? docSec('', 'Performance rating', html`${r.evals.length || r.notes.length ? html`
        <p><b>${score(r.overall)} of 5</b> ${r.overall != null ? html`<span class="muted">(${scaleLabel(r.overall)}, average of ${r.evals.length} evaluation${r.evals.length === 1 ? '' : 's'})</span>` : ''}
          ${r.stars != null ? html`<br>Feedback on the day: ${stars(r.stars)} <span class="muted">from ${r.notes.length} note${r.notes.length === 1 ? '' : 's'}</span>` : ''}</p>
        ${r.latest ? html`<table><thead><tr><th>Latest evaluation</th><th class="r">Score</th></tr></thead>
          <tbody>${r.latest.pillars.map(x => html`<tr><td>${x.name}</td><td class="r">${score(x.value)}</td></tr>`)}</tbody></table>` : ''}`
        : html`<p class="muted">No evaluation recorded yet.</p>`}`) : ''}
      <p class="muted p-notes">Prepared by ${c.global.company?.name || 'Amistad Prefab'} on ${fmtFull(c.today)}.</p>
    </div></section>`;
}

/** A person's sign-in email and the projects it is linked to follow their assignments. */
export function relink(person, projectId, on) {
  const mail = accountOf(person);
  const u = mail && store.users.find(x => x.email === mail);
  if (!u) return;
  const now = (u.projects || []).filter(id => id !== projectId);
  if (on) now.push(projectId);
  store.setUser(mail, { projects: now });
}

/** Above the wall: people on the open project's team who are not in the directory yet, and people entered twice. */
function directoryNotes(c) {
  const loose = unlinked(c.ws.team).filter(m => String(m.name || '').trim());
  const twice = duplicates(c.company.staff);
  return html`
    ${loose.length ? html`<div class="field-note"><span><b>${loose.length} ${loose.length === 1 ? 'person' : 'people'} on ${c.project.name}'s team ${loose.length === 1 ? 'is' : 'are'} not in the directory yet.</b>
      Enter a person once, here, and the team, sign-in access and evaluations all use the same record.</span>
      <button class="btn small primary" data-act="fromTeam">Add them to the directory</button></div>` : ''}
    ${twice.length ? html`<div class="field-note"><span><b>Possibly entered twice:</b> ${twice.map(g => `${g.people.map(x => x.name).join(' and ')} (${g.why})`).join('; ')}.</span></div>` : ''}`;
}

/** The job positions to choose from for the open project: titles, its trades, what the staff already hold. */

/** The Projects tab of a person: where they work, in what role, at what day rate. */
function projectsPane(p, c) {
  if (divOf(p) === TRADING) return html`<p class="muted">People of the Trading division are not put on projects. To put ${p.name || 'this person'} on a project, move them to Installation under Work information, Division.</p>`;
  const mine = p.assignments || [];
  const free = store.projects.filter(x => !mine.some(a => a.projectId === x.id));
  const named = id => store.projects.find(x => x.id === id);
  return html`
    <p class="muted">Putting a person on a project adds them to its team, and links their email to it when they have sign-in access. The role and the day rate are set here, once.</p>
    ${mine.length ? html`<table class="table compact">
      <thead><tr><th>Project</th><th>Role on the project</th><th class="r">Day rate</th><th>On site</th><th></th></tr></thead>
      <tbody>${mine.map(a => html`<tr>
        <td>${named(a.projectId)?.name || 'A project that was removed'}</td>
        <td><select data-chg="assign" data-pid="${a.projectId}" data-f="role" data-what="role" data-fk="as-r-${a.projectId}" aria-label="Role on the project">${chooseGroups(positionGroups(a.role), a.role || '', p.title ? `Same as job: ${p.title}` : 'Role…')}</select></td>
        <td class="r nowrap"><input class="price" type="number" min="0" step="any" data-chg="assign" data-pid="${a.projectId}" data-f="dayRate" data-fk="as-d-${a.projectId}" value="${a.dayRate || ''}" aria-label="Day rate"> <span class="muted">${named(a.projectId)?.currency || ''}</span></td>
        <td><input type="checkbox" data-chg="assign" data-pid="${a.projectId}" data-f="active" ${a.active === false ? '' : 'checked'} aria-label="On site"></td>
        <td class="r"><button class="btn ghost small" data-act="unassign" data-pid="${a.projectId}">Take off</button></td></tr>`)}</tbody>
    </table>` : html`<p class="muted">Not on any project yet.</p>`}
    ${free.length ? html`<form data-form="assign" class="entry">
      <select name="projectId" aria-label="Project">${options(free.map(x => [x.id, x.name]), null)}</select>
      <select name="role" aria-label="Role on the project"><option value="">${p.title ? `Role: same as job (${p.title})` : 'Role on the project…'}</option>${groupOptions(positionGroups(), null)}</select>
      <input name="dayRate" type="number" min="0" step="any" class="amount" placeholder="Day rate" aria-label="Day rate">
      <button class="btn">Put on the project</button></form>` : ''}`;
}

/** The Sign-in access tab of a person: the email they sign in with, and what they may open. */
function accessPane(p) {
  const mail = accountOf(p);
  const u = store.cloud && mail ? store.users.find(x => x.email === mail) : null;
  const projects = store.projects.filter(x => (u?.projects || []).includes(x.id));
  return html`
    <label>Signs in with (the Google account email)
      <input type="email" data-chg="set" data-f="accountEmail" data-fk="hr-acct" value="${p.accountEmail || ''}" placeholder="name@gmail.com"></label>
    ${!store.cloud ? html`<p class="muted">Access is given in the signed-in version of Central Hub. Enter the email here now and it is ready.</p>`
      : !mail ? html`<p class="muted">Enter the email this person signs in with, to give them access.</p>`
      : u ? html`
        <h3>Access</h3>
        <div class="grid2">
          <label>Level <select data-chg="accessRole">${options([['site', 'Site'], ['office', 'Office']], u.role)}</select></label>
        </div>
        <label>Title <select data-chg="accessTitle">
          <option value="" ${titleOf(u) ? '' : 'selected'}>Choose a title…</option>${GROUPS.map(g => html`<optgroup label="${g}">${options(TITLES.filter(t => t[2] === g).map(([k, label]) => [k, label]), titleOf(u) || null)}</optgroup>`)}</select></label>
        <label>Department <select data-chg="accessDivision">${divisionsOf(u).length ? '' : html`<option value="">Not assigned: cannot sign in</option>`}${options(DIVISIONS, divisionsOf(u)[0] || null)}</select></label>
        <p class="muted">${projects.length ? `Linked to: ${projects.map(x => x.name).join(', ')}.` : 'Not linked to a project yet: put the person on one under Projects.'} The pages an Office person may open are ticked under Settings, People and access.</p>
        <div class="actions left"><button class="btn danger small" data-act="removeAccess">Remove access</button></div>`
      : html`
        <p class="muted">${mail} cannot sign in yet.</p>
        <form data-form="giveAccess" class="entry">
          <select name="role" aria-label="Level">${options([['site', 'Site: only their projects'], ['office', 'Office']], 'site')}</select>
          <button class="btn primary">Give access</button></form>
        <p class="muted">They are linked to the projects they are on (${activeProjects(p).length}). Ranks and divisions are set after.</p>`}`;
}

// ---- one employee ----

function form({ p, alerts, monthly }, c) {
  const a = p.agreement || {};
  const base = c.global.fx.base;
  const currencies = PAY_OPTIONS;   // v0.25.0: each person is paid in USD or ETB
  const others = c.company.staff.filter(x => x.id !== p.id && x.status !== 'left').map(x => [x.id, x.title ? `${x.name}, ${x.title}` : x.name]);
  const text = (label, f, fk, type = 'text', extra = '') => html`<label>${label} <input type="${type}" data-chg="set" data-f="${f}" data-fk="${fk}" value="${p[f] ?? ''}" ${extra}></label>`;
  const agree = (label, f, fk, type = 'text', extra = '') => html`<label>${label} <input type="${type}" data-chg="agreement" data-f="${f}" data-fk="${fk}" value="${a[f] ?? ''}" ${extra}></label>`;
  const pick = (label, f, fk, list) => html`<label>${label} <select data-chg="set" data-f="${f}" data-fk="${fk}">${options(list, p[f] || '')}</select></label>`;

  const panes = {
    crewpay: crewPayPane(p, c),
    work: html`
      <div class="grid2">
        ${text('Work mobile', 'phone', 'hr-phone')}
        ${text('Work email', 'email', 'hr-email')}
        <label>Department <select data-chg="pick" data-f="department" data-what="department" data-fk="hr-dept-f">${chooseOptions(departmentChoices({ staff: c.company.staff, current: p.department }), normDepartment(p.department))}</select></label>
        <label>Job position <select data-chg="pick" data-f="title" data-what="job position" data-fk="hr-title">${chooseGroups(positionGroups(p.title), p.title)}</select></label>
        <label>Evaluation tier <select data-chg="set" data-f="level" data-fk="hr-level" title="Decides who evaluates this person: the tier above">${options(LEVELS, levelOf(p))}</select></label>
        <label>Manager <select data-chg="set" data-f="managerId" data-fk="hr-manager"><option value="">None</option>${options(others, p.managerId || null)}</select></label>
        <label>Division <select data-chg="division" data-fk="hr-division">${options([[INSTALLATION, 'Installation'], [TRADING, 'Trading']], divOf(p))}</select></label>
        ${divOf(p) === TRADING ? '' : html`<label>Works on <select data-chg="set" data-f="projectId" data-fk="hr-project">
          <option value="">Head office, no project</option>${options(store.projects.map(x => [x.id, x.name]), p.projectId || null)}</select></label>`}
        ${text('Work location', 'location', 'hr-loc', 'text', html`placeholder="e.g. Modjo site, Addis office"`)}
        ${text('Personnel file folder in Drive', 'folder', 'hr-folder', 'text', html`placeholder="Paste the Google Drive link of the person's folder"`)}
        <label>Started on <input type="date" data-chg="set" data-f="started" data-fk="hr-start" value="${p.started || ''}"></label>
        ${p.status === 'left' ? html`<label>Left on <input type="date" data-chg="set" data-f="leftOn" data-fk="hr-left" value="${p.leftOn || ''}"></label>` : ''}
      </div>
      <label>Notes <textarea data-chg="set" data-f="notes" data-fk="hr-notes" rows="3">${p.notes || ''}</textarea></label>`,

    private: html`
      <h3>Private contact</h3>
      <div class="grid2">
        ${text('Private address', 'privateAddress', 'hr-paddr')}
        ${text('Private phone', 'privatePhone', 'hr-pphone')}
        ${text('Private email', 'privateEmail', 'hr-pemail')}
      </div>
      <h3>Citizenship</h3>
      <div class="grid2">
        <label>Nationality <select data-chg="pick" data-f="nationality" data-what="nationality" data-fk="hr-nat">${chooseOptions(nationalityChoices({ used: c.company.staff.map(x => x.nationality), current: p.nationality }), p.nationality)}</select></label>
        ${text('Identification No.', 'idNumber', 'hr-idno')}
        ${text('Passport No.', 'passportNumber', 'hr-pass')}
        ${pick('Gender', 'gender', 'hr-gender', GENDERS)}
        <label>Date of birth <input type="date" data-chg="set" data-f="birthday" data-fk="hr-birth" value="${p.birthday || ''}"></label>
        ${text('Place of birth', 'birthPlace', 'hr-bplace')}
        ${pick('Marital status', 'marital', 'hr-marital', MARITAL)}
      </div>
      ${passportBlock(p.passportImage, p.name)}
      <h3>Emergency</h3>
      <div class="grid2">
        ${text('Contact name', 'emergency', 'hr-emg')}
        ${text('Contact phone', 'emergencyPhone', 'hr-emgp')}
      </div>
      <h3>Education and bank</h3>
      <div class="grid2">
        ${text('Highest certificate', 'certificate', 'hr-cert', 'text', html`placeholder="e.g. BSc Civil Engineering"`)}
        ${text('Bank account', 'bank', 'hr-bank', 'text', html`placeholder="Bank and account number, for salary"`)}
      </div>`,

    pay: html`
      <div class="grid2">
        <label>Agreement type <select data-chg="agreement" data-f="type" data-fk="ag-type"><option value="">None recorded</option>${options(AGREEMENT_TYPES, a.type || null)}</select></label>
        ${agree('Signed on', 'signedOn', 'ag-signed', 'date')}
        ${agree('Starts', 'start', 'ag-start', 'date')}
        ${agree('Ends (leave empty if open-ended)', 'end', 'ag-end', 'date')}
        ${agree('Probation ends', 'probationEnd', 'ag-prob', 'date')}
        ${agree('Notice period, days', 'noticeDays', 'ag-notice', 'number', html`min="0"`)}
        ${agree('Pay', 'pay', 'ag-pay', 'number', html`min="0" step="any"`)}
        <label>Paid <select data-chg="agreement" data-f="payPer" data-fk="ag-per">${options(PAY_PERIODS, a.payPer || 'month')}</select></label>
        <label>Currency <select data-chg="agreement" data-f="currency" data-fk="ag-cur">${options(currencies, a.currency || base)}</select></label>
      </div>
      ${a.pay ? html`<p class="muted">About ${money(monthly, base)} a month.</p>` : ''}
      <label>Link to the signed agreement <input data-chg="agreement" data-f="link" data-fk="ag-link" value="${a.link || ''}" placeholder="Paste the Google Drive link of the signed file"></label>
      ${isLink(a.link) ? html`<a href="${a.link}" target="_blank" rel="noopener">Open the signed agreement</a>` : ''}
      <label>Main terms <textarea data-chg="agreement" data-f="terms" data-fk="ag-terms" rows="3" placeholder="Duties, working hours, leave, allowances, anything agreed beyond the standard">${a.terms || ''}</textarea></label>`,

    projects: projectsPane(p, c),
    access: accessPane(p),

    history: html`
      <h3>Projects worked on</h3>
      ${p.history?.length ? html`<table class="table compact">
        <thead><tr><th>Project</th><th>Role</th><th>From</th><th>To</th><th>Note</th><th></th></tr></thead>
        <tbody>${p.history.map(h => html`<tr>
          <td><input data-chg="hist" data-id="${h.id}" data-f="project" data-fk="hh-p-${h.id}" value="${h.project || ''}" aria-label="Project"></td>
          <td><input data-chg="hist" data-id="${h.id}" data-f="role" data-fk="hh-r-${h.id}" value="${h.role || ''}" aria-label="Role"></td>
          <td><input type="date" data-chg="hist" data-id="${h.id}" data-f="from" data-fk="hh-f-${h.id}" value="${h.from || ''}" aria-label="From"></td>
          <td><input type="date" data-chg="hist" data-id="${h.id}" data-f="to" data-fk="hh-t-${h.id}" value="${h.to || ''}" aria-label="To"></td>
          <td><input data-chg="hist" data-id="${h.id}" data-f="note" data-fk="hh-n-${h.id}" value="${h.note || ''}" aria-label="Note"></td>
          <td class="r"><button class="btn ghost small" data-act="dropHist" data-id="${h.id}">Remove</button></td></tr>`)}</tbody>
      </table>` : html`<p class="muted">Add each project this person worked on, with the role and dates. It goes on the profile sheet.</p>`}
      <form data-form="hist" class="entry">
        <input name="project" placeholder="Project" required aria-label="Project" class="wide">
        <input name="role" placeholder="Role" aria-label="Role" class="wide">
        <input type="date" name="from" aria-label="From" title="From">
        <input type="date" name="to" aria-label="To" title="To (empty if still there)">
        <input name="note" placeholder="Note" aria-label="Note" class="wide">
        <button class="btn">Add</button>
      </form>
      <h3>Ratings</h3>
      ${ratingBlock(p, c)}`,

    papers: html`
      ${p.documents?.length ? html`<table class="table compact">
        <thead><tr><th>Paper</th><th>Number</th><th>Runs out</th><th>Link</th><th></th></tr></thead>
        <tbody>${p.documents.map(d => html`
          <tr>
            <td>${d.kind}</td>
            <td><input data-chg="doc" data-id="${d.id}" data-f="number" data-fk="dc-n-${d.id}" value="${d.number || ''}" aria-label="Number"></td>
            <td><input type="date" data-chg="doc" data-id="${d.id}" data-f="expiry" data-fk="dc-e-${d.id}" value="${d.expiry || ''}" aria-label="Runs out"></td>
            <td class="doc-link"><input data-chg="doc" data-id="${d.id}" data-f="link" data-fk="dc-l-${d.id}" value="${d.link || ''}" placeholder="Paste a Drive link" aria-label="Link">${isLink(d.link) ? html`<a href="${d.link}" target="_blank" rel="noopener">Open</a>` : ''}</td>
            <td class="r"><button class="btn ghost small" data-act="dropDoc" data-id="${d.id}">Remove</button></td>
          </tr>`)}</tbody>
      </table>` : html`<p class="muted">Add passports, visas, work permits and certificates with the date they run out. You are warned 60 days before.</p>`}
      <form data-form="doc" class="entry">
        <select name="kind" aria-label="Kind of paper">${options(DOCUMENT_KINDS.map(k => [k, k]), 'Passport')}</select>
        <input name="number" placeholder="Number" aria-label="Number" class="wide">
        <input type="date" name="expiry" aria-label="Runs out" title="Date it runs out">
        <button class="btn">Add paper</button>
        <span class="muted">or</span> ${scanButton('paperScan')}
      </form>`,
  };

  return html`
    <div class="toolbar">
      <button class="btn ghost" data-act="back">← Employees</button>
      <span class="muted">${p.name || 'New employee'}</span>
      <span class="grow"></span>
      <button class="btn" data-act="sheet" title="A printable page about this person, with the details you choose, to print or email to a client">Profile sheet</button>
      <button class="btn" data-act="toggleLeft">${p.status === 'left' ? 'Mark as working again' : 'Mark as left'}</button>
      <button class="btn danger" data-act="remove">Delete</button>
    </div>

    <section class="card emp-form">
      <header class="emp-head">
        <div class="emp-photo">
          ${avatar(p, 'xxl')}
          <div class="emp-photo-btns">
            <label class="btn small">${p.photo ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" data-chg="photo" hidden></label>
            ${p.photo ? html`<button class="btn ghost small" data-act="dropPhoto">Remove</button>` : ''}
          </div>
        </div>
        <div class="emp-id">
          <input class="emp-name" data-chg="set" data-f="name" data-fk="hr-name" value="${p.name || ''}" placeholder="Employee's name" aria-label="Full name">
          <select class="emp-job" data-chg="pick" data-f="title" data-what="job position" data-fk="hr-title-h" aria-label="Job position">${chooseGroups(positionGroups(p.title), p.title, 'Job position…')}</select>
          <label class="emp-line"><span>Email</span><input type="email" data-chg="set" data-f="email" data-fk="hr-email-h" value="${p.email || ''}" placeholder="Work email" aria-label="Work email"></label>
          <label class="emp-line"><span>Phone</span><input type="tel" data-chg="set" data-f="phone" data-fk="hr-phone-h" value="${p.phone || ''}" placeholder="Work phone" aria-label="Work phone"></label>
          <span class="emp-tags">${p.status === 'left' ? chip('Left') : chip('Working', 'ok')} ${chip(agreementLabel(a.type), a.type ? 'info' : 'warn')}
            ${p.started ? html`<span class="muted">With the company since ${fmtFull(p.started)}</span>` : ''}</span>
        </div>
      </header>
      ${alerts.length ? html`<ul class="plain emp-alerts">${alerts.map(x => html`<li>${chip(x.sev === 'high' ? 'Urgent' : 'Soon', x.sev)} ${x.text}</li>`)}</ul>` : ''}

      <div class="emp-tabs" role="tablist">${TABS.map(([k, label]) => html`
        <button type="button" role="tab" class="tab ${tab === k ? 'on' : ''}" data-act="tab" data-t="${k}" aria-selected="${tab === k ? 'true' : 'false'}">${label}${k === 'papers' && p.documents?.length ? html` <span class="muted">${p.documents.length}</span>` : ''}</button>`)}</div>
      <div class="form emp-pane">${panes[tab]}</div>
    </section>`;
}

/** The Payments tab of an HR record: what the person earned, was paid and is owed on the open project. */
function crewPayPane(p, c) {
  const pay = personSummary(c.ws, memberId(p));
  const cur = c.project.currency;
  return html`<p class="muted">On <b>${c.project.name}</b>; choose another project with the project chooser to see its figures. Earned counts the approved pay periods under Finance, Payments.</p>
    <div class="grid2"><p>Earned <b>${money(pay.earned, cur, 2)}</b></p><p>Paid <b>${money(pay.paid, cur, 2)}</b></p><p>Still owed <b class="${pay.owed > 0.004 ? 'bad' : 'ok'}">${money(pay.owed, cur, 2)}</b></p></div>
    ${pay.payments.length ? html`<table class="table compact"><thead><tr><th>Date</th><th>For the period from</th><th class="r">Amount</th><th>How</th><th>Reference</th></tr></thead>
      <tbody>${pay.payments.map(x => html`<tr><td class="nowrap">${fmtFull(x.date)}</td><td class="nowrap">${fmtFull(x.periodFrom)}</td><td class="r nowrap">${money(x.amount, x.currency, 2)}</td><td>${methodLabel(x.method)}</td><td>${x.ref || ''}</td></tr>`)}</tbody></table>`
      : html`<p class="muted">No payment recorded on this project.</p>`}`;
}

export const actions = {
  select(el) { selected = el.dataset.id; tab = 'work'; notice = ''; mode = 'form'; resetZoom(); },
  back() { selected = null; mode = 'form'; resetZoom(); },
  zoomPassport() { toggleZoom(); },
  dropPassportImage() { store.updateCompany(co => { const p = find(co); if (p) p.passportImage = ''; }); },
  sheet() { mode = 'sheet'; },
  /** Bring the open project's team into the directory: matched by name or email, otherwise new people, all linked. */
  fromTeam(el, c) {
    let out = { created: [], updated: [], linked: 0 };
    store.update(ws => { out = fromTeamPlan(ws, c.company.staff, c.project.id, () => uid('st')); });
    store.updateCompany(co => {
      for (const person of out.created) co.staff.push(person);
      for (const u of out.updated) { const i = co.staff.findIndex(x => x.id === u.id); if (i >= 0) co.staff[i] = u; }
    });
    notice = `${out.linked} team member${out.linked === 1 ? '' : 's'} linked to the directory, ${out.created.length} of them new.`;
  },
  /** Take a person off a project: they drop out of its team lists, and their email is unlinked from it. */
  unassign(el, c) {
    const p = find(c.company);
    const pid = el.dataset.pid;
    if (!p) return;
    store.updateCompany(co => { const x = find(co); x.assignments = (x.assignments || []).map(a => (a.projectId === pid ? { ...a, active: false } : a)); });
    store.updateOther(pid, ws => unassign(ws, p));
    relink(p, pid, false);
  },
  /** Give the signed-in person access, linked to the projects they are on. */
  removeAccess(el, c) {
    const p = find(c.company);
    if (p && confirm(`Remove ${p.name}'s access? They can no longer sign in.`)) store.removeUser(accountOf(p));
  },
  sheetBack() { mode = 'form'; },
  printSheet() { print(); },
  dropHist(el) { store.updateCompany(co => { const p = find(co); if (p) p.history = (p.history || []).filter(h => h.id !== el.dataset.id); }); },
  emailSheet(el, c) {
    const p = find(c.company);
    if (!p) return;
    const name = `Crew profile, ${p.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: emailIn(c.project.client?.contact),
      subject: `${name} (${c.global.company?.name || 'Amistad Prefab'})`,
      message: `Dear ${c.project.client?.name || 'Sir or Madam'},\n\nPlease find attached the profile of ${p.name}${p.title ? `, ${p.title}` : ''}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
  tab(el) { tab = el.dataset.t; },
  add(el, c) {
    const p = { id: uid('st'), name: '', title: '', department: filt.department || '', projectId: '', status: 'active', started: c.today, agreement: {}, documents: [], notes: '', level: 'crew', accountEmail: '', assignments: [], ...stamp() };
    store.updateCompany(co => co.staff.push(p));
    selected = p.id;
    tab = 'work';
  },
  toggleLeft(el, c) {
    store.updateCompany(co => {
      const p = find(co);
      if (!p) return;
      if (p.status === 'left') { p.status = 'active'; p.leftOn = ''; } else { p.status = 'left'; p.leftOn = c.today; }
    });
  },
  remove(el, c) {
    const p = find(c.company);
    if (!p || !confirm(`Delete ${p.name || 'this employee'} and their agreement and papers? To keep the record of someone who has left, use "Mark as left" instead.`)) return;
    store.updateCompany(co => { co.staff = co.staff.filter(x => x.id !== p.id); });
    selected = null;
  },
  dropDoc(el) { store.updateCompany(co => { const p = find(co); p.documents = p.documents.filter(d => d.id !== el.dataset.id); }); },
  dropPhoto() { store.updateCompany(co => { const p = find(co); if (p) p.photo = ''; }); },
};

export const changes = {
  /** Change the role, day rate or presence of a person on one project, here, once: the project's team follows. */
  assign(el, c) {
    const p = find(c.company);
    const pid = el.dataset.pid, f = el.dataset.f;
    if (!p) return;
    const value = f === 'active' ? el.checked : f === 'dayRate' ? Math.max(0, field(el)) : f === 'role' ? chosenValue(el, 'role') : el.value.trim();
    if (value === null) { store.notify(); return; }
    let next;
    store.updateCompany(co => {
      const x = find(co);
      x.assignments = (x.assignments || []).map(a => (a.projectId === pid ? (next = { ...a, [f]: value }) : a));
    });
    if (next) store.updateOther(pid, ws => assign(ws, p, next));
    if (f === 'active') relink(p, pid, value);
  },
  accessRole(el, c) { const p = find(c.company); if (p) store.setUser(accountOf(p), { role: el.value }); },
  accessTitle(el, c) {
    const p = find(c.company);
    if (!p) return;
    const u = store.users.find(x => x.email === accountOf(p));
    const may = el.value ? mayTake(u, el.value, store.projects.map(x => x.id)) : { ok: true };
    if (!may.ok) { tell(`✗ ${may.reason}`); store.notify(); return; }
    store.setUser(accountOf(p), titlePatch(el.value));
  },
  accessDivision(el, c) { const p = find(c.company); if (p) store.setUser(accountOf(p), { divisions: [el.value] }); },
  accessTick(el, c) {
    const p = find(c.company);
    const u = p && store.users.find(x => x.email === accountOf(p));
    if (!u) return;
    const key = el.dataset.k;   // ranks or divisions
    const now = (u[key] || []).filter(x => x !== el.dataset.p);
    if (el.checked) now.push(el.dataset.p);
    const order = (key === 'ranks' ? TITLES : DIVISIONS).map(([k]) => k);
    store.setUser(u.email, { [key]: order.filter(k => now.includes(k)) });
  },
  sheetOpt(el) { sheetOpts[el.dataset.k] = el.checked; },
  hist(el) { const f = el.dataset.f; store.updateCompany(co => { const h = (find(co)?.history || []).find(x => x.id === el.dataset.id); if (h) h[f] = el.value.trim(); }); },
  filt(el) { filt[el.dataset.f] = el.value; },
  set(el) {
    const f = el.dataset.f;
    const value = el.value.trim();
    store.updateCompany(co => { const p = find(co); if (p) p[f] = value; });
  },
  /** A position or department chosen from a list (or typed once through Other...). */
  pick(el) {
    const value = chosenValue(el, el.dataset.what || 'value');
    if (value === null) { store.notify(); return; }
    const f = el.dataset.f;
    store.updateCompany(co => { const p = find(co); if (p) p[f] = value; });
  },
  /** Move a person to the other division: they leave this list and appear in the other one. */
  division(el) {
    const to = el.value === TRADING ? TRADING : INSTALLATION;
    const p = find(store.company);
    if (!p || divOf(p) === to) return;
    const jobs = (p.assignments || []).filter(a => a.active !== false);
    if (to === TRADING && jobs.length && !confirm(`${p.name || 'This person'} is on ${jobs.length} project${jobs.length === 1 ? '' : 's'}. Moving to Trading takes them off those teams. Continue?`)) { store.notify(); return; }
    store.updateCompany(co => {
      const x = find(co);
      if (!x) return;
      if (to === TRADING) { x.division = TRADING; x.projectId = ''; x.assignments = (x.assignments || []).map(a => ({ ...a, active: false })); } else delete x.division;
    });
    if (to === TRADING) for (const a of jobs) { store.updateOther(a.projectId, ws => unassign(ws, p)); relink(p, a.projectId, false); }
    notice = `${p.name || 'The person'} moved to ${to === TRADING ? 'Trading' : 'Installation'}. Find them under Crew in that division.`;
    selected = null;
  },
  agreement(el) {
    const f = el.dataset.f;
    const value = el.type === 'number' ? Math.max(0, field(el)) : el.value.trim();
    store.updateCompany(co => { const p = find(co); if (p) p.agreement = { ...p.agreement, [f]: value }; });
  },
  doc(el) {
    store.updateCompany(co => { const d = find(co)?.documents.find(x => x.id === el.dataset.id); if (d) d[el.dataset.f] = el.value.trim(); });
  },
  /** A photo or scan of the passport page, made smaller to fit (about 300 KB) before it is kept. */
  async passportImage(el) {
    const file = el.files[0];
    const id = selected;
    el.value = '';
    if (!file) return;
    try {
      const r = await pictureFor(file, PASSPORT, 'photo');
      store.updateCompany(co => { const p = co.staff.find(x => x.id === id); if (p) p.passportImage = r.dataUrl; });
      tell(sizeNote('Passport image', r) || 'Passport image added.');
    } catch (err) { tell(err.message); return; }
    await scanInto(file, co => co.staff.find(x => x.id === id), { birthday: true, kindHint: 'Passport' });
  },
  /** A picture of any paper: its kind, number and expiry are read and added to Papers, and the identity fields are filled when empty. */
  async paperScan(el) {
    const file = el.files[0];
    const id = selected;
    el.value = '';
    if (file) await scanInto(file, co => co.staff.find(x => x.id === id), { birthday: true });
  },
  /** Any picture is accepted: it is scaled down and compressed to fit (about 150 KB) before it is kept. */
  async photo(el) {
    const file = el.files[0];
    const id = selected;
    el.value = '';
    if (!file) return;
    try {
      const r = await pictureFor(file, PHOTO, 'photo');
      store.updateCompany(co => { const p = co.staff.find(x => x.id === id); if (p) p.photo = r.dataUrl; });
      tell(sizeNote('Photo', r) || 'Photo added.');
    } catch (err) { tell(err.message); }
  },
};

export const submits = {
  /** Put the person on a project: their place on its team is made, and their email is linked to it. */
  assign(fd, c) {
    const p = find(c.company);
    const pid = fd.get('projectId');
    if (!p || !pid) return false;
    const account = store.users.find(x => x.email === accountOf(p));
    const may = account ? mayJoin(account, pid, store.projects.map(x => x.id)) : { ok: true };
    if (!may.ok) { notice = may.reason; return false; }
    const a = { projectId: pid, role: String(fd.get('role') || '').trim(), dayRate: Math.max(0, +fd.get('dayRate') || 0), active: true };
    store.updateCompany(co => { const x = find(co); x.assignments = [...(x.assignments || []).filter(y => y.projectId !== pid), a]; });
    store.updateOther(pid, ws => assign(ws, p, a));
    relink(p, pid, true);
    const mail = accountOf(p);
    notice = `${p.name} is on ${store.projects.find(x => x.id === pid)?.name || 'the project'}.${mail && store.users.some(x => x.email === mail) ? '' : ' To let them sign in and see it, give them access under Sign-in access.'}`;
  },
  /** Give access to the email this person signs in with. */
  giveAccess(fd, c) {
    const p = find(c.company);
    const mail = p && accountOf(p);
    if (!mail) return false;
    if (mail === (store.user?.email || '').toLowerCase()) { notice = 'That is your own account, the Admin.'; return false; }
    store.setUser(mail, { role: fd.get('role') === 'office' ? 'office' : 'site', name: p.name, title: p.title || '', projects: activeProjects(p), ranks: [], divisions: [divOf(p)] });
    notice = `${p.name} can now sign in with ${mail}.`;
  },
  hist(fd, c) {
    if (!find(c.company)) return false;
    store.updateCompany(co => { const p = find(co); p.history = [...(p.history || []), { id: uid('hh'), project: fd.get('project').trim(), role: fd.get('role').trim(), from: fd.get('from') || '', to: fd.get('to') || '', note: fd.get('note').trim() }]; });
  },
  doc(fd, c) {
    if (!find(c.company)) return false;
    store.updateCompany(co => find(co).documents.push({ id: uid('dc'), kind: fd.get('kind'), number: fd.get('number').trim(), expiry: fd.get('expiry') || '', link: '' }));
  },
};
