// v1.47.0 (owner, 10 Nov, P1–P6): People & Access. One table of every person: name, sign-in email, position, project,
// a Central Hub tick (users/<email>), a Field Report tick (the script's access list), status. The Manpower Directory
// stays the one source of each person (company/main/staff); this page only adds the two ticks, Add person, Remove
// person and Import. The Admin and the GM use it; the GM never changes the Admin and never makes anyone Admin.
// Executive (owner, Q2): reads every page, changes nothing, no pay and no HR. Pure: used by the page and the server.
import { accountOf, frRoleOf, codeMaps } from './onesource.js';
import { tierOfPerson, rankPatchFor, positionsOf } from './manpower.js';
import { GRANTABLE, newOfficePages } from '../core/access.js';

const low = s => String(s || '').trim().toLowerCase();
const norm = s => low(s).replace(/[^a-z0-9]+/g, ' ').trim();
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EXECUTIVE = 'Executive';
export const isExecutive = title => norm(title) === 'executive';
/** Central Hub pages an Executive reads: every page but crew pay (Payments). Pay and HR stay closed in the rules. */
export const EXEC_PAGES = [...GRANTABLE.map(([k]) => k).filter(k => k !== 'payments'), 'master'];   // master: v1.48.0

/** The status words of a row. */
export const STATUS = { admin: 'Admin', active: 'Active', none: 'No access', removed: 'Removed', left: 'Left', noEmail: 'No sign-in email' };

/** Is this person (Directory record or row) the Admin? */
export const isAdminEmail = (email, admins = []) => admins.map(low).includes(low(email));

/**
 * Who is asking and what they may do. actor = { email, admin, gm }.
 * The GM may change anyone but the Admin, and never gives Admin rights or Field Report's GM role (Q1).
 */
export function mayChange(actor, target, admins = []) {
  if (!actor?.admin && !actor?.gm) return 'Only the Admin and the GM manage people and access.';
  if (target && isAdminEmail(target.email || accountOf(target), admins)) return actor.admin ? 'The Admin\'s own access is never changed here.' : 'Only the Admin changes the Admin.';
  return '';
}

/** The project names of a Directory person (active assignments), or "All projects". */
export function projectWords(p, projects = []) {
  if (p?.allProjects || isExecutive(p?.title)) return 'All projects';
  const ids = [...new Set((p?.assignments || []).filter(a => a.active !== false).map(a => a.projectId))];
  return ids.map(id => projects.find(x => x.id === id)?.name || '').filter(Boolean).join(', ');
}
export const projectIds = (p, projects = []) => (p?.allProjects || isExecutive(p?.title) ? projects.map(x => x.id) : [...new Set((p?.assignments || []).filter(a => a.active !== false).map(a => a.projectId))]);

/**
 * The table: one row per Directory person (left people only when asked), with the two ticks from users/ and the
 * Field Report access list. frPeople = [{ email, role, projects }] or null when the script could not be read.
 */
