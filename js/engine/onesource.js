// v1.11.0 (owner, 7 Nov): One source. The Manpower Directory is the only place a person is entered. Their sign-in email
// (accountEmail), position (title) and project assignments decide their Field Report access (role and projects) and
// their Central Hub projects. Nobody is added by hand on the Field users page. The Admin's own account and the GM
// (Field Report roles admin and exec) are shown, never changed. Field Report people found outside the Directory are
// brought in once (importPlan, reviewed by the Admin), then the server keeps every change in step (syncPlan). Pure.

const low = s => String(s || '').trim().toLowerCase();
const norm = s => low(s).replace(/[^a-z0-9]+/g, ' ').trim();
const up = s => String(s || '').trim().toUpperCase();

/** Field Report roles the sync never changes or removes. */
export const KEEP_ROLES = ['admin', 'exec'];
export const NEEDS_PROJECT = ['engineer', 'coordinator', 'viewer', 'technician'];
/** The owner's words for the Field Report roles (exec is shown as GM). */
export const FR_ROLE_WORD = { engineer: 'Site engineer', coordinator: 'Project engineer', admin: 'Admin', exec: 'GM', viewer: 'Viewer', technician: 'Technician' };

/** The Field Report role from the Directory position (owner, 7 Nov). */
export function frRoleOf(title) {
  const t = norm(title);
  if (/\bgeneral manager\b|^gm$/.test(t)) return 'exec';
  if (/\b(project engineer|project manager|pe|pm)\b/.test(t)) return 'coordinator';
  if (/\bsite engineer\b|^se$/.test(t)) return 'engineer';
  if (/\btechnician\b/.test(t)) return 'technician';
  return 'viewer';
}
/** A position from a Field Report role, for a person brought in without one. */
const titleOfRole = role => ({ engineer: 'Site Engineer', coordinator: 'Project Engineer', exec: 'General Manager', technician: 'Technician', admin: 'Admin' }[role] || '');

export const accountOf = p => low(p && p.accountEmail);
const left = p => !p || p.status === 'left';

/**
 * v1.30.0 (owner, 9 Nov: "Jony is Project engineer, in the Directory Site engineer"): the name and position a sign-in
 * record, the Engagement page or Sign-in history shows come from the Directory person with that sign-in email, never
 * from what a phone typed or kept ("Jojo, Project Engineer"). Records of someone not in the Directory keep their own.
 */
export function directoryWho(staff = []) {
  const m = new Map();
  for (const p of staff) { const e = accountOf(p); if (e && (!m.has(e) || !left(p))) m.set(e, p); }
  return m;
}
export function named(list = [], staff = []) {
  const who = directoryWho(staff);
  return list.map(e => { const p = who.get(low(e && e.email)); return p ? { ...e, name: p.name || e.name, position: p.title || e.position, typed: e.name !== p.name ? e.name : undefined } : e; });
}
/** v1.31.0 (owner, 9 Nov): who may be given "All projects" in the Directory: the Admin's own account, the GM and Tier 1. */
export const mayAllProjects = (p, tier, admins = []) => tier === 1 || frRoleOf(p && p.title) === 'exec' || admins.map(low).includes(accountOf(p));
/** The people who should use the apps, from the Directory (with a sign-in email, not left): { email, name, position }. */
export const appPeople = (staff = []) => staff.filter(p => accountOf(p) && !left(p)).map(p => ({ email: accountOf(p), name: p.name || '', position: p.title || '' }));

/** Field Report code <-> Central Hub project id, for connected projects only. */
export function codeMaps(projects = []) {
  const toPid = new Map(), toCode = new Map();
  for (const p of projects) if (p && p.id && p.fieldCode && p.fieldLabel) { toPid.set(up(p.fieldCode), p.id); toCode.set(p.id, up(p.fieldCode)); }
  return { toPid, toCode };
}

