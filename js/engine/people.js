// The People directory. A person is entered once, on their HR record (Crew, Employee data). From there:
//   - an assignment puts them on a project's team (the team member is a linked copy of the person),
//   - the sign-in email gives them access, and an assignment links that email to the project,
//   - evaluations and the Field Report lists use the same person.
// A team member that came from the directory (it carries `personId`) is kept in step with the person:
// name, role, contact, day rate, whether they are on site, and the evaluation level. Someone who is not
// in the directory (a casual worker) is still a plain team member. Pure functions.

export const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normEmail = s => String(s || '').trim().toLowerCase();
export const memberId = person => `pm_${person.id}`;
export const contactOf = person => person.email || person.phone || person.privateEmail || '';
/** The email a person signs in with. */
export const accountOf = person => normEmail(person.accountEmail);

/**
 * The dates to keep on a users/<email> record when it changes: when access was given (a new record), and when the
 * person was put on each project they have just been put on. A project they leave loses its date.
 */
export function joinDates(before, patch, now) {
  const out = {};
  if (!before) out.since = now;
  if (Array.isArray(patch.projects)) {
    const had = before?.projects || [];
    const was = before?.joined || {};
    out.joined = Object.fromEntries(patch.projects.map(id => [id, had.includes(id) ? was[id] || '' : now]).filter(([, d]) => d));
  }
  return out;
}

export const assignmentOf = (person, projectId) => (person.assignments || []).find(a => a.projectId === projectId);
export const activeProjects = person => (person.assignments || []).filter(a => a.active !== false).map(a => a.projectId);

/**
 * A team member's day rate. It is kept apart from the team (section crewRates, one record per member) so that only
 * the Admin and Office people with Costs or Payments ticked read it; Site never does.
 */
export const dayRateOf = (ws, memberId) => +((ws.crewRates || []).find(r => r.id === memberId)?.dayRate) || 0;
export function setDayRate(ws, memberId, rate) {
  ws.crewRates ||= [];
  const value = Math.max(0, +rate || 0);
  const i = ws.crewRates.findIndex(r => r.id === memberId);
  if (!value) { if (i >= 0) ws.crewRates.splice(i, 1); return; }
  if (i >= 0) ws.crewRates[i] = { ...ws.crewRates[i], dayRate: value }; else ws.crewRates.push({ id: memberId, dayRate: value });
}
/**
 * Once (0.18.0): a day rate still kept on a team record moves to crewRates, and the labour cost of a crew payment
 * still in the Costs list moves to paycosts. Returns how many records changed.
 */
export function movePayOut(ws) {
  let n = 0;
  for (const m of ws.team || []) {
    if (!('dayRate' in m)) continue;
    if (+m.dayRate > 0 && !dayRateOf(ws, m.id)) setDayRate(ws, m.id, m.dayRate);
    delete m.dayRate;
    n++;
  }
  const paid = (ws.ledger || []).filter(e => e.payId);
  if (paid.length) {
    ws.paycosts ||= [];
    for (const e of paid) if (!ws.paycosts.some(x => x.id === e.id)) ws.paycosts.push(e);
    ws.ledger = ws.ledger.filter(e => !e.payId);
    n += paid.length;
  }
  return n;
}

/** The team member a person's assignment makes, keeping what the project already holds about them (ids, other fields). */
export function memberFor(person, a, existing) {
  const { dayRate, ...kept } = existing || {};   // the day rate lives in crewRates
  return {
    ...kept, id: existing?.id || memberId(person), personId: person.id,
    name: person.name || '', role: a?.role || person.title || '', contact: contactOf(person),
    active: a?.active !== false, level: person.level || 'crew',
  };
}

/** Put a person on a project's team, or bring their place there up to date, with the day rate of the assignment. Returns the team member. */
export function assign(ws, person, a) {
  const i = ws.team.findIndex(m => m.personId === person.id);
  const next = memberFor(person, a, ws.team[i]);
  if (i >= 0) ws.team[i] = next; else ws.team.push(next);
  if (a && 'dayRate' in a) setDayRate(ws, next.id, a.dayRate);
  return next;
}

