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

export const ROLE_WORDS = [['engineer', 'Site engineer'], ['coordinator', 'Project engineer'], ['admin', 'Admin'], ['exec', 'Executive (read only)']];
const ST_WORDS = { active: ['Active', 'ok'], suspended: ['Suspended', 'warn'], blocked: ['Blocked', 'high'] };
const ACTIONS = [['', 'No change'], ['approve', 'Approve new device'], ['deny', 'Deny new device'], ['activate', 'Activate'], ['suspend', 'Suspend'], ['block', 'Block'], ['remove', 'Remove']];
const ONE_PER_PROJECT = ['engineer', 'coordinator'];   // these need projects; admin and exec see every project

let feed = null;        // { people, catalog, devices, inbox, at }
let busy = false;
let said = null;        // { ok, text }
let edits = {};         // email -> { full, pos, role, projects, act } changed on screen, not saved yet
let openAccess = '';    // the email whose project list is unfolded

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
    { email: 'yonas@example.com', name: 'Yonas B', phone: '', at: '2026-10-28T15:10:00Z', ip: '', loc: '', st: 'rejected', by: 'Demo Admin', decidedAt: '2026-10-28T16:00:00Z', mailed: '2026-10-28T16:00:00Z' },
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
}
export const current = () => feed;
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
    return { mailed: false, demo: true };
  }
  const out = await fieldUserDo(action, body);
  if (out.signups) feed = { ...feed, signups: out.signups };
  if (out.people) feed = { ...feed, people: out.people, catalog: out.catalog || feed.catalog };
  if (out.devices) feed = { ...feed, devices: out.devices };
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
      <select data-su="role" aria-label="Field Report role for ${r.email}">${options(ROLE_WORDS, 'engineer')}</select>
      <select data-su="proj" aria-label="Project for ${r.email}">${options([['', 'Project…'], ...catalog.map(x => [x.code, `${x.code} ${x.label || ''}`])], '')}</select>
      <button class="btn small primary" type="button" data-act="fuSignup" data-e="${r.email}" data-v="approve" ${busy ? 'disabled' : ''}>Approve</button>
      <button class="btn small ghost" type="button" data-act="fuSignup" data-e="${r.email}" data-v="reject" ${busy ? 'disabled' : ''}>Reject</button>
    </div></li>`;
}
function signupsCard(catalog) {
  const all = feed?.signups || [], wait = all.filter(r => r.st === 'wait'), done = all.filter(r => r.st !== 'wait').slice(0, 8);
  if (!all.length) return '';
  return html`<h4>Sign-up requests ${wait.length ? html`<span class="chip high">${wait.length} waiting</span>` : ''}</h4>
    <p class="muted small">People who signed in to Field Report with a Google account that has no access yet. Approve gives the role and project you choose and approves the phone they asked from. Either way they get an email with the result.</p>
    ${wait.length ? html`<ul class="list fu-devs">${wait.map(r => signupRow(r, catalog))}</ul>` : html`<p class="muted">No request is waiting.</p>`}
    ${done.length ? html`<details><summary class="muted">Decided (${done.length})</summary><ul class="plain">${done.map(r => html`<li>${chip(...SU_WORDS[r.st])} ${r.name || r.email} <span class="muted">${r.email} · ${r.by || ''} ${when(r.decidedAt)}${r.mailed ? ' · emailed' : ' · not emailed'}</span></li>`)}</ul></details>` : ''}`;
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
  return { full: e.full ?? (p.full || p.uName || ''), pos: e.pos ?? (p.pos || p.uPos || ''), role: e.role ?? p.role, projects: e.projects ?? p.projects ?? [], act: e.act || '' };
};
const changed = p => {
  const r = rowOf(p);
  return !p.ok || r.full !== (p.full || '') || r.pos !== (p.pos || '') || r.role !== p.role || r.projects.join() !== (p.projects || []).join() || !!r.act;
};

function accessCell(p, r, catalog) {
  if (!ONE_PER_PROJECT.includes(r.role)) return html`<span class="muted">Every project</span>`;
  const codes = catalog.map(x => x.code), all = codes.length && codes.every(k => r.projects.includes(k));
  return html`<details class="fu-access" ${openAccess === p.email ? 'open' : ''}>
    <summary data-act="fuOpen" data-e="${p.email}">${all ? 'All projects' : r.projects.length ? r.projects.join(', ') : html`<span class="bad">None</span>`}</summary>
    <label class="check"><input type="checkbox" data-chg="fuAll" data-e="${p.email}" ${all ? 'checked' : ''}> <b>Select all</b></label>
    ${catalog.map(x => html`<label class="check"><input type="checkbox" data-chg="fuProj" data-e="${p.email}" data-code="${x.code}" ${r.projects.includes(x.code) ? 'checked' : ''}> ${x.code} <span class="muted">${x.label || ''}${x.status && x.status !== 'active' ? ` (${x.status})` : ''}</span></label>`)}
  </details>`;
}

function personRow(p, catalog, waits) {
  const r = rowOf(p), [stWord, stTone] = ST_WORDS[p.st] || ST_WORDS.active;
  const typed = [p.uName, p.uPos].filter(Boolean).join(', ');
  const acts = ACTIONS.filter(([k]) => (k !== 'approve' && k !== 'deny') || waits > 0).filter(([k]) => !(k === 'activate' && p.st === 'active') && !(k === 'suspend' && p.st === 'suspended') && !(k === 'block' && p.st === 'blocked'));
  return html`<tr class="${p.st !== 'active' ? 'muted-row' : ''}">
    <td><input data-chg="fuEdit" data-e="${p.email}" data-f="full" value="${r.full}" aria-label="Name of ${p.email}" placeholder="Full name" class="fu-name">
      ${typed && !p.ok ? html`<br><span class="muted small">Typed in the app: ${typed}</span>` : ''}</td>
    <td class="small">${p.email}${waits ? html` <span class="chip high">New</span>` : ''}</td>
    <td><select data-chg="fuEdit" data-e="${p.email}" data-f="pos" aria-label="Position of ${p.email}">${options([['', 'Choose…']], r.pos)}${groupOptions(positionGroups(r.pos), r.pos)}</select></td>
    <td>${accessCell(p, r, catalog)}</td>
    <td><select data-chg="fuEdit" data-e="${p.email}" data-f="role" aria-label="Field Report role of ${p.email}">${options(ROLE_WORDS, r.role)}</select></td>
    <td><span class="chip ${stTone}">${stWord}</span><br>${p.ok ? html`<span class="ok small" title="${p.okBy ? `By ${p.okBy}` : ''}${p.okAt ? `, ${when(p.okAt)}` : ''}">✓ Confirmed</span>` : html`<span class="warn small">Not confirmed</span>`}</td>
    <td><select data-chg="fuEdit" data-e="${p.email}" data-f="act" aria-label="Action for ${p.email}">${options(acts, r.act)}</select></td>
    <td><button class="btn small ${changed(p) ? 'primary' : 'ghost'}" type="button" data-act="fuSave" data-e="${p.email}" ${busy || !changed(p) ? 'disabled' : ''}>${p.ok && !changed(p) ? 'Saved' : p.ok ? 'Save' : 'Confirm'}</button></td>
  </tr>`;
}

export function body() {
  if (!feed && !busy) load();
  const people = feed?.people || [], catalog = feed?.catalog || [], waits = waiting();
  return html`
    <section class="card set-box">
      <h3>Field Report users <span class="muted">who may sign in to Field Report</span></h3>
      <p class="muted">Each person's name and position as they typed them in the Field Report app. Check them, correct them and press Confirm: from then on Field Report puts this name and position on every report the person sends, and the person can no longer change them. Suspend stops someone signing in for now (you get an alert if they try); Block stops them for good, without alerts; Remove takes away their access.</p>
      <div class="actions left"><button class="btn" type="button" data-act="fuLoad" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Refresh from Field Report'}</button>
        ${feed ? html`<span class="muted small">Read ${when(feed.at)}</span>` : ''}${isDemo() ? html`<span class="chip warn">Demo: sample people</span>` : ''}</div>
      ${said ? html`<p class="callout ${said.ok ? 'ok' : 'bad'}" role="status"><b>${said.ok ? '✓' : '✗'}</b> <span>${said.text}</span></p>` : ''}
      ${signupsCard(catalog)}
      ${waits.length ? html`<h4>New sign-ins <span class="chip high">${waits.length} new</span></h4><ul class="list fu-devs">${waits.map(deviceRow)}</ul>` : ''}
      ${people.length ? html`<div class="table-wrap"><table class="table compact fu-table">
        <thead><tr><th>Name</th><th>Email</th><th>Position</th><th>Access</th><th>Role</th><th>Status</th><th>Action</th><th></th></tr></thead>
        <tbody>${people.map(p => personRow(p, catalog, waits.filter(d => d.email === p.email).length))}</tbody>
      </table></div>` : feed ? html`<p class="empty">Nobody may sign in to Field Report yet. Add a person below.</p>` : ''}
      <h4>Add a person</h4>
      <form data-form="fuAdd" class="entry">
        <input type="email" name="email" placeholder="name@gmail.com" required aria-label="Google email" class="wide">
        <select name="role" aria-label="Field Report role">${options(ROLE_WORDS, 'engineer')}</select>
        <select name="proj" aria-label="Project">${options([['', 'Project…'], ...catalog.map(x => [x.code, `${x.code} ${x.label || ''}`])], '')}</select>
        <button class="btn">Add</button>
      </form>
      <p class="muted small">A Site engineer or Project engineer needs at least one project; the Admin and Executives see every project. Field Report allows one Site engineer and one Project engineer per project.</p>
    </section>`;
}

const edit = (email, patch) => { edits[email] = { ...(edits[email] || {}), ...patch }; };
const person = email => (feed?.people || []).find(p => p.email === email);

export const actions = {
  fuLoad() { return load(true); },
  /** Approve (role and project first, then the decision, which emails the person) or reject a sign-up request. */
  async fuSignup(el) {
    const r = (feed?.signups || []).find(x => x.email === el.dataset.e);
    if (!r || busy) return;
    const row = el.closest('.su-row'), role = row?.querySelector('[data-su=role]')?.value || 'engineer', proj = row?.querySelector('[data-su=proj]')?.value || '';
    const yes = el.dataset.v === 'approve';
    if (yes && ONE_PER_PROJECT.includes(role) && !proj) return say(false, `Choose the project ${r.name || r.email} reports on.`);
    if (!yes && !confirm(`Reject the request of ${r.name || r.email}?\n\nThey get an email saying it was not approved, and cannot ask again from that account.`)) return;
    busy = true; store.notify();
    try {
      if (yes) {
        await apply('accessSet', { email: r.email, role, projects: proj ? [proj] : [] });
        if (r.name) await apply('userSet', { email: r.email, full: r.name, ok: true });
      }
      const out = await apply('signupDecide', { email: r.email, decision: yes ? 'approve' : 'reject', by: store.profile.name || store.user?.name || 'Admin' });
      const mail = out?.demo ? ' (demo: no email is sent)' : out?.mailed ? ` An email went to ${r.email}.` : ` The email could not be sent (${out?.mailError || 'unknown reason'}): tell them yourself.`;
      say(true, `${yes ? 'Approved' : 'Rejected'}: ${r.name || r.email}.${mail}`);
      if (yes && isDemo()) feed.people.push({ email: r.email, id: r.email.split('@')[0].toUpperCase().slice(0, 6), role, projects: proj ? [proj] : [], st: 'active', full: r.name || '', pos: '', uName: r.name || '', uPos: '', ok: true });
    } catch (err) { say(false, err.message); }
    finally { busy = false; store.notify(); }
  },
  fuOpen(el) { openAccess = openAccess === el.dataset.e ? '' : el.dataset.e; },
  fuDecide(el) { return decide(el.dataset.e, el.dataset.dev, el.dataset.v); },
  /** Save a row: projects and role, then name and position (confirmed), then the chosen action. */
  async fuSave(el) {
    const p = person(el.dataset.e);
    if (!p || busy) return;
    const r = rowOf(p), email = p.email;
    if (!r.full.trim()) return say(false, `Write the name of ${email} first.`);
    if (ONE_PER_PROJECT.includes(r.role) && !r.projects.length && r.act !== 'remove') return say(false, `Choose at least one project for ${email}.`);
    if (r.act === 'remove' && !confirm(`Remove ${email} from Field Report?\n\nThey are signed out at once and can no longer sign in. Their reports stay.`)) return;
    busy = true; store.notify();
    try {
      if (r.act === 'remove') { await apply('accessRemove', { email }); delete edits[email]; return say(true, `${email} was removed from Field Report.`); }
      if (r.role !== p.role || r.projects.join() !== (p.projects || []).join()) await apply('accessSet', { email, id: p.id, role: r.role, projects: ONE_PER_PROJECT.includes(r.role) ? r.projects : [] });
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
  async fuAdd(fd) {
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