/** The Directory person behind a Field Report email: by sign-in email, then work email, then the same name. */
export function personFor(fr, staff = []) {
  const e = low(fr.email);
  const live = staff.filter(p => !left(p));
  const byAcct = live.find(p => accountOf(p) === e) || staff.find(p => accountOf(p) === e);
  if (byAcct) return { p: byAcct, by: 'email' };
  const byMail = live.find(p => low(p.email) === e || low(p.privateEmail) === e);
  if (byMail) return { p: byMail, by: 'work email' };
  const names = [fr.full, fr.uName].map(norm).filter(n => n && n.includes(' '));
  const byName = names.length ? live.filter(p => names.includes(norm(p.name))) : [];
  if (byName.length === 1 && !accountOf(byName[0])) return { p: byName[0], by: 'name' };
  return null;
}

/**
 * The one-time list the Admin approves: each Field Report person (not the Admin's own, not GM or Admin roles' missing
 * projects) as { email, kind: 'add' | 'link' | 'projects' | 'ok', personId, name, title, pids, why }.
 *   add       not in the Directory: a new person with this email, position and projects
 *   link      found by work email or name: the sign-in email is set on that person, missing projects added
 *   projects  linked already, but on Field Report projects the Directory does not have: those assignments are added
 */
export function importPlan({ people = [], staff = [], projects = [] }) {
  const { toPid } = codeMaps(projects), out = [];
  for (const fr of people) {
    const email = low(fr.email);
    if (!email.includes('@')) continue;
    const pids = (fr.projects || []).map(c => toPid.get(up(c))).filter(Boolean);
    const hit = personFor(fr, staff);
    const name = String(fr.full || fr.uName || '').trim() || email.split('@')[0];
    if (!hit) { out.push({ email, kind: 'add', personId: '', name, title: String(fr.pos || fr.uPos || '').trim() || titleOfRole(fr.role), role: fr.role, pids, why: 'Not in the Directory' }); continue; }
    const have = new Set((hit.p.assignments || []).filter(a => a.active !== false).map(a => a.projectId));
    const more = pids.filter(id => !have.has(id));
    if (hit.by !== 'email') out.push({ email, kind: 'link', personId: hit.p.id, name: hit.p.name, title: hit.p.title || '', role: fr.role, pids: more, why: `Same ${hit.by}: the sign-in email is set on ${hit.p.name}` });
    else if (more.length && !KEEP_ROLES.includes(fr.role)) out.push({ email, kind: 'projects', personId: hit.p.id, name: hit.p.name, title: hit.p.title || '', role: fr.role, pids: more, why: 'On Field Report projects the Directory does not list' });
  }
  return out;
}

/** The Directory after the approved list: new people, sign-in emails set, assignments added. Returns { staff, touched }. */
export function applyImport(staff = [], plan = [], { newId, today = '', by = '' } = {}) {
  const next = staff.map(p => ({ ...p, assignments: [...(p.assignments || [])] })), touched = [];
  for (const x of plan) {
    let p = x.personId && next.find(y => y.id === x.personId);
    if (x.kind === 'add' || !p) {
      p = { id: newId(), name: x.name, title: x.title, department: '', projectId: x.pids[0] || '', status: 'active', started: today, agreement: {}, documents: [], notes: '',
        level: 'crew', accountEmail: x.email, email: x.email, assignments: [], addedBy: by, addedOn: today, from: 'Field Report users (one source)' };
      next.push(p);
    } else if (x.kind === 'link') p.accountEmail = x.email;
    for (const pid of x.pids) {
      const a = p.assignments.find(y => y.projectId === pid);
      if (a) a.active = true; else p.assignments.push({ projectId: pid, role: p.title || '', dayRate: 0, active: true });
    }
    touched.push({ person: p, pids: x.pids });
  }
  return { staff: next, touched };
}

/**
 * What the server changes so Field Report and Central Hub follow the Directory.
 * frPeople: the script's access list; admins: the Admin's own emails. managed: emails the sync set before (removable).
 * -> { set: [{ email, role, projects, name }], remove: [email], users: [{ email, projects }], strays: [fr], kept: [fr], managed }
 */
