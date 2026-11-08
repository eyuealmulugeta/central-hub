// v0.23.0: Field Report users (Settings, Field Report and import). Everyone who may sign in to Field Report, with the
// name and position they typed in the app, confirmed here: once confirmed they go on every report and the person can no
// longer change them. Also the projects they report on, their status (Active, Suspended, Blocked) and new sign-ins
// waiting for the Admin. The data lives in the Field Report script (ACCESS, DEV:), not in the database: script 7.30.0.

import { store } from '../core/store.js';
import { fieldReady, fieldUsers, fieldUserDo } from '../sync/fieldreport.js';
import { positionGroups } from '../engine/positions.js';
import { groupOptions } from './choose.js';
import { tell } from '../core/image.js';
import { html, options, chip } from './dom.js';
import { approveCrew, wageDiffers } from '../engine/sitecrew.js';
import { uid } from '../core/util.js';
import { compareReports, clean } from '../engine/compare.js';
import { personByEmail, addedStamp, addedName } from '../engine/manpower.js';
import { fromTeam, assign } from '../engine/people.js';
import { importPlan, applyImport, frRoleOf, codeMaps, NEEDS_PROJECT, FR_ROLE_WORD } from '../engine/onesource.js';   // v1.11.0

export const ROLE_WORDS = [['engineer', 'Site engineer'], ['coordinator', 'Project engineer'], ['admin', 'Admin'], ['exec', 'GM'], ['technician', 'Technician (shares work photos)']];   // technician: v1.8.0
const ST_WORDS = { active: ['Active', 'ok'], suspended: ['Suspended', 'warn'], blocked: ['Blocked', 'high'] };
// v1.11.0 (owner): no Remove here: access is taken away in the Manpower Directory (status Left, or the sign-in email cleared)
const ACTIONS = [['', 'No change'], ['approve', 'Approve new device'], ['deny', 'Deny new device'], ['activate', 'Activate'], ['suspend', 'Suspend'], ['block', 'Block']];
const ONE_PER_PROJECT = ['engineer', 'coordinator', 'technician'];   // these need projects; admin and exec see every project

let feed = null;        // { people, catalog, devices, inbox, at }
let busy = false;
let said = null;        // { ok, text }
let edits = {};         // email -> { full, pos, role, projects, act } changed on screen, not saved yet
let openAccess = '';    // the email whose project list is unfolded
let crewEdits = {};     // v0.37.0: id -> { name, trade } corrected here before approving
let crewEditing = '';   // the waiting person whose name and trade are open

const say = (ok, text) => { said = { ok, text }; tell(`${ok ? '✓' : '✗'} ${text}`); store.notify(); };

/** Sample people for the demo only (no Field Report connection there): nothing is sent anywhere. */
const demoFeed = () => ({
  people: [
    { email: 'abebe@example.com', id: 'ABEBE', role: 'engineer', projects: ['MJO'], st: 'active', full: '', pos: '', uName: 'abebe k', uPos: 'site eng', ok: false },
    { email: 'sara@example.com', id: 'SARA', role: 'coordinator', projects: ['MJO', 'MOS'], st: 'active', full: 'Sara Tesfaye', pos: 'Project Engineer', uName: 'Sara T', uPos: 'Project Engineer', ok: true, okBy: 'Demo Admin', okAt: '2026-10-20T08:00:00Z' },
    { email: 'dawit@example.com', id: 'DAWIT', role: 'engineer', projects: ['BAG'], st: 'blocked', full: '', pos: '', uName: 'Dawit', uPos: 'Foreman', ok: false },
  ],
  catalog: [{ code: 'MJO', label: 'Modjo (demo)', status: 'active' }, { code: 'MOS', label: 'Moshav (demo)', status: 'active' }, { code: 'BAG', label: 'Bagira (demo)', status: 'active' }],
  devices: [
    { email: 'abebe@example.com', dev: 'demo0001aaaa', st: 'wait', name: 'abebe k', role: 'engineer', first: '2026-10-26T06:05:00Z', ua: 'Android 13; SM-A145F · Chrome', ip: '196.188.34.10', loc: 'Modjo, Oromia, Ethiopia' },
    { email: 'sara@example.com', dev: 'demo0002bbbb', st: 'ok', name: 'Sara T', role: 'coordinator', first: '2026-10-19T07:00:00Z', ua: 'Android 14 · Chrome', ip: '196.188.1.2', loc: 'Addis Ababa, Ethiopia', by: 'Demo Admin', at: '2026-10-19T07:10:00Z' },
  ],
  signups: [
    { email: 'meron@example.com', name: 'Meron Alemu', phone: '+251 911 000 111', at: '2026-10-30T07:40:00Z', ip: '196.188.50.7', loc: 'Adama, Oromia, Ethiopia', ua: 'Android 14 · Chrome', st: 'wait' },
    { email: 'hana@example.com', name: 'Hana G', phone: '', at: '2026-10-30T09:12:00Z', ip: '', loc: '', st: 'wait' },
    { email: 'yonas@example.com', name: 'Yonas B', phone: '', at: '2026-10-28T15:10:00Z', ip: '', loc: '', st: 'rejected', by: 'Demo Admin', decidedAt: '2026-10-28T16:00:00Z', mailed: '2026-10-28T16:00:00Z' },
  ],
  crewReqs: [
    { proj: 'MJO', id: 'cr1', name: 'Girma Tadesse', trade: 'Mason', wage: 450, tradeWage: 450, by: 'Abebe K', at: '2026-10-31T06:40:00Z' },
    { proj: 'MJO', id: 'cr2', name: 'Lemlem Hailu', trade: 'Mason', wage: 520, tradeWage: 450, by: 'Abebe K', at: '2026-10-31T06:41:00Z' },
  ],
  inbox: [
    { t: '2026-10-26T06:05:30Z', h: 'New device waiting · abebe k', m: 'abebe@example.com\nIP 196.188.34.10 · Modjo, Oromia, Ethiopia (approximate)', f: 'Field Report' },
    { t: '2026-10-25T17:02:00Z', h: 'MISSING REPORT · Moshav (demo)', m: 'No report or no-work notice today.', f: 'Field Report' },
  ],
});
export const isDemo = () => !store.cloud && !fieldReady();

