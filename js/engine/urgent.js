// v0.72.0 (owner, 3 Nov, Phase G3): urgent notices from the GM. Sent to one person, a project's crew or everyone
// (Central Hub people and Field Report accounts). Each shows full screen until the person taps "I've read it" or sends
// a different reply; the GM sees who read and what they answered, and every notice is kept as the log.
// Record urgent/<id> = { id, text, from, fromName, at, to: { kind, pid, name }, emails: [..], names: { email: name },
// answers: { email: { kind: 'read' | 'reply', text, at, name } } }. Pure functions; the screens are ui/urgent.js.

export const URGENT_TO = [['all', 'Everyone'], ['project', "A project's crew"], ['person', 'One person']];
export const MAX_TEXT = 600;
const low = e => String(e || '').trim().toLowerCase();

/**
 * Everyone a notice can go to: Central Hub people (`users`: email, name, projects) and Field Report accounts
 * (`fieldPeople`: email, full/uName, st, role, projects as Field Report codes). The Admin and Executives of Field
 * Report are on every project. Sorted by name, without `me`.
 */
export function recipients({ users = [], fieldPeople = [], projects = [], me = '' }) {
  const byCode = new Map(projects.filter(p => p.fieldCode).map(p => [String(p.fieldCode).toUpperCase(), p.id]));
  const out = new Map();
  const add = (email, name, pids) => {
    const e = low(email);
    if (!e.includes('@') || e === low(me)) return;
    const x = out.get(e) || { email: e, name: '', pids: [] };
    x.name ||= String(name || '').trim();
    x.pids = [...new Set([...x.pids, ...pids])];
    out.set(e, x);
  };
  for (const u of users) if (!u.disabled) add(u.email, u.name, u.projects || []);
  for (const p of fieldPeople) {
    if ((p.st || 'active') !== 'active') continue;
    const pids = ['admin', 'exec'].includes(p.role) ? projects.map(x => x.id) : (p.projects || []).map(c => byCode.get(String(c).toUpperCase())).filter(Boolean);
    add(p.email, p.full || p.name || p.uName, pids);
  }
  return [...out.values()].map(x => ({ ...x, name: x.name || x.email.split('@')[0] })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The people a notice goes to. */
export function targetsOf(list, to) {
  if (to.kind === 'all') return list;
  if (to.kind === 'project') return list.filter(x => x.pids.includes(to.pid));
  return list.filter(x => x.email === low(to.email));
}

/** What is wrong with a notice before it is sent; empty when it may go. */
export function checkUrgent(text, targets) {
  const out = [];
  if (!String(text || '').trim()) out.push('Write the notice.');
  if (String(text || '').length > MAX_TEXT) out.push(`Keep it under ${MAX_TEXT} characters.`);
  if (!targets.length) out.push('Nobody to send it to.');
  return out;
}

/** The notice record. */
export function urgentRecord({ id, text, me, myName, to, targets, at }) {
  return {
    id, text: String(text).trim(), from: low(me), fromName: myName || '', at, to,
    emails: targets.map(x => x.email), names: Object.fromEntries(targets.map(x => [x.email, x.name])), answers: {},
  };
}

/** The notices `me` has not answered yet, oldest first (each pops up in turn). */
export const waitingFor = (list, me) => (list || [])
  .filter(n => (n.emails || []).includes(low(me)) && !n.answers?.[low(me)] && n.from !== low(me))
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));

/** For the GM: each person's answer, and the counts. */
export function answersOf(n) {
  const rows = (n.emails || []).map(e => ({ email: e, name: n.names?.[e] || e, ...(n.answers?.[e] || { kind: '' }) }));
  return { rows, read: rows.filter(r => r.kind === 'read').length, replied: rows.filter(r => r.kind === 'reply').length, waiting: rows.filter(r => !r.kind).length };
}
