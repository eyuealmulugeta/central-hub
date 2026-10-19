// State store. Views read and change data only through this module, and it
// keeps the same shape whichever backend holds the data:
//
//   Local (no sign-in)             Cloud (Firebase)
//   sf:meta      project list      projects/<id>                       settings, one doc per project
//   sf:global    prices, rates     global/main                         price matrix, rates, letterhead
//   sf:ws:<id>   one workspace     projects/<id>/<section>/<record>    one doc per record
//                                  users/<email>, config/setup         who may see what
//
// Operational data is reachable only through `store.ws`, which resolves to the
// active project's own workspace, so one project's data cannot leak into another.

import { seed } from './seed.js';
import { emptyWorkspace, emptyCompany, OWNER_SECTIONS, PUBLIC_SECTIONS, DEFAULT_MARKUPS } from './schema.js';
import { SECTIONS, COMPANY_SECTIONS, diffWorkspace, sectionFromDocs, stamp } from './sync.js';
import { todayISO, uid, DEFAULT_WEEK } from './util.js';
import { ROLE_PAGES, pagesOf, mayOpen, seesMoney, companySections, MONEY_SECTIONS } from './access.js';
import { divisionsOf } from './nav.js';
import { OWNER_RANKS } from '../engine/evaluation.js';
import { lostBetween, restore } from '../engine/undo.js';
import { isLimited, isActive } from '../engine/deployment.js';
import { claim, sessionPath, newDeviceId, deviceName, isEnded, HEARTBEAT_MS } from '../engine/session.js';

const K = { meta: 'sf:meta', global: 'sf:global', company: 'sf:company', ws: id => `sf:ws:${id}`, active: 'sf:active' };
const COMPANY_PATH = 'company/main';
const VERSION = 1;
// What a Site user may read. Must match firestore.rules.
const SUMMARY_REPEAT_MS = 10 * 60 * 1000;
const SITE_SECTIONS = ['tasks', 'reports', 'items', 'team', 'laborRates', 'assemblies', 'procurement', 'requests'];