// v1.22.1 (owner, 8 Nov: "existing users are signed out and asked to sign in as a new user; a different approach"):
// a project switched off in the Directory no longer takes Field Report access away (the person keeps what they have);
// access goes only when the person has left or their sign-in email is taken off, and only after HOLD_HOURS, shown first.
export const HOLD_HOURS = 24;
export function syncPlan({ staff = [], frPeople = [], projects = [], users = [], admins = [], managed = [], pending = {}, now = new Date().toISOString(), hold = HOLD_HOURS }) {
  const { toCode } = codeMaps(projects);
  const fr = new Map(frPeople.map(x => [low(x.email), x]));
  const adminSet = new Set(admins.map(low));
  const out = { set: [], remove: [], users: [], strays: [], kept: [], managed: [], confirm: [], waiting: [], pending: {} };
  // held removals: removed once they have waited `hold` hours; until then listed for the Admin
  const drop = (email, why) => {
    const since = pending[email]?.since || now;
    if (Date.parse(now) - Date.parse(since) >= hold * 36e5) out.remove.push(email);
    else { out.pending[email] = { since, why }; out.waiting.push({ email, since, why }); }
  };
  const want = new Map();
  for (const p of staff) {
    const email = accountOf(p);
    if (!email || left(p) || want.has(email)) continue;
    // v1.31.0: "All projects" (Admin, GM, Tier 1): every project, a new one too (this runs every 2 minutes)
    const pids = p.allProjects ? projects.map(x => x.id).filter(Boolean) : [...new Set((p.assignments || []).filter(a => a.active !== false).map(a => a.projectId))];
    want.set(email, { p, pids });
  }
  for (const [email, { p, pids }] of want) {
    const cur = fr.get(email);
    const u = users.find(x => low(x.email) === email);
    // Central Hub: the Directory's projects are added to the person's access (added only: an office person may hold more by hand)
    if (u && u.role !== 'owner' && !adminSet.has(email)) {
      const have = new Set(u.projects || []), more = pids.filter(id => !have.has(id));
      if (more.length) out.users.push({ email, projects: [...(u.projects || []), ...more] });
    }
    if (adminSet.has(email) || (cur && KEEP_ROLES.includes(cur.role))) { if (cur) out.kept.push(cur); continue; }
    const role = frRoleOf(p.title);
    if (KEEP_ROLES.includes(role)) { if (cur) out.kept.push(cur); continue; }   // a GM is set up by the Admin once, then kept
    const codes = pids.map(id => toCode.get(id)).filter(Boolean).sort();
    if (!codes.length) { if (cur) { out.kept.push(cur); if (managed.includes(email)) out.managed.push(email); } continue; }   // v1.22.1: no project now: keeps its access
    out.managed.push(email);
    if (!cur || cur.role !== role || [...(cur.projects || [])].map(up).sort().join(',') !== codes.join(',')) out.set.push({ email, role, projects: codes, name: p.name });
    // v1.14.1 (owner, 8 Nov): the name and position on every report are the Directory's, confirmed (the phone locks them);
    // before, a name typed on a shared phone ("Jojo") went on the reports of an account nobody had confirmed
    const full = String(p.name || '').trim(), pos = String(p.title || '').trim();
    if (full && (!cur || String(cur.full || '').trim() !== full || String(cur.pos || '').trim() !== pos || !cur.ok)) out.confirm.push({ email, full, pos });
  }
  for (const [email, cur] of fr) {
    if (want.has(email)) continue;
    if (!staff.length) { out.kept.push(cur); continue; }   // v1.22.1: an empty Directory read removes nobody
    if (adminSet.has(email) || KEEP_ROLES.includes(cur.role)) { out.kept.push(cur); continue; }
    if (managed.includes(email)) drop(email, want.size ? 'left, or the sign-in email was taken off in the Directory' : 'not in the Directory');   // held HOLD_HOURS (v1.22.1)
    else out.strays.push(cur);
  }
  return out;
}