/** The feed, asked again when older than a minute (or when asked). */
export async function load(force) {
  if (busy || (!force && feed && Date.now() - feed.at < 60e3)) return;
  if (isDemo()) { if (!feed) feed = { ...demoFeed(), at: Date.now() }; store.notify(); return; }
  busy = true; store.notify();
  try { feed = { ...(await fieldUsers()), at: Date.now() }; said = null; }
  catch (err) { said = { ok: false, text: err.message }; }
  busy = false; store.notify();
  await takeApproved();
}
/** v0.29.0: crew a Project engineer approved on the phone, with their wages: added to the team without a second approval. */
async function takeApproved() {
  if (!store.isAdmin || store.readOnly) return;
  const ok = (feed?.crewReqs || []).filter(r => r.ok && projectOf(r.proj));
  const by = new Map();
  for (const r of ok) by.set(r.proj, [...(by.get(r.proj) || []), r]);
  for (const [code, list] of by) await crewDecide(code, true, list, true);
}
export const current = () => feed;

/* v1.12.1 (owner, 8 Nov, R3): approvals sync by themselves. A Field Report change (crew sent or approved on a phone,
   a report sent or answered) leaves fieldPing/<project>; the Admin's Central Hub reloads the Field Report list at once,
   so crew approved on a phone joins the team within seconds. Sign-up requests and new phones (kept by the script)
   are asked again every 2 minutes while Central Hub is open. */
const ISO_T = /^\d{4}-\d{2}-\d{2}T/;
export const newestPing = docs => (docs || []).flatMap(d => Object.values(d || {}).filter(v => typeof v === 'string' && ISO_T.test(v))).sort().pop() || '';
let pingSeen = null, pingT = 0;
store.onFieldPing?.(docs => {
  const last = newestPing(docs);
  if (pingSeen === null) { pingSeen = last; return; }   // the first read is how things are now
  if (!last || last <= pingSeen) return;
  pingSeen = last;
  clearTimeout(pingT);
  pingT = setTimeout(() => { if (store.isAdmin && fieldReady()) load(true); }, 2500);
});
if (typeof document !== 'undefined') setInterval(() => { if (store.isAdmin && fieldReady() && !document.hidden) load(); }, 120e3);   // in the browser only
export const isBusy = () => busy;
export const waiting = () => (feed?.devices || []).filter(d => d.st === 'wait');

/** One change, in the demo applied to the sample data. */
async function apply(action, body) {
  if (isDemo()) {
    const p = feed.people.find(x => x.email === body.email);
    if (action === 'userSet' && p) Object.assign(p, body.full != null ? { full: body.full } : {}, body.pos != null ? { pos: body.pos } : {}, body.ok ? { ok: true, okBy: 'Demo Admin', okAt: new Date().toISOString() } : {}, body.st ? { st: body.st } : {});
    if (action === 'accessSet' && p) Object.assign(p, { role: body.role, projects: body.projects });
    if (action === 'accessRemove') feed.people = feed.people.filter(x => x.email !== body.email);
    if (action === 'devDecide') Object.assign(feed.devices.find(d => d.dev === body.device) || {}, { st: body.decision === 'approve' ? 'ok' : 'deny', by: 'Demo Admin', at: new Date().toISOString() });
    if (action === 'signupDecide') Object.assign(feed.signups.find(r => r.email === body.email) || {}, { st: body.decision === 'approve' ? 'approved' : 'rejected', by: 'Demo Admin', decidedAt: new Date().toISOString(), mailed: '' });
    if (action === 'crewDecide') feed.crewReqs = (feed.crewReqs || []).filter(r => !(r.proj === body.proj && body.ids.includes(r.id)));
    return { mailed: false, demo: true };
  }
  const out = await fieldUserDo(action, body);
  if (out.signups) feed = { ...feed, signups: out.signups };
  if (out.people) feed = { ...feed, people: out.people, catalog: out.catalog || feed.catalog };
  if (out.devices) feed = { ...feed, devices: out.devices };
  if (out.crewReqs) feed = { ...feed, crewReqs: out.crewReqs };
  return out;
}