const ls = () => globalThis.localStorage;
const read = key => { try { return JSON.parse(ls().getItem(key)); } catch { return null; } };
const write = (key, value) => {
  try { ls().setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Could not save', key, e); }
};
const clean = v => JSON.parse(JSON.stringify(v));

let meta = { projects: [], activeId: null };
let global = null;
let company = emptyCompany();   // company-wide records (shipments, ...), not tied to one project
let booking = null;              // settings of the public booking page (public/booking); null = the defaults
const cache = new Map();
const subscribers = new Set();
const errorSubscribers = new Set();
const undoSubscribers = new Set();   // told when a person deleted or cleared something, with a way to put it back
const netSubscribers = new Set();    // told when the count of changes waiting to reach the database changes
let pending = 0;                      // changes sent and not yet confirmed by the database (they wait here while offline)
let userEditing = false;               // true while a handler of something a person did runs: only those can be undone
let faults = [];                      // problems reported by devices: the Owner sees these
const emit = () => subscribers.forEach(fn => fn());

// ---- cloud state ----
let api = null;          // adapter from cloud.js; null = local mode
let me = null;           // { email, name }
let coOwners = [];        // the other owners (config/setup.coOwners): the same rights as the Admin
let primary = true;      // the first owner: the only one who adds or removes co-owners and hands the role on
let role = 'owner';      // owner | office | site. Local mode has no sign-in, so everything is allowed.
let users = [];          // other people with access (the Owner sees these)
let requests = [];       // people who signed in and are waiting for the Admin's approval
let loading = false;     // the open workspace is still arriving
let pages = ROLE_PAGES.office;   // pages this person may open (the Admin opens everything)
let ranks = OWNER_RANKS;   // Site Engineer, Project Manager, General Manager: decides whom this person may evaluate
let session = null;      // the record this device holds in sessions/<email>: one signed-in device per person (not the Admin)
let heartbeat = null;    // timer that keeps the session record fresh
let sessions = [];       // every person's session record (the Owner sees these, to reset one)
let lockedBy = null;     // the record of the device that holds this person's session, when this one was refused
const endedSubscribers = [];
let divisions = [];       // the divisions this person works in (empty = both); set by the Admin
let limited = false;      // sees only the projects linked to their email (every Site user; an Office user the Admin limited)
let approver = false;    // may issue client reports (the Owner, or Office users the Owner ticked)
let profile = { name: '', title: '' }; // how the signed-in person is named on documents they approve
let openId = null;
let shared = [];         // listeners that live for the whole session
let opened = [];         // listeners of the open workspace
const sentSummary = new Map(); // project id -> { key, at }: the last sidebar summary this browser wrote

/** A random id for this device, kept in this browser. */
function deviceId() {
  try {
    let id = localStorage.getItem('sf:device');
    if (!id) { id = newDeviceId(); localStorage.setItem('sf:device', id); }
    return id;
  } catch { return 'device-unknown'; }
}
function stopSession() { clearInterval(heartbeat); heartbeat = null; session = null; }
/** This device holds the session: keep it fresh, and notice when it is taken away. */
function beginSession(record) {
  stopSession();
  session = record;
  const path = sessionPath(me.email);
  heartbeat = setInterval(() => {
    if (session && navigator.onLine !== false) api.set(path, { ...session, lastSeen: Date.now() }).catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref?.();   // never keeps a Node process (the tests) alive
  shared.push(() => clearInterval(heartbeat));
  shared.push(api.watchDoc(path, data => {
    if (!session || !isEnded(data, session.token)) return;
    const reason = data && !data.released ? 'taken' : 'reset';
    stopSession();
    endedSubscribers.forEach(fn => fn(reason));
  }, () => {}));
}

function fail(err) {
  console.warn(err);
  const denied = /permission/i.test(`${err?.code} ${err?.message}`);
  errorSubscribers.forEach(fn => fn(denied ? 'You do not have permission to change that.' : 'Could not save. Check the connection.'));
}
let toldAt = 0;
/** A co-owner reads everything and changes nothing: every way of writing stops here, and says so (not more than once in a few seconds). */
const viewOnly = (quiet = false) => {
  if (!api || primary || role !== 'owner') return false;
  const now = Date.now();
  if (!quiet && now - toldAt > 4000 && typeof dispatchEvent === 'function') {
    toldAt = now;
    dispatchEvent(new CustomEvent('hub-toast', { detail: '✗ Co-owners can view everything, but cannot edit, delete or change settings and permissions.' }));
  }
  return true;
};

const send = promise => {
  if (!promise?.then) return;
  pending++;
  netSubscribers.forEach(fn => fn());
  promise.then(() => { pending--; netSubscribers.forEach(fn => fn()); }, err => { pending--; netSubscribers.forEach(fn => fn()); fail(err); });
};

/** After something a person did: if it deleted or cleared anything, offer to put it back. */
function offerUndo(before, after, sections, apply) {
  if (!userEditing) return;
  const lost = lostBetween(before, after, sections);
  if (lost) undoSubscribers.forEach(fn => fn({ label: lost.label, undo: () => apply(target => restore(target, lost)) }));
}

function load(id) {
  if (!cache.has(id)) cache.set(id, { ...emptyWorkspace(), ...(api ? {} : read(K.ws(id)) || {}) });
  return cache.get(id);
}

function install({ meta: m, global: g, workspaces, company: co }) {
  for (let i = ls().length - 1; i >= 0; i--) {
    const key = ls().key(i);
    if (key?.startsWith('sf:ws:')) ls().removeItem(key);
  }
  meta = m; global = g;
  company = { ...emptyCompany(), ...co };
  cache.clear();
  write(K.meta, meta);
  write(K.global, global);
  write(K.company, company);
  for (const [id, ws] of Object.entries(workspaces)) write(K.ws(id), ws);
}

/** The project sections this person loads: a Site user the site ones, an Office user without a money page everything but money. */
const readable = () => (role === 'site' ? SITE_SECTIONS
  : seesMoney(role, pages) ? SECTIONS : SECTIONS.filter(s => !MONEY_SECTIONS.includes(s)));

/** Listen to every section of one project and keep its workspace in memory. */
function openWorkspace(id) {
  opened.forEach(off => off());
  opened = [];
  openId = id;
  cache.clear();
  loading = false;
  if (!id) return;
  const ws = load(id);
  const sections = readable();
  const pending = new Set(sections);
  loading = true;
  const arrived = section => { pending.delete(section); loading = pending.size > 0; emit(); };
  for (const section of sections) {
    opened.push(api.watchCol(`projects/${id}/${section}`,
      docs => { ws[section] = sectionFromDocs(section, docs); arrived(section); },
      err => { fail(err); arrived(section); }));
  }
}

function setProjects(list) {
  meta.projects = [...list].sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name));
  if (!meta.projects.some(p => p.id === meta.activeId)) meta.activeId = meta.projects[0]?.id || null;
  if (meta.activeId !== openId) openWorkspace(meta.activeId);
  emit();
}

export const store = {
  /** Local mode: everything in this browser. */
  init(today = todayISO()) {
    meta = read(K.meta);
    global = read(K.global);
    company = { ...emptyCompany(), ...read(K.company) };
    booking = read('sf:booking');
    cache.clear();
    if (!meta?.projects?.length || !global) install(seed(today));
  },

  /**
   * Cloud mode. Resolves false when the signed-in person has not been given access.
   * The first person ever to sign in becomes the Owner.
   */
  async connect(adapter, user, today = todayISO()) {
    [...shared, ...opened].forEach(off => off());
    stopSession(); lockedBy = null; sessions = [];
    shared = []; opened = []; openId = null; users = []; requests = []; profile = { name: '', title: '' };
    api = adapter; me = user;
    company = emptyCompany();
    cache.clear();
    meta = { projects: [], activeId: ls().getItem(K.active) };

    // a refusal is tagged with what was being read, so the sign-in page can say where it stopped
    const reading = (what, promise) => promise.catch(err => { err.step = what; throw err; });
    let setup = await reading('config/setup', api.get('config/setup'));
    if (!setup) {
      try { await api.set('config/setup', { owner: me.email, created: new Date().toISOString() }); } catch { /* someone else claimed it first */ }
      setup = await api.get('config/setup');
    }
    let assigned = [];
    coOwners = Array.isArray(setup?.coOwners) ? setup.coOwners : [];
    primary = setup?.owner === me.email;
    if (primary || coOwners.includes(me.email)) {
      role = 'owner';
      pages = ROLE_PAGES.office;
      ranks = OWNER_RANKS;
      divisions = [];
      limited = false;
      approver = true;
      // the Owner's own entry under users/ exists only to hold their name and title
      const own = await api.get(`users/${me.email}`).catch(() => null);
      profile = { name: own?.name || '', title: own?.title || '' };
    } else {
      const mine = await api.get(`users/${me.email}`).catch(() => null);
      if (!mine) { role = null; return false; }
      role = mine.role === 'office' ? 'office' : 'site';
      pages = pagesOf({ ...mine, role });
      ranks = Array.isArray(mine.ranks) ? mine.ranks : [];
      limited = isLimited({ ...mine, role });
      divisions = Array.isArray(mine.divisions) ? mine.divisions : [];
      // nobody comes in before the Admin has chosen their department
      if (!divisionsOf({ role, divisions }).length) { role = null; return 'unassigned'; }
      approver = role === 'office' && mine.approver === true;
      profile = { name: mine.name || '', title: mine.title || '' };
      assigned = mine.projects || [];
    }

    // one signed-in device per person: a second device is refused until the first signs out or
    // the Admin resets it. Silence never frees it. The Admin is never locked.
    if (role !== 'owner') {
      const got = await claim(api, { email: me.email, deviceId: deviceId(), device: deviceName(typeof navigator === 'undefined' ? '' : navigator.userAgent) });
      if (!got.ok) { lockedBy = got.by; return 'locked'; }
      if (got.record) beginSession(got.record);
    }

    global = await reading('global/main', api.get('global/main'));
    if (!global) {
      global = seed(today).global; // starter materials, regions and sample prices
      if (role === 'owner' && primary) await api.set('global/main', global);   // a co-owner never writes
    }
    shared.push(api.watchDoc('global/main', data => { if (data) { global = data; emit(); } }, fail));
    if (role !== 'site') shared.push(api.watchDoc('public/booking', data => { booking = data; emit(); }, () => {}));
    if (role === 'owner') {
      shared.push(api.watchCol('users', docs => { users = docs; emit(); }, fail));
      shared.push(api.watchCol('sessions', docs => { sessions = docs; emit(); }, () => {}));
      shared.push(api.watchCol('diagnostics', docs => { faults = docs; emit(); }, () => {}));
      // quiet when the rules that allow requests have not been published yet
      shared.push(api.watchCol('requests', docs => { requests = docs; emit(); }, () => {}));
    }
    // company-wide records are for the Office and the Owner; a Site user never loads them
    {
      for (const section of companySections(role, pages)) {
        shared.push(api.watchCol(`${COMPANY_PATH}/${section}`, docs => { company[section] = sectionFromDocs(section, docs); emit(); }, section === 'messages' ? () => {} : fail));
      }
    }

    // evaluations are read only by whoever wrote them (the Admin reads all): the query says so, or the database refuses it
    if (role !== 'owner' && ranks.length) {
      shared.push(api.watchCol(`${COMPANY_PATH}/evaluations`, docs => { company.evaluations = sectionFromDocs('evaluations', docs); emit(); }, () => {}, ['by', '==', me.email]));
    }

    await new Promise(resolve => {
      if (!limited) {
        shared.push(api.watchCol('projects', docs => { setProjects(docs); resolve(); }, err => { fail(err); resolve(); }));
        return;
      }
      // a limited user may only read the projects linked to their email, one by one
      const got = new Map();
      let waiting = assigned.length;
      if (!waiting) { setProjects([]); resolve(); }
      for (const id of assigned) {
        let first = true;
        const settle = () => { if (first) { first = false; if (--waiting === 0) resolve(); } };
        shared.push(api.watchDoc(`projects/${id}`,
          // a Site user does not get a project that is on hold or completed
          data => { if (data && (role !== 'site' || isActive(data))) got.set(id, data); else got.delete(id); setProjects([...got.values()]); settle(); },
          // the database refuses a project that is not active for a Site user: it simply is not shown
          err => { if (/permission/i.test(`${err?.code} ${err?.message}`)) { got.delete(id); setProjects([...got.values()]); } else fail(err); settle(); }));
      }
    });
    return true;
  },

  get cloud() { return !!api; },
  get user() { return me; },
  get role() { return role; },
  /** The Admin is the Owner: the only one who deletes records and changes settings. Local mode has no sign-in. */
  get isAdmin() { return role === 'owner'; },
  /** The first owner. Co-owners are Admins too, but cannot add co-owners or hand the Admin role on. */
  get isPrimary() { return !api || primary; },
  /** A co-owner: sees everything, changes nothing. */
  get readOnly() { return !!api && role === 'owner' && !primary; },
  get coOwners() { return coOwners; },
  /** May this person open the page? */
  can(page) { return mayOpen(role, pages, page); },
  /** Costs, invoices and billing terms are loaded only for people with a page that shows them. */
  get seesMoney() { return seesMoney(role, pages); },
  /** Everyone the Owner has given access to (the Owner's own entry is left out). */
  get users() { return users.filter(u => u.email !== me?.email && !coOwners.includes(u.email) && u.role !== 'owner'); },
  get profile() { return profile; },
  /** Changes sent and not yet confirmed by the database. While offline they wait here and go when signal returns. */
  get pending() { return pending; },
  onNet(fn) { netSubscribers.add(fn); return () => netSubscribers.delete(fn); },
  /** Call fn({ label, undo }) when a person deletes or clears something; undo() puts it back. */
  onUndoable(fn) { undoSubscribers.add(fn); return () => undoSubscribers.delete(fn); },
  /** Mark that the code now running answers something a person did (a click, a typed change, a submitted form). */
  userEdit(on) { userEditing = !!on; },
  /** Problems reported by devices (the Owner only), newest first. */
  get faults() { return [...faults].sort((a, b) => String(b.at).localeCompare(String(a.at))); },
  clearFaults() { if (viewOnly()) return; send(api.batch(faults.map(f => ({ path: `diagnostics/${f.id}`, data: null })))); },
  /** The divisions this person works in, as ticked by the Admin. Empty means both. */
  get divisions() { return divisions; },
  /** The ranks this person holds. The Admin holds General Manager and Project Manager. */
  get ranks() { return ranks; },
  /** Admin only: addresses that signed in without having been given access, waiting for a yes or no. */
  get requests() { return requests.filter(r => r.email && !users.some(u => u.email === r.email)); },
  /** Someone who signed in but has no access yet: leave a request for the Admin. */
  requestAccess() {
    return api.set(`requests/${me.email}`, { email: me.email, name: me.name && me.name !== me.email ? me.name : '', at: new Date().toISOString() });
  },
  /** Admin only: approve a request as 'site' or 'office', or decline it with no role. */
  answerRequest(email, as, division) {
    if (viewOnly()) return;
    const r = requests.find(x => x.email === email);
    if (as) this.setUser(email, { role: as, name: r?.name || '', projects: [], divisions: [division] });
    send(api.remove(`requests/${email}`));
  },
  /** "Name, Title" for documents this person approves; the email only if no name is known at all. */
  get signature() {
    const name = profile.name || (me && me.name !== me.email ? me.name : '');
    return [name, profile.title].filter(Boolean).join(', ') || me?.email || 'Office';
  },
  get loading() { return loading; },
  /** Local mode has no sign-in, so there is nobody to restrict. */
  get canApprove() { return !api || approver; },

  get global() { return global; },
  /** Company-wide records. Change them only through updateCompany. */
  get company() { return company; },
  /** Mutate the company-wide records: store.updateCompany(co => co.shipments.push(s)) */
  updateCompany(fn) {
    if (viewOnly()) return;
    const before = structuredClone(company);
    fn(company);
    if (!api) {
      write(K.company, company);
    } else {
      stamp(company, COMPANY_SECTIONS.filter(s => !PUBLIC_SECTIONS.includes(s)));
      const ops = diffWorkspace(before, company, COMPANY_SECTIONS).map(o => ({ path: `${COMPANY_PATH}/${o.section}/${o.id}`, data: o.data }));
      if (ops.length) send(api.batch(ops));
    }
    offerUndo(before, company, COMPANY_SECTIONS.filter(s => s !== 'messages'), apply => this.updateCompany(apply));
    emit();
  },
  /** Settings of the public booking page. Null until the Admin changes something: the page then uses its defaults. */
  get booking() { return booking; },
  /** Admin only: change the booking page. `full` is the complete settings object. */
  setBooking(patch) {
    if (viewOnly()) return;
    booking = { ...(booking || {}), ...patch };
    if (api) send(api.set('public/booking', clean(booking))); else write('sf:booking', booking);
    emit();
  },
  /** A file too large for one record (a PDF sent for signature), stored as numbered parts of text. */
  async putFile(name, parts) {
    if (viewOnly()) return;
    for (const [i, data] of parts.entries()) {
      if (api) await api.set(`${COMPANY_PATH}/signfiles/${name}_${i}`, { id: `${name}_${i}`, data });
      else ls().setItem(`sf:signfile:${name}_${i}`, data);
    }
  },
  async getFile(name, count) {
    let text = '';
    for (let i = 0; i < count; i++) text += api ? (await api.get(`${COMPANY_PATH}/signfiles/${name}_${i}`))?.data || '' : ls().getItem(`sf:signfile:${name}_${i}`) || '';
    return text;
  },
  async dropFile(name, count) {
    if (viewOnly()) return;
    for (let i = 0; i < count; i++) { if (api) await api.remove(`${COMPANY_PATH}/signfiles/${name}_${i}`); else ls().removeItem(`sf:signfile:${name}_${i}`); }
  },
  /** Demo only: another tab of this browser (the signing page) changed the company records. */
  reloadCompany() { if (!api) { company = { ...emptyCompany(), ...read(K.company) }; booking = read('sf:booking'); emit(); } },
  get projects() { return meta.projects; },
  get project() { return meta.projects.find(p => p.id === meta.activeId) || meta.projects[0]; },
  /** The active project's workspace. The only mutable handle on operational data. */
  get ws() { return load(this.project.id); },
  /** Read-only copy of another project's workspace (local mode; in the cloud only the open project is loaded). */
  peek(id) { return structuredClone(load(id)); },

  switchTo(id) {
    if (!meta.projects.some(p => p.id === id)) return;
    meta.activeId = id;
    if (api) { ls().setItem(K.active, id); openWorkspace(id); } else write(K.meta, meta);
    emit();
  },

  /** Mutate the active workspace: store.update(ws => ws.tasks.push(task)) */
  update(fn) {
    if (viewOnly()) return;
    const id = this.project.id;
    const ws = load(id);
    const before = structuredClone(ws);
    fn(ws);
    if (!api) {
      write(K.ws(id), ws);
    } else {
      stamp(ws);
      const ops = diffWorkspace(before, ws).map(o => ({ path: `projects/${id}/${o.section}/${o.id}`, data: o.data }));
      if (ops.length) send(api.batch(ops));
    }
    offerUndo(before, ws, Object.keys(emptyWorkspace()), apply => this.updateOther(id, apply));
    emit();
  },
  /**
   * Change the workspace of any project, open or not, and get that workspace back.
   * In the cloud a project that is not open is read once for this, so use it sparingly.
   */
  async updateOther(id, fn) {
    if (viewOnly()) return;
    if (id === this.project?.id) { this.update(fn); return load(id); }
    if (!api) {
      const ws = load(id);
      fn(ws);
      write(K.ws(id), ws);
      emit();
      return ws;
    }
    const ws = emptyWorkspace();
    for (const section of readable()) ws[section] = sectionFromDocs(section, await api.list(`projects/${id}/${section}`));
    const before = structuredClone(ws);
    fn(ws);
    stamp(ws);
    const ops = diffWorkspace(before, ws).map(o => ({ path: `projects/${id}/${o.section}/${o.id}`, data: o.data }));
    if (ops.length) await api.batch(ops);
    return ws;
  },
  updateProject(fn) {
    if (viewOnly()) return;
    const p = this.project;
    fn(p);
    if (api) send(api.set(`projects/${p.id}`, clean(p))); else write(K.meta, meta);
    emit();
  },
  /** Change settings of a project that is not the open one (for example to release something it holds). */
  patchProject(id, patch) {
    if (viewOnly()) return;
    const p = meta.projects.find(x => x.id === id);
    if (!p) return;
    Object.assign(p, patch);
    if (api) send(api.set(`projects/${p.id}`, clean(p))); else write(K.meta, meta);
    emit();
  },
  updateGlobal(fn) {
    if (viewOnly()) return;
    fn(global);
    if (api) send(api.set('global/main', clean(global))); else write(K.global, global);
    emit();
  },

  /** `extra` holds anything else the New project wizard settled: client, contract value, billing, markups, start. */
  addProject({ name, type, regionId, currency, ...extra }) {
    if (viewOnly()) return;
    const project = {
      id: uid('p'), name, type, regionId, currency, created: Date.now(),
      workDays: [...DEFAULT_WEEK], markups: { ...DEFAULT_MARKUPS }, budget: 0, contractValue: 0, ...extra,
    };
    meta.projects.push(project);
    meta.activeId = project.id;
    if (api) {
      ls().setItem(K.active, project.id);
      send(api.set(`projects/${project.id}`, project));
      openWorkspace(project.id);
    } else {
      write(K.meta, meta);
      write(K.ws(project.id), load(project.id));
    }
    emit();
    return project;
  },

  /** Deletes a project and its workspace. The last remaining project cannot be deleted. */
  removeProject(id) {
    if (viewOnly()) return;
    if (meta.projects.length < 2 || !meta.projects.some(p => p.id === id)) return false;
    meta.projects = meta.projects.filter(p => p.id !== id);
    if (meta.activeId === id) meta.activeId = meta.projects[0].id;
    if (api) {
      // a project document has no automatic cascade, so its records are deleted section by section
      send((async () => {
        for (const section of SECTIONS) {
          const docs = sectionFromDocs(section, await api.list(`projects/${id}/${section}`));
          const ops = diffWorkspace({ [section]: docs }, {}).map(o => ({ path: `projects/${id}/${o.section}/${o.id}`, data: null }));
          if (ops.length) await api.batch(ops);
        }
        await api.remove(`projects/${id}`);
      })());
      if (openId === id) openWorkspace(meta.activeId);
    } else {
      cache.delete(id);
      ls().removeItem(K.ws(id));
      write(K.meta, meta);
    }
    emit();
    return true;
  },

  /** Progress shown next to each project in the sidebar; kept on the project so other projects need not be loaded. */
  saveSummary(summary) {
    if (viewOnly(true)) return;
    const p = this.project;
    // someone who does not load the money records would work out a poorer figure than the one already saved
    if (!api || !seesMoney(role, pages) || !p || loading) return;
    const alerts = (summary.alerts || []).join('\n');
    const cash = m => (m ? `${m.invoiced}|${m.received}|${m.spent}|${m.owed}|${m.currency}` : '');
    if (p.summary?.progress === summary.progress && p.summary?.slip === summary.slip && p.summary?.basis === summary.basis && cash(p.summary?.money) === cash(summary.money) && (p.summary?.alerts || []).join('\n') === alerts) return;
    // Two people whose computers are on different dates work out different figures and would
    // keep overwriting each other, so the same figures are not written again straight away.
    const key = `${summary.progress}|${summary.basis}|${summary.slip}|${cash(summary.money)}|${alerts}`;
    const last = sentSummary.get(p.id);
    if (last?.key === key && Date.now() - last.at < SUMMARY_REPEAT_MS) return;
    sentSummary.set(p.id, { key, at: Date.now() });
    p.summary = summary;
    send(api.set(`projects/${p.id}`, clean(p)));
  },

  /** Owner only: give a Google account access. role is 'office' or 'site'; Site users see only `projects`. */
  setUser(email, patch) {
    if (viewOnly()) return;
    email = email.trim().toLowerCase();
    const current = users.find(u => u.email === email) || { email, role: 'site', projects: [] };
    send(api.set(`users/${email}`, { ...current, ...patch }));
  },
  /** Owner only: their own name and title. Everyone else's are set by the Owner through setUser. */
  setProfile(patch) {
    if (viewOnly()) return;
    profile = { ...profile, ...patch };
    const own = users.find(u => u.email === me.email) || { email: me.email, role: 'owner' };
    send(api.set(`users/${me.email}`, { ...own, ...profile }));
    emit();
  },
  removeUser(email) { if (viewOnly()) return; send(api.remove(`users/${email}`)); },
  /**
   * Admin only: hand the Admin role to another Google account (for example when moving to a company
   * address). The old address stays on as an Office user. Resolves once the server has accepted both steps.
   */
  async transferAdmin(email) {
    email = String(email || '').trim().toLowerCase();
    if (role !== 'owner' || !primary) throw new Error('Only the first Admin can do this.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a full email address.');
    if (email === me.email) throw new Error('That is already the Admin.');
    const setup = await api.get('config/setup');
    // the present Admin keeps access, as an Office user who may approve reports
    await api.set(`users/${me.email}`, { email: me.email, role: 'office', approver: true, projects: [], divisions: ['installation'], name: profile.name, title: profile.title });
    const next = users.find(u => u.email === email);
    await api.set(`users/${email}`, { email, role: 'owner', projects: [], name: next?.name || '', title: next?.title || '' });
    await api.set('config/setup', { ...setup, owner: email, coOwners: (setup?.coOwners || []).filter(x => x !== email), previousOwner: me.email, transferred: new Date().toISOString() });
  },
  /** First Admin only: another person who is an Admin too (sees both departments, may do everything the Admin may). */
  async addCoOwner(email) {
    email = String(email || '').trim().toLowerCase();
    if (role !== 'owner' || !primary) throw new Error('Only the first Admin can do this.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a full email address.');
    if (email === me.email) throw new Error('That is you.');
    const setup = await api.get('config/setup');
    const next = [...new Set([...(setup?.coOwners || []), email])];
    await api.set('config/setup', { ...setup, coOwners: next });
    coOwners = next;
    emit();
  },
  async removeCoOwner(email) {
    if (role !== 'owner' || !primary) throw new Error('Only the first Admin can do this.');
    const setup = await api.get('config/setup');
    const next = (setup?.coOwners || []).filter(x => x !== email);
    await api.set('config/setup', { ...setup, coOwners: next });
    coOwners = next;
    emit();
  },
  /** Let go of this device's session (so the person can sign in elsewhere), then sign out. */
  async signOut() {
    if (session) {
      const rec = { ...session, released: true, lastSeen: Date.now() };
      stopSession();
      try { await api.set(sessionPath(me.email), rec); } catch { /* offline: the session stays held until this device signs in and out again online, or the Admin resets it */ }
    }
    return api.signOut();
  },
  /** The device that holds this person's session, when this one was refused. */
  get lockedBy() { return lockedBy; },
  /** Every person's session record: the Owner only. */
  get sessions() { return sessions; },
  /** Call fn('taken' | 'reset') when this device loses its session to another device or to the Admin. */
  onSessionEnded(fn) { endedSubscribers.push(fn); },
  /** Owner only: end someone's session so they can sign in on another device. */
  resetSession(email) { if (viewOnly()) return; send(api.remove(sessionPath(email))); },

  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  /** Re-render without a data change, for example when a background request finishes. */
  notify: emit,
  onError(fn) { errorSubscribers.add(fn); return () => errorSubscribers.delete(fn); },

  async exportAll() {
    const workspaces = {};
    for (const p of meta.projects) {
      if (!api || p.id === openId) { workspaces[p.id] = load(p.id); continue; }
      const ws = emptyWorkspace();
      for (const section of SECTIONS) ws[section] = sectionFromDocs(section, await api.list(`projects/${p.id}/${section}`));
      workspaces[p.id] = ws;
    }
    return { app: 'siteflow', version: VERSION, exportedAt: new Date().toISOString(), meta, global, company, workspaces };
  },

  /** Local: replaces everything in this browser. Cloud: adds or replaces the projects in the file, and the shared prices. */
  async importAll(data) {
    if (viewOnly()) return;
    if (data?.app !== 'siteflow' || !data.meta?.projects?.length || !data.global || !data.workspaces) {
      throw new Error('Not an Amistad Prefab Central Hub backup file');
    }
    if (!api) { install(data); emit(); return; }
    const ops = [{ path: 'global/main', data: clean(data.global) }];
    const co = { ...emptyCompany(), ...clean(data.company || {}) };
    // HR records in a backup can only be restored by the Owner; anyone else's import leaves them out
    if (role !== 'owner') for (const section of OWNER_SECTIONS) co[section] = [];
    stamp(co, COMPANY_SECTIONS);
    for (const o of diffWorkspace(emptyCompany(), co, COMPANY_SECTIONS)) ops.push({ path: `${COMPANY_PATH}/${o.section}/${o.id}`, data: o.data });
    data.meta.projects.forEach((p, i) => {
      ops.push({ path: `projects/${p.id}`, data: clean({ created: Date.now() + i, ...p }) });
      const ws = { ...emptyWorkspace(), ...clean(data.workspaces[p.id] || {}) };
      stamp(ws);
      for (const o of diffWorkspace(emptyWorkspace(), ws)) ops.push({ path: `projects/${p.id}/${o.section}/${o.id}`, data: o.data });
    });
    await api.batch(ops);
  },
  reset(today = todayISO()) { if (!api) { install(seed(today)); emit(); } },
};

// local mode: another tab saved something, so drop the caches and re-render
if (typeof addEventListener === 'function') {
  addEventListener('storage', e => {
    if (api || !e.key?.startsWith('sf:')) return;
    meta = read(K.meta) || meta;
    global = read(K.global) || global;
    company = { ...emptyCompany(), ...read(K.company) };
    cache.clear();
    emit();
  });
}