export function buildRows({ staff = [], users = [], frPeople = null, projects = [], admins = [] }) {
  const userBy = new Map(users.map(u => [low(u.email), u]));
  const frBy = new Map((frPeople || []).map(x => [low(x.email), x]));
  return staff.map(p => {
    const email = accountOf(p), u = email ? userBy.get(email) : null, fr = email ? frBy.get(email) : null;
    const admin = !!email && isAdminEmail(email, admins);
    const ch = admin || (!!u && u.role !== 'disabled');
    const frOn = !!fr;
    const status = admin ? STATUS.admin : p.status === 'left' ? STATUS.left : p.accessRemoved ? STATUS.removed : !email ? STATUS.noEmail : ch || frOn ? STATUS.active : STATUS.none;
    return {
      id: p.id, name: p.name || '', email, title: p.title || '', executive: isExecutive(p.title),
      project: projectWords(p, projects), projectIds: projectIds(p, projects),
      ch, fr: frOn, frKnown: frPeople != null, frRole: fr?.role || '', status, admin, left: p.status === 'left', removed: !!p.accessRemoved,
      division: p.division || '',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The filters of the page: search (name, email, position, project), position, project id, app access. */
export function filterRows(rows, f = {}) {
  const q = norm(f.search);
  return rows.filter(r => (!q || norm(`${r.name} ${r.email} ${r.title} ${r.project}`).includes(q))
    && (!f.role || norm(r.title) === norm(f.role))
    && (!f.project || r.projectIds.includes(f.project))
    && (!f.app || (f.app === 'ch' ? r.ch : f.app === 'fr' ? r.fr : f.app === 'both' ? r.ch && r.fr : f.app === 'none' ? !r.ch && !r.fr : true))
    && (f.show === 'all' || (f.show === 'removed' ? r.removed || r.left : !r.removed && !r.left)));
}

/** The users/<email> record a Central Hub tick makes, from the Directory person (Executive: read only, no pay). */
export function chRecord(p, projects = []) {
  const exec = isExecutive(p.title);
  const office = exec || (tierOfPerson(p) || 9) <= 2;
  const ranks = exec ? { ranks: [], title: EXECUTIVE } : rankPatchFor(positionsOf(p));
  return {
    email: accountOf(p), name: p.name || '', ...ranks, role: office ? 'office' : 'site',
    projects: projectIds(p, projects), divisions: exec ? ['installation', 'trading'] : [p.division === 'trading' ? 'trading' : 'installation'],
    ...(exec ? { readOnly: true, pages: EXEC_PAGES, pagesV: 2 } : office ? { pages: newOfficePages(ranks.ranks || []), pagesV: 2 } : {}),   // v1.48.0 (R1): no money pages to start
  };
}

/** The Field Report access a tick gives: the role from the position, the project codes ('' = refused, with why). */
export function frAccess(p, projects = [], actor = {}) {
  const role = isExecutive(p.title) ? 'viewer' : frRoleOf(p.title);
  const { toCode } = codeMaps(projects);
  const codes = projectIds(p, projects).map(id => toCode.get(id)).filter(Boolean).sort();
  if (role !== 'exec' && !codes.length) return { error: `${p.name || 'This person'} is on no project connected to Field Report. Put them on a project first.` };
  return { role, projects: codes };
}

/**
 * Data conflicts to show the Admin (P4): two Directory people with one sign-in email, Central Hub or Field Report
 * accounts with no Directory person, access kept by someone who left, and a Field Report role that is not their position's.
 */
export function conflicts({ staff = [], users = [], frPeople = null, admins = [] }) {
  const out = [], seen = new Map();
  for (const p of staff) { const e = accountOf(p); if (!e || p.status === 'left') continue; if (seen.has(e)) out.push({ kind: 'twice', email: e, text: `${e} is the sign-in email of both ${seen.get(e).name} and ${p.name} in the Directory.` }); else seen.set(e, p); }
  const inDir = new Set(staff.filter(p => p.status !== 'left').map(accountOf).filter(Boolean));
  const leftSet = new Set(staff.filter(p => p.status === 'left').map(accountOf).filter(Boolean));
  for (const u of users) { const e = low(u.email); if (e && u.role !== 'owner' && !isAdminEmail(e, admins) && !inDir.has(e) && !leftSet.has(e)) out.push({ kind: 'chOnly', email: e, name: u.name || '', text: `${u.name || e} can sign in to Central Hub but is not in the Directory (the server adds them within minutes).` }); }
  for (const x of frPeople || []) {
    const e = low(x.email);
    if (!e || isAdminEmail(e, admins) || x.role === 'admin') continue;
    if (!inDir.has(e)) { if (leftSet.has(e)) continue; out.push({ kind: 'frOnly', email: e, name: x.full || x.name || '', role: x.role, projects: x.projects || [], text: `${x.full || x.name || e} has Field Report access (${x.role}) but is not in the Directory.` }); continue; }
    const p = seen.get(e), want = isExecutive(p?.title) ? 'viewer' : frRoleOf(p?.title);
    if (p && x.role !== want && x.role !== 'exec') out.push({ kind: 'role', email: e, text: `${p.name}: Field Report role ${x.role}, but the Directory position "${p.title || 'none'}" means ${want}.` });
  }
  const userSet = new Set(users.map(u => low(u.email)));
  for (const p of staff) { const e = accountOf(p); if (e && p.status === 'left' && !isAdminEmail(e, admins) && (userSet.has(e) || (frPeople || []).some(x => low(x.email) === e))) out.push({ kind: 'left', email: e, text: `${p.name} has left but can still sign in (${e}). Untick their access.` }); }
  return out;
}

// ---- Import (P3): CSV or Excel rows -> a preview -> the rows the server applies ----

const HEAD = { name: ['name', 'full name'], email: ['email', 'sign in email', 'e mail', 'account'], title: ['role', 'position', 'title', 'job title'], project: ['project', 'project code', 'site'], ch: ['ch', 'central hub'], fr: ['fr', 'field report'] };
const yes = v => /^(y|yes|1|true|x|✓|on)$/i.test(String(v ?? '').trim());

/** A CSV text as rows of cells (quotes, commas and semicolons). */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const sep = /;/.test(String(text).split('\n')[0]) && !/,/.test(String(text).split('\n')[0]) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

/** Rows of cells (the first is the header) -> { rows: [{ line, name, email, title, project, ch, fr }], missing } */
export function readTable(cells) {
  const [head = [], ...body] = cells;
  const at = {};
  head.forEach((h, i) => { const k = Object.keys(HEAD).find(key => HEAD[key].includes(norm(h))); if (k && at[k] == null) at[k] = i; });
  const missing = ['name', 'email'].filter(k => at[k] == null);
  const rows = body.map((r, n) => ({ line: n + 2, name: String(r[at.name] ?? '').trim(), email: low(r[at.email]), title: String(r[at.title] ?? '').trim(), project: String(r[at.project] ?? '').trim(), ch: at.ch != null && yes(r[at.ch]), fr: at.fr != null && yes(r[at.fr]) }));
  return { rows, missing };
}

/**
 * The preview: each row New (a Directory person is added), Update (the email is known: only the ticks, and a project
 * or position where the Directory has none, are applied: what is there is kept) or Error.
 */
export function importPreview(rows, { staff = [], projects = [], admins = [], actor = {} } = {}) {
  const byEmail = new Map(staff.filter(p => p.status !== 'left').map(p => [accountOf(p), p]).filter(([e]) => e));
  const seenEmails = new Set();
  return rows.map(r => {
    const err = !r.name ? 'No name.' : !EMAIL.test(r.email) ? 'No valid email.' : seenEmails.has(r.email) ? 'This email is twice in the file.' : '';
    seenEmails.add(r.email);
    const proj = r.project ? projects.find(p => [p.fieldCode, p.code, p.name].some(v => v && norm(v) === norm(r.project))) : null;
    const pErr = r.project && !proj ? `No project "${r.project}".` : '';
    const known = byEmail.get(r.email);
    const deny = known ? mayChange(actor, known, admins) : isAdminEmail(r.email, admins) ? 'The Admin is never imported.' : mayChange(actor, null, admins);
    const error = err || pErr || deny;
    return { ...r, projectId: proj?.id || '', projectName: proj?.name || '', action: error ? 'Error' : known ? 'Update' : 'New', id: known?.id || '', error };
  });
}