/** Take a person off a project: they stay in the records but drop out of the lists (Field Report, payroll). */
export function unassign(ws, person) {
  const m = ws.team.find(x => x.personId === person.id);
  if (m) m.active = false;
}

const FIELDS = ['name', 'role', 'contact', 'active', 'level'];

/**
 * What a linked team member should read, from the directory: { id, patch } for each one that differs. With the
 * project's crewRates, a day rate that differs is in the patch as dayRate (syncTeam puts it in crewRates).
 */
export function syncPlan(team, staff, projectId, crewRates = null) {
  const out = [];
  for (const m of team) {
    if (!m.personId) continue;
    const person = staff.find(p => p.id === m.personId);
    if (!person) continue;
    const want = memberFor(person, assignmentOf(person, projectId), m);
    // a blank name in the directory never wipes the name on the project
    const patch = Object.fromEntries(FIELDS.filter(f => want[f] !== m[f] && !(f === 'name' && !want.name)).map(f => [f, want[f]]));
    const rate = +assignmentOf(person, projectId)?.dayRate || 0;
    if (crewRates && rate !== dayRateOf({ crewRates }, m.id)) patch.dayRate = rate;
    if (Object.keys(patch).length) out.push({ id: m.id, patch });
  }
  return out;
}
export const needsSync = (team, staff, projectId, crewRates = null) => syncPlan(team, staff, projectId, crewRates).length > 0;
export function syncTeam(ws, staff, projectId) {
  const plan = syncPlan(ws.team, staff, projectId, ws.crewRates || []);
  for (const { id, patch: { dayRate, ...rest } } of plan) {
    Object.assign(ws.team.find(m => m.id === id), rest);
    if (dayRate !== undefined) setDayRate(ws, id, dayRate);
  }
  return plan.length;
}

/** Team members who are not linked to the directory yet. */
export const unlinked = team => team.filter(m => !m.personId);

/**
 * Bring a project's team into the directory. Each member not linked yet is matched to a person by name or
 * email, or becomes a new person, and is linked. Returns { created, updated, linked } where created and updated
 * are staff records for the caller to save; the team members are linked in place.
 */
export function fromTeam(ws, staff, projectId, newId) {
  const created = [], updated = new Map();
  const byName = new Map(staff.map(p => [normName(p.name), p]));
  const byEmail = new Map(staff.filter(p => p.email).map(p => [normEmail(p.email), p]));
  let linked = 0;
  for (const m of unlinked(ws.team)) {
    if (!normName(m.name)) continue;
    const contact = String(m.contact || '').trim();
    const mail = (contact.match(/[^\s,;]+@[^\s,;]+/) || [''])[0];
    let person = byName.get(normName(m.name)) || (mail && byEmail.get(normEmail(mail)));
    if (!person) {
      person = {
        id: newId(), name: m.name.trim(), title: m.role || '', department: '', projectId, status: 'active', started: '', agreement: {}, documents: [], notes: '',
        email: mail, phone: mail ? '' : contact, level: m.level || 'crew', assignments: [],
      };
      created.push(person);
      byName.set(normName(person.name), person);
    }
    const target = created.includes(person) ? person : { ...person, assignments: [...(person.assignments || [])] };
    if (!assignmentOf(target, projectId)) target.assignments = [...(target.assignments || []), { projectId, role: m.role || person.title || '', dayRate: dayRateOf(ws, m.id), active: m.active !== false }];
    if (!created.includes(person)) updated.set(person.id, target);
    m.personId = person.id;
    linked++;
  }
  return { created, updated: [...updated.values()], linked };
}

/** People who may be entered twice: the same name, or the same email or phone. Each group lists who and why. */
export function duplicates(staff) {
  const groups = [];
  const seen = new Set();
  const by = (keyOf, why) => {
    const map = new Map();
    for (const p of staff) { const k = keyOf(p); if (k) map.set(k, [...(map.get(k) || []), p]); }
    for (const list of map.values()) {
      if (list.length < 2) continue;
      const key = list.map(p => p.id).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ why, people: list });
    }
  };
  by(p => normName(p.name), 'the same name');
  by(p => normEmail(p.email), 'the same email');
  by(p => String(p.phone || '').replace(/\D/g, '').slice(-9), 'the same phone');
  return groups;
}