/** v0.26.0 (script 7.35.0): the people who asked to use Field Report, waiting for the Admin. */
export const signupsWaiting = () => (feed?.signups || []).filter(r => r.st === 'wait');
const SU_WORDS = { approved: ['Approved', 'ok'], rejected: ['Rejected', 'high'] };
function signupRow(r, catalog) {
  return html`<li class="fu-dev su-row" data-e="${r.email}">
    <div><b>${r.name || 'No name given'}</b> <span class="muted">${r.email}</span>${r.phone ? html` <span class="muted">· ${r.phone}</span>` : ''}
      <span class="muted note">${place(r)} · asked ${when(r.at)}${r.ua ? ` · ${r.ua}` : ''}</span></div>
    <div class="entry">
      <select data-su="person" aria-label="The person in the Manpower Directory for ${r.email}">${options([['', 'Person in the Manpower Directory…'], ...suPeople(r).map(p => [p.id, `${p.name}${p.title ? ` · ${p.title}` : ''}`])], suGuess(r))}</select>
      <button class="btn small primary" type="button" data-act="fuSignup" data-e="${r.email}" data-v="approve" ${busy ? 'disabled' : ''}>Approve</button>
      <button class="btn small ghost" type="button" data-act="fuSignup" data-e="${r.email}" data-v="reject" ${busy ? 'disabled' : ''}>Reject</button>
    </div></li>`;
}
// v1.11.0: the Directory people a sign-up may be (no sign-in email yet, or this one), the same name first
const suPeople = r => (store.company?.staff || []).filter(p => p.status !== 'left' && (!p.accountEmail || String(p.accountEmail).toLowerCase() === r.email)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
const suGuess = r => { const n = String(r.name || '').trim().toLowerCase(); return (suPeople(r).find(p => String(p.accountEmail || '').toLowerCase() === r.email || (n && String(p.name || '').trim().toLowerCase() === n)) || {}).id || ''; };
/** v1.11.0: the Field Report access a Directory person gets: { role, projects (codes) }. */
export function accessFromDirectory(p) {
  const { toCode } = codeMaps(store.projects);
  return { role: frRoleOf(p.title), projects: [...new Set((p.assignments || []).filter(a => a.active !== false).map(a => toCode.get(a.projectId)).filter(Boolean))].sort() };
}
function signupsCard(catalog) {
  const all = feed?.signups || [], wait = all.filter(r => r.st === 'wait'), done = all.filter(r => r.st !== 'wait').slice(0, 8);
  if (!all.length) return '';
  return html`<h4>Sign-up requests ${wait.length ? html`<span class="chip high">${wait.length} waiting</span>` : ''}</h4>
    <p class="muted small">People who signed in to Field Report with a Google account that has no access yet. Choose who they are in the Manpower Directory: Approve sets this email as their sign-in, and their position and projects there give the role and projects. Someone not in the Directory is added there first (Manpower, Employee data). Either way they get an email with the result.</p>
    ${wait.length ? html`<ul class="list fu-devs">${wait.map(r => signupRow(r, catalog))}</ul>
      ${wait.length > 1 ? html`<div class="actions left"><button class="btn small ghost" type="button" data-act="fuRejectAll" ${busy ? 'disabled' : ''}>Reject all ${wait.length}</button></div>` : ''}` : html`<p class="muted">No request is waiting.</p>`}
    ${done.length ? html`<details><summary class="muted">Decided (${done.length})</summary><ul class="plain">${done.map(r => html`<li>${chip(...SU_WORDS[r.st])} ${r.name || r.email} <span class="muted">${r.email} · ${r.by || ''} ${when(r.decidedAt)}${r.mailed ? ' · emailed' : ' · not emailed'}</span></li>`)}</ul></details>` : ''}`;
}

/** v0.28.0 (script 7.37.0): the crew list the site sent, per project, for the Admin to approve as that project's crew. */
// v0.50.2: crew already approved on a phone (Field Report crewOk, `ok`) is added by Central Hub without asking again
export const crewWaiting = () => (feed?.crewReqs || []).filter(r => !r.ok);
/** Approved on a phone but not on the team yet: added when the Admin's Central Hub reads the list (or no project has the code). */
export const crewApproved = () => (feed?.crewReqs || []).filter(r => r.ok);
const projectOf = code => store.projects.find(p => !p.binned && String(p.fieldCode || '').toUpperCase() === code) || (isDemo() ? store.project : null);
/** v0.50.2: crew approved on a phone: no second approval; said here while it is being added, or why it cannot be. */
function stuckNote(list) {
  const lost = list.filter(r => !projectOf(r.proj));
  return html`<p class="muted small">${list.length - lost.length ? `${list.length - lost.length} approved on the phone (${list.filter(r => projectOf(r.proj)).map(r => r.name).join(', ')}): being added to the crew, no second approval. ` : ''}${lost.length ? html`<b>${lost.map(r => r.name).join(', ')}</b> approved on the phone for ${[...new Set(lost.map(r => r.proj))].join(', ')}, but no project in Central Hub has that Field Report code.` : ''}</p>`;
}
function crewCard() {
  const all = crewWaiting(), done = crewApproved();
  if (!all.length) return done.length ? stuckNote(done) : '';
  const by = new Map();
  for (const r of all) by.set(r.proj, [...(by.get(r.proj) || []), r]);
  return html`${done.length ? stuckNote(done) : ""}<h4>Crew from the site <span class="chip high">${all.length} waiting</span></h4>
    <p class="muted small">Names, trades and daily wages the site sent from Field Report. Approve puts the person on the crew of that project only, with the daily wage. A wage that is not the trade's daily wage is kept but flagged "Wage to review" on Payments until you clear it.</p>
    ${[...by].map(([code, list]) => { const pj = projectOf(code); return html`<h5>${code} · ${pj ? pj.name : 'no project in Central Hub has this Field Report code'}</h5>
      <ul class="list fu-devs">${list.map(r0 => { const r = { ...r0, ...(crewEdits[r0.id] || {}) }; return html`<li class="fu-dev"><div>${crewEditing === r.id ? html`<input value="${r.name}" data-chg="fuCrewEdit" data-id="${r.id}" data-f="name" aria-label="Name"> <input value="${r.trade || ''}" data-chg="fuCrewEdit" data-id="${r.id}" data-f="trade" aria-label="Trade" placeholder="Trade">` : html`<b>${r.name}</b>`} <span class="muted">${crewEditing === r.id ? '' : r.trade || 'No trade'} · ${r.wage || r.tradeWage || 0} a day</span>${r.at ? html` <span class="muted">· sent${r.by ? ` by ${r.by}` : ''} ${new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}${crewEdits[r.id] ? html` ${chip('Corrected here', 'info')}` : ''}
        ${wageDiffers(r) ? chip(`Not the trade wage (${r.tradeWage})`, 'warn') : ''}${elsewhere(r, pj)} <span class="muted note">sent by ${r.by || 'the site'} · ${when(r.at)}</span></div>
        <div class="entry"><button class="btn small primary" type="button" data-act="fuCrew" data-p="${code}" data-id="${r.id}" data-v="approve" ${busy || !pj ? 'disabled' : ''}>Approve</button>
          <button class="btn small ghost" type="button" data-act="fuCrewOpen" data-id="${r.id}">${crewEditing === r.id ? 'Done' : 'Edit'}</button>
          <button class="btn small ghost" type="button" data-act="fuCrew" data-p="${code}" data-id="${r.id}" data-v="reject" ${busy ? 'disabled' : ''}>Reject</button></div></li>`; })}</ul>
      ${list.length > 1 && pj ? html`<div class="actions left"><button class="btn small" type="button" data-act="fuCrew" data-p="${code}" data-v="approve" ${busy ? 'disabled' : ''}>Approve all ${list.length}</button></div>` : ''}`; })}`;
}
/** v0.78.0: a name already on another project in the Manpower Directory: approving puts them on this one too. */
function elsewhere(r, pj) {
  if (!pj) return '';
  const n = String(r.name || '').trim().toLowerCase(), p = (store.company?.staff || []).find(x => String(x.name || '').trim().toLowerCase() === n);
  const on = p ? (p.assignments || []).filter(a => a.active !== false && a.projectId !== pj.id).map(a => store.projects.find(x => x.id === a.projectId)?.name).filter(Boolean) : [];
  return on.length ? html` ${chip(`On ${on.join(', ')} in the Manpower Directory: approving adds ${pj.name}`, 'warn')}` : '';
}
async function crewDecide(code, yes, list, quiet = false) {
  if (!list.length || busy) return;
  list = list.map(r => ({ ...r, ...(crewEdits[r.id] || {}) }));   // v0.37.0: the name and trade as corrected here
  const pj = projectOf(code), who = list.length === 1 ? list[0].name : `${list.length} people`;
  if (yes && !pj) return say(false, `No project in Central Hub has the Field Report code ${code}.`);
  if (!yes && !confirm(`Reject ${who} for ${code}? They are not added to the crew.`)) return;
  busy = true; store.notify();
  try {
    let ws = null;
    let into = null;
    let made = [];
    if (yes) ws = await store.updateOther(pj.id, w => { made = approveCrew(w, list, () => uid('m'), new Date().toISOString()); into = fromTeam(w, store.company?.staff || [], pj.id, () => uid('st')); });
    // v0.78.0: a person of the directory switched back on here is put on this project there too, so both agree
    const linked = made.filter(m => m.personId);
    if (linked.length) store.updateCompany(co => { for (const m of linked) { const x = co.staff.find(y => y.id === m.personId); if (!x) continue; const a = (x.assignments || []).find(y => y.projectId === pj.id); if (a) a.active = true; else x.assignments = [...(x.assignments || []), { projectId: pj.id, role: m.role || x.title || '', dayRate: 0, active: true }]; } });
    // v0.46.0: approved crew is in the Manpower Directory too: linked to the person of the same name, else new
    if (into && (into.created.length || into.updated.length)) store.updateCompany(co => {
      // v0.78.0 (owner): who sent it and who approved it, by name
      const by = addedStamp(`${addedName(list[0].byName || list[0].by, store.company?.staff, store.users) || 'Site'} (Field Report), approved by ${store.signature?.split(',')[0] || store.profile?.name || addedName(store.user?.email || '', store.company?.staff, store.users)}`, new Date().toISOString().slice(0, 10));
      for (const p of into.created) co.staff.push({ ...p, ...by });
      for (const u of into.updated) { const i = co.staff.findIndex(x => x.id === u.id); if (i >= 0) co.staff[i] = u; }
    });
    await apply('crewDecide', { proj: code, ids: list.map(r => r.id) });
    const sent = yes && ws ? await (await import('./reports.js')).sendListsFor(pj, ws) : false;   // loaded here: reports.js needs this file first   // v0.32.1: they join the Office attendance list on the phone
    say(true, yes ? `${who} added to the crew of ${pj.name}${quiet ? `, approved in Field Report by ${list[0].ok?.by || 'the Project engineer'}` : ''}.${list.some(wageDiffers) ? ' A wage to review is flagged on Payments.' : ''}${yes ? (sent === true ? ' Field Report has the new crew.' : ' Use Send lists to tell Field Report.') : ''}` : `Rejected: ${who}.`);
  } catch (err) { say(false, err.message); }
  finally { busy = false; store.notify(); }
}

/** Approve or deny one device (also used by the Notifications page). */
export async function decide(email, device, decision) {
  try { await apply('devDecide', { email, device, decision }); say(true, `${decision === 'approve' ? 'Approved' : 'Denied'}: the device of ${email}.`); }
  catch (err) { say(false, err.message); }
}

const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const place = d => (d.ip ? `IP ${d.ip}${d.loc ? ` · ${d.loc} (approximate)` : ''}` : 'IP not known yet');

/** A new sign-in waiting for the Admin, with Approve and Deny. */
export const deviceRow = d => html`<li class="fu-dev">
  <span class="chip high">New</span>
  <span class="fu-dev-t"><b>${d.name || d.email}</b> <span class="muted">${d.email}</span><br><span class="muted small">${d.ua || 'Unknown device'} · ${place(d)} · ${when(d.first)}</span></span>
  <span class="actions"><button class="btn small primary" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="approve">Approve</button>
  <button class="btn small ghost" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="deny">Deny</button></span></li>`;

/** The row as it will be saved: what is on screen over what Field Report holds. */
const rowOf = p => {
  const e = edits[p.email] || {};
  const dir = personByEmail(store.company?.staff, p.email)?.title;   // v0.45.1: the directory's position wins
  const who = personByEmail(store.company?.staff, p.email);   // v1.11.0: the Directory's name too, and role/projects as Field Report holds them
  return { full: who?.name || e.full || p.full || p.uName || '', pos: dir || e.pos || p.pos || p.uPos || '', inDir: !!who, role: p.role, projects: p.projects ?? [], act: e.act || '' };
};
const changed = p => {
  const r = rowOf(p);
  return !p.ok || r.full !== (p.full || '') || r.pos !== (p.pos || '') || r.role !== p.role || r.projects.join() !== (p.projects || []).join() || !!r.act;
};

function accessCell(p, r) {   // v1.11.0: shown only; the Manpower Directory's assignments set it
  if (!ONE_PER_PROJECT.includes(r.role) && r.role !== 'viewer') return html`<span class="muted">Every project</span>`;
  return r.projects.length ? r.projects.join(', ') : html`<span class="bad">None</span>`;
}
function accessCellOld(p, r, catalog) {
  if (!ONE_PER_PROJECT.includes(r.role)) return html`<span class="muted">Every project</span>`;
  const codes = catalog.map(x => x.code), all = codes.length && codes.every(k => r.projects.includes(k));
  return html`<details class="fu-access" ${openAccess === p.email ? 'open' : ''}>
    <summary data-act="fuOpen" data-e="${p.email}">${all ? 'All projects' : r.projects.length ? r.projects.join(', ') : html`<span class="bad">None</span>`}</summary>
    <label class="check"><input type="checkbox" data-chg="fuAll" data-e="${p.email}" ${all ? 'checked' : ''}> <b>Select all</b></label>
    ${catalog.map(x => html`<label class="check"><input type="checkbox" data-chg="fuProj" data-e="${p.email}" data-code="${x.code}" ${r.projects.includes(x.code) ? 'checked' : ''}> ${x.code} <span class="muted">${x.label || ''}${x.status && x.status !== 'active' ? ` (${x.status})` : ''}</span></label>`)}
  </details>`;
}

function personRow(p, catalog, devs = []) {
  const waits = devs.length, r = rowOf(p), [stWord, stTone] = ST_WORDS[p.st] || ST_WORDS.active;
  const typed = [p.uName, p.uPos].filter(Boolean).join(', ');
  const acts = ACTIONS.filter(([k]) => (k !== 'approve' && k !== 'deny') || waits > 0).filter(([k]) => !(k === 'activate' && p.st === 'active') && !(k === 'suspend' && p.st === 'suspended') && !(k === 'block' && p.st === 'blocked'));
  return html`<tr class="${p.st !== 'active' ? 'muted-row' : ''}">
    <td>${r.inDir ? html`<b>${r.full}</b>` : html`<input data-chg="fuEdit" data-e="${p.email}" data-f="full" value="${r.full}" aria-label="Name of ${p.email}" placeholder="Full name" class="fu-name">`}
      ${typed && !p.ok ? html`<br><span class="muted small">Typed in the app: ${typed}</span>` : ''}</td>
    <td class="small">${p.email}${devs.map(d => html`<div class="fu-newphone"><span class="chip warn">New phone</span> <span class="muted">${d.ua || 'Unknown device'} · ${when(d.first)}</span>
      <span class="actions"><button class="btn small primary" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="approve">Approve</button>
      <button class="btn small ghost" type="button" data-act="fuDecide" data-e="${d.email}" data-dev="${d.dev}" data-v="deny">Reject</button></span></div>`)}</td>
    <td>${r.pos || html`<span class="muted">No position</span>`}${r.inDir ? '' : html`<br><span class="chip warn small" title="Add this email to the person in the Manpower Directory (Employee data)">Not in the directory</span>`}</td>
    <td>${accessCell(p, r)}</td>
    <td>${FR_ROLE_WORD[r.role] || r.role}</td>
    <td><span class="chip ${stTone}">${stWord}</span><br>${p.ok ? html`<span class="ok small" title="${p.okBy ? `By ${p.okBy}` : ''}${p.okAt ? `, ${when(p.okAt)}` : ''}">✓ Confirmed</span>` : html`<span class="warn small">Not confirmed</span>`}</td>
    <td><select data-chg="fuEdit" data-e="${p.email}" data-f="act" aria-label="Action for ${p.email}">${options(acts, r.act)}</select></td>
    <td><button class="btn small ${changed(p) ? 'primary' : 'ghost'}" type="button" data-act="fuSave" data-e="${p.email}" ${busy || !changed(p) ? 'disabled' : ''}>${p.ok && !changed(p) ? 'Saved' : p.ok ? 'Save' : 'Confirm'}</button></td>
  </tr>`;
}

export const ROUTE_WORDS = [['script', 'Script (as before)'], ['read', 'Live reads (phones read from the database, still send through the script)'], ['both', 'Both (phones also write each report to the database: check Compare)']];
let cmp = null, cmpBusy = false;   // v0.44.0: Compare

/** Phase E1: the data route switch (docs/plan-one-database.md). Back to Script is the rollback. */
function routeCard() {
  if (store.role !== 'owner') return '';
  const r = store.fieldRoute;
  return html`<section class="card set-box"><h3>Data route <span class="muted">Phase E, one database</span></h3>
    <p class="muted">How Field Report phones get their data. With Live reads, a phone signed in to the database sees approvals, comments and project changes at once; reports are still sent through the script. Back to Script undoes it at once.</p>
    <div class="actions left"><select data-chg="fuRoute" aria-label="Field Report data route">${options(ROUTE_WORDS, r)}</select>
    <span class="chip ${r === 'script' ? '' : 'ok'}">${r === 'script' ? 'Script' : r === 'both' ? 'Both' : 'Live reads on'}</span></div>${r === 'both' ? compareBox() : ''}</section>`;
}

/** v0.44.0: Compare: per project, the reports from the script beside the reports written to the database. */
function compareBox() {
  const day = d => (d ? d.slice(5).split('-').reverse().join('/') : '–');
  return html`<h4>Compare <span class="muted">a week with nothing in the last column means the database can take over</span></h4>
    <div class="actions left"><button class="btn small" type="button" data-act="fuCompare" ${cmpBusy ? 'disabled' : ''}>${cmpBusy ? 'Reading…' : cmp ? 'Compare again' : 'Compare'}</button>${cmp ? html`<span class="muted small">Read ${when(cmp.at)}${store.fieldRouteSince ? `. Counted from ${day(store.fieldRouteSince)}, the day Both was switched on` : ''}</span>` : ''}</div>
    ${cmp ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Project</th><th>Since</th><th>Script</th><th>Database</th><th>Differences</th></tr></thead><tbody>
      ${cmp.rows.map(({ p, c }) => html`<tr><td>${p.name}</td><td>${day(c.from)}</td><td>${c.script.n} · last ${day(c.script.last)}</td><td>${c.db.n} · last ${day(c.db.last)}</td>
        <td>${!c.from ? html`<span class="muted">No report in the database yet</span>` : clean(c) ? html`<span class="chip ok">None</span>` : html`<span class="bad small">${[
          c.onlyScript.length ? `Only in the script: ${c.onlyScript.map(day).join(', ')}${c.why?.length ? `. Refused: ${c.why.join(' ')}` : '. No refusal recorded: the phone has not sent its copy (not connected, or another phone)'}` : '',
          c.onlyDb.length ? `Only in the database: ${c.onlyDb.map(day).join(', ')}` : '',
          ...c.numbers.map(n => `${day(n.date)}: No. ${n.script} in the script, ${n.db} in the database`)].filter(Boolean).join(' · ')}</span>`}</td></tr>`)}
    </tbody></table></div>` : ''}`;
}

async function compareLoad() {
  cmpBusy = true; store.notify();
  try {
    const ps = store.projects.filter(p => p.fieldCode);
    const rows = [];
    for (const p of ps) {
      const c = compareReports(await store.listCol(`projects/${p.id}/reports`), await store.listCol(`projects/${p.id}/fieldReports`), store.fieldRouteSince);
      // v1.10.2 (owner): why the phone's copy was refused, kept by the server for each missing day
      const miss = c.onlyScript.length ? await store.listCol(`projects/${p.id}/fieldMiss`).catch(() => []) : [];
      c.why = [...new Set(miss.filter(m => c.onlyScript.includes(m.date)).map(m => m.why))];
      rows.push({ p, c });
    }
    cmp = { at: Date.now(), rows };
  } catch (e) { tell(`Compare did not load: ${e.message}`); }
  cmpBusy = false; store.notify();
}

/* v1.11.0 (owner, 7 Nov): One source. Field Report people outside the Manpower Directory are brought in once (the Admin
   reviews the list), then the server keeps Field Report and Central Hub in step with the Directory every 2 minutes. */
const KIND_WORDS = { add: ['New in the Directory', 'info'], link: ['Linked to', 'ok'], projects: ['Projects added', 'warn'] };
let osState = null, osBusy = false;
async function osLoad() {
  if (osBusy || !store.getDoc) return;
  osBusy = true;
  try { const [flag, st] = await Promise.all([store.getDoc('global/oneSource').catch(() => null), store.getDoc('system/oneSource').catch(() => null)]); osState = { flag: flag || {}, st: st || null }; }
  catch { osState = { flag: {}, st: null }; }
  osBusy = false; store.notify();
}
function oneSourceCard(people) {
  if (store.role !== 'owner' || !feed) return '';
  if (!osState && !osBusy) osLoad();
  const on = !!osState?.flag?.on, st = osState?.st, plan = importPlan({ people, staff: store.company?.staff || [], projects: store.projects });
  const pname = id => store.projects.find(p => p.id === id)?.name || id;
  const list = plan.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Who</th><th>Email</th><th>Position</th><th>What happens</th><th>Projects added</th></tr></thead><tbody>
    ${plan.map(x => html`<tr><td>${x.name}</td><td class="small">${x.email}</td><td>${x.title || html`<span class="muted">none</span>`}</td><td>${chip(...KIND_WORDS[x.kind])} <span class="muted small">${x.why}</span></td><td>${x.pids.map(pname).join(', ') || '–'}</td></tr>`)}
  </tbody></table></div>` : '';
  if (!on) return html`<section class="card set-box"><h3>One source <span class="muted">the Manpower Directory decides who uses Field Report</span></h3>
    <p class="muted">${plan.length ? `${plan.length} Field Report ${plan.length === 1 ? 'person needs' : 'people need'} a place in the Manpower Directory first. Check the list, then press the button: they are added or linked, and from then on Field Report and Central Hub follow the Directory (sign-in email, position, projects). The Admin and the GM are kept as they are.` : 'Everyone on Field Report is in the Manpower Directory. Switch on to make the Directory the only source.'}</p>
    ${list}<div class="actions left"><button class="btn primary" type="button" data-act="fuOneSource" ${busy ? 'disabled' : ''}>${plan.length ? `Add ${plan.length} to the Directory and switch on` : 'Switch on'}</button></div></section>`;
  const strays = st?.strays || [], errs = st?.errors || [];
  return html`<section class="card set-box"><h3>One source <span class="chip ok">On</span></h3>
    <p class="muted small">Field Report and Central Hub follow the Manpower Directory${st ? `. Last check ${when(st.at)}: ${st.set} set, ${st.removed} removed, ${st.users} Central Hub ${st.users === 1 ? 'record' : 'records'} given projects` : ': the first check runs within 2 minutes'}.</p>
    ${errs.length ? html`<div class="callout warn small"><b>Not applied</b><ul>${errs.map(e => html`<li>${e.name || e.email}: ${e.text}</li>`)}</ul></div>` : ''}
    ${strays.length || plan.length ? html`<div class="callout warn small"><b>Not from the Directory</b>: ${[...new Set([...strays.map(x => x.email), ...plan.map(x => x.email)])].join(', ')}. Bring them in, or remove the sign-in email in Field Report's own list.</div>${list}
      ${plan.length ? html`<div class="actions left"><button class="btn" type="button" data-act="fuOneSource" ${busy ? 'disabled' : ''}>Add ${plan.length} to the Directory</button></div>` : ''}` : html`<p class="ok small">✓ Everyone on Field Report comes from the Directory.</p>`}
  </section>`;
}

export function body() {
  if (!feed && !busy) load();
  const people = feed?.people || [], catalog = feed?.catalog || [], waits = waiting();
  // v0.95.2 (owner, 5 Nov): a known account asking from a new phone is decided on its own row; only an email nobody has added yet stays on top
  const fresh = waits.filter(d => !people.some(p => p.email === d.email));
  return html`
    ${routeCard()}
    ${oneSourceCard(people)}
    <section class="card set-box">
      <h3>Field Report users <span class="muted">who may sign in to Field Report</span></h3>
      <p class="muted">Each person's name and position as they typed them in the Field Report app. Check them, correct them and press Confirm: from then on Field Report puts this name and position on every report the person sends, and the person can no longer change them. Suspend stops someone signing in for now (you get an alert if they try); Block stops them for good, without alerts; Remove takes away their access.</p>
      <div class="actions left"><button class="btn" type="button" data-act="fuLoad" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Refresh from Field Report'}</button>
        ${feed ? html`<span class="muted small">Read ${when(feed.at)}</span>` : ''}${isDemo() ? html`<span class="chip warn">Demo: sample people</span>` : ''}</div>
      ${said ? html`<p class="callout ${said.ok ? 'ok' : 'bad'}" role="status"><b>${said.ok ? '✓' : '✗'}</b> <span>${said.text}</span></p>` : ''}
      ${signupsCard(catalog)}
      ${crewCard()}
      ${fresh.length ? html`<h4>New sign-ins <span class="chip high">${fresh.length} new</span></h4><ul class="list fu-devs">${fresh.map(deviceRow)}</ul>` : ''}
      ${people.length ? html`<div class="table-wrap"><table class="table compact fu-table">
        <thead><tr><th>Name</th><th>Email</th><th>Position</th><th>Access</th><th>Role</th><th>Status</th><th>Action</th><th></th></tr></thead>
        <tbody>${people.map(p => personRow(p, catalog, waits.filter(d => d.email === p.email)))}</tbody>
      </table></div>` : feed ? html`<p class="empty">Nobody may sign in to Field Report yet.</p>` : ''}
      <p class="muted small">Nobody is added here (owner, 7 Nov). A person gets Field Report from the Manpower Directory: their sign-in email, position (Site Engineer, Project Engineer, Technician; anyone else is a Viewer) and projects. The Admin and the GM are kept as they are.</p>
    </section>`;
}

const edit = (email, patch) => { edits[email] = { ...(edits[email] || {}), ...patch }; };
const person = email => (feed?.people || []).find(p => p.email === email);

export const actions = {
  fuLoad() { return load(true); },
  fuCompare() { return compareLoad(); },
  /** v1.11.0: the approved list into the Manpower Directory (team members too), then One source switched on. */
  async fuOneSource() {
    const plan = importPlan({ people: feed?.people || [], staff: store.company?.staff || [], projects: store.projects });
    if (busy || !confirm(`${plan.length ? `Add or link ${plan.length} ${plan.length === 1 ? 'person' : 'people'} in the Manpower Directory, then ` : ''}make the Directory the only source of Field Report access?

From then on, a person's sign-in email, position and projects in the Directory decide what they get in Field Report; nobody is added on this page.`)) return;
    busy = true; store.notify();
    try {
      const today = new Date().toISOString().slice(0, 10), by = store.profile?.name || store.user?.email || 'Admin';
      let touched = [];
      if (plan.length) store.updateCompany(co => { const out = applyImport(co.staff || [], plan, { newId: () => uid('st'), today, by }); co.staff.splice(0, co.staff.length, ...out.staff); touched = out.touched; });
      for (const t of touched) for (const pid of t.pids) { const a = (t.person.assignments || []).find(x => x.projectId === pid); if (a) await store.updateOther(pid, ws => assign(ws, t.person, a)); }
      if (!isDemo()) await store.setDoc('global/oneSource', { on: true, at: new Date().toISOString(), by });
      osState = { flag: { on: true }, st: osState?.st || null };
      say(true, `${plan.length ? `${plan.length} ${plan.length === 1 ? 'person' : 'people'} added or linked in the Manpower Directory. ` : ''}One source is on: Field Report follows the Directory from the next check (2 minutes).`);
    } catch (err) { say(false, err.message); }
    finally { busy = false; store.notify(); }
  },   // v0.44.3: a click (it was wrongly among the changes)
  /** v0.27.0: reject every waiting sign-up request at once; each person gets the email. */
  async fuRejectAll() {
    const wait = signupsWaiting();
    if (!wait.length || busy || !confirm(`Reject all ${wait.length} waiting sign-up requests?

Each person gets an email saying it was not approved, and cannot ask again from that account.`)) return;
    busy = true; store.notify();
    let done = 0, mailed = 0;
    try {
      for (const r of wait) {
        const out = await apply('signupDecide', { email: r.email, decision: 'reject', by: store.profile.name || store.user?.name || 'Admin' });
        done++; if (out?.mailed) mailed++;
      }
      say(true, `Rejected ${done} request${done === 1 ? '' : 's'}.${isDemo() ? ' (demo: no email is sent)' : ` ${mailed} email${mailed === 1 ? '' : 's'} sent.`}`);
    } catch (err) { say(false, `${done} rejected, then: ${err.message}`); }
    finally { busy = false; store.notify(); }
  },
  /** Approve (role and project first, then the decision, which emails the person) or reject a sign-up request. */
  async fuSignup(el) {
    const r = (feed?.signups || []).find(x => x.email === el.dataset.e);
    if (!r || busy) return;
    const row = el.closest('.su-row'), pid = row?.querySelector('[data-su=person]')?.value || '';
    const yes = el.dataset.v === 'approve', who = (store.company?.staff || []).find(p => p.id === pid);
    if (yes && !who) return say(false, `Choose who ${r.name || r.email} is in the Manpower Directory. Add them there first if they are not in it.`);
    const { role, projects } = who ? accessFromDirectory(who) : { role: 'viewer', projects: [] };
    if (yes && NEEDS_PROJECT.includes(role) && !projects.length) return say(false, `Put ${who.name} on a project in the Manpower Directory first (Employee data, Projects).`);
    if (!yes && !confirm(`Reject the request of ${r.name || r.email}?\n\nThey get an email saying it was not approved, and cannot ask again from that account.`)) return;
    busy = true; store.notify();
    try {
      if (yes) {
        if (!isDemo()) store.updateCompany(co => { const x = co.staff.find(y => y.id === who.id); if (x) x.accountEmail = r.email; });   // v1.11.0: the sign-in email on the Directory person
        await apply('accessSet', { email: r.email, role, projects: NEEDS_PROJECT.includes(role) ? projects : [] });
        await apply('userSet', { email: r.email, full: who.name, pos: who.title || '', ok: true });
      }
      const out = await apply('signupDecide', { email: r.email, decision: yes ? 'approve' : 'reject', by: store.profile.name || store.user?.name || 'Admin' });
      const mail = out?.demo ? ' (demo: no email is sent)' : out?.mailed ? ` An email went to ${r.email}.` : ` The email could not be sent (${out?.mailError || 'unknown reason'}): tell them yourself.`;
      say(true, `${yes ? `Approved: ${who.name}, ${FR_ROLE_WORD[role]}${projects.length ? ` on ${projects.join(', ')}` : ''}` : `Rejected: ${r.name || r.email}`}.${mail}`);
      if (yes && isDemo()) feed.people.push({ email: r.email, id: r.email.split('@')[0].toUpperCase().slice(0, 6), role, projects, st: 'active', full: who.name, pos: who.title || '', uName: r.name || '', uPos: '', ok: true });
    } catch (err) { say(false, err.message); }
    finally { busy = false; store.notify(); }
  },
  fuCrew(el) { return crewDecide(el.dataset.p, el.dataset.v === 'approve', crewWaiting().filter(r => r.proj === el.dataset.p && (!el.dataset.id || r.id === el.dataset.id))); },
  fuCrewOpen(el) { crewEditing = crewEditing === el.dataset.id ? '' : el.dataset.id; },
  fuOpen(el) { openAccess = openAccess === el.dataset.e ? '' : el.dataset.e; },
  fuDecide(el) { return decide(el.dataset.e, el.dataset.dev, el.dataset.v); },
  /** Save a row: projects and role, then name and position (confirmed), then the chosen action. */
  async fuSave(el) {
    const p = person(el.dataset.e);
    if (!p || busy) return;
    const r = rowOf(p), email = p.email;
    if (!r.full.trim()) return say(false, `Write the name of ${email} first.`);

    busy = true; store.notify();
    try {
      const st = { activate: 'active', suspend: 'suspended', block: 'blocked' }[r.act];
      await apply('userSet', { email, full: r.full.trim(), pos: r.pos, ok: true, ...(st ? { st } : {}) });
      if (r.act === 'approve' || r.act === 'deny') {
        for (const d of waiting().filter(x => x.email === email)) await apply('devDecide', { email, device: d.dev, decision: r.act });
      }
      delete edits[email];
      say(true, `Saved: ${r.full.trim()}${r.pos ? `, ${r.pos}` : ''}${st ? ` (${ST_WORDS[st][0].toLowerCase()})` : ''}. Field Report uses this name and position from now on.`);
    } catch (err) { say(false, err.message); }
    finally { busy = false; store.notify(); }
  },
};

export const changes = {
  fuRoute(el) { store.setFieldRoute(el.value); },
  fuCrewEdit(el) { const v = el.value.trim(); if (v || el.dataset.f === 'trade') crewEdits[el.dataset.id] = { ...(crewEdits[el.dataset.id] || {}), [el.dataset.f]: v }; },
  fuEdit(el) { edit(el.dataset.e, { [el.dataset.f]: el.value }); },
  fuAll(el) {
    const p = person(el.dataset.e);
    if (p) { edit(p.email, { projects: el.checked ? (feed.catalog || []).map(x => x.code) : [] }); openAccess = p.email; }
  },
  fuProj(el) {
    const p = person(el.dataset.e);
    if (!p) return;
    const now = rowOf(p).projects.filter(k => k !== el.dataset.code);
    edit(p.email, { projects: el.checked ? [...now, el.dataset.code] : now });
    openAccess = p.email;
  },
};

export const submits = {
  // v1.11.0 (owner): nobody is added by hand; the old form handler is kept unused for older open pages
  async fuAddOld(fd) {
    const email = String(fd.get('email') || '').trim().toLowerCase(), role = String(fd.get('role') || 'engineer'), proj = String(fd.get('proj') || '');
    if (ONE_PER_PROJECT.includes(role) && !proj) { say(false, 'Choose the project this person reports on.'); return false; }
    try {
      if (isDemo()) feed.people.push({ email, id: email.split('@')[0].toUpperCase().slice(0, 6), role, projects: proj ? [proj] : [], st: 'active', full: '', pos: '', uName: '', uPos: '', ok: false });
      else await apply('accessSet', { email, role, projects: proj ? [proj] : [] });
      say(true, `${email} may now sign in to Field Report with Google.`);
    } catch (err) { say(false, err.message); return false; }
    return true;
  },
};
