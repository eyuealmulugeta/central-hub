// Manpower Directory (Phase B1): the one list of everybody who works for the company, in two tables. Staff are Tiers
// 1, 2, 3 and 5 (paid monthly), crew is Tier 4 (paid by the day). The tier comes from the person's position, by the
// owner's Excel positions sheet (the Shared prompt's <tiers>). Pure functions over the staff records.

import { normRole, tierOfPosition } from './positions.js';
import { activeProjects, accountOf } from './people.js';
import { TITLES, titlePatch } from './titles.js';

export const TIER_WORDS = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3', 4: 'Tier 4', 5: 'Tier 5' };

/** The tier of a position, by the Excel sheet; null for a position it does not name. */
export const tierOfTitle = title => tierOfPosition(title);
/** v0.47.0: a person's positions, the main one (title) first, each once. */
export const positionsOf = person => [...new Set([person?.title, ...(person?.titles || [])].map(normRole).filter(Boolean))];
/** v0.47.0: a person's tier: the highest (lowest number) of their positions; null when none has a tier. */
export const tierOfPerson = person => { const t = positionsOf(person).map(tierOfPosition).filter(Boolean); return t.length ? Math.min(...t) : null; };
/** Which table a person is in: crew (Tier 4) or staff (everybody else, a person with no position too). */
export const tableOf = person => (tierOfPerson(person) === 4 ? 'crew' : 'staff');
/** v0.47.0: agreements are for Tiers 1, 2, 3 and 5; Tier 4 is paid by the day with none. */
export const needsAgreement = person => tierOfPerson(person) !== 4;

/** Salary or wage as the directory shows it: the agreement's pay, else (crew) the day rate on an active project. */
export function payOf(person) {
  const a = person?.agreement || {};
  if (+a.pay > 0) return { amount: +a.pay, currency: a.currency || '', per: a.payPer || 'month' };
  const rate = (person?.assignments || []).find(x => x.active !== false && +x.dayRate > 0);
  return rate ? { amount: +rate.dayRate, currency: '', per: 'day' } : null;
}

/** The project the directory shows on a person's row: their one active project, '' for none, '*' for several. */
export function projectOfRow(person) {
  const on = activeProjects(person || {});
  return on.length > 1 ? '*' : on[0] || '';
}

/**
 * The people of one table that the filters let through, in the order of the table (tier, then name).
 * f: { search, position, tier, project, status ('active' | 'left' | 'all') }.
 */
export function directoryRows(staff, table, f = {}) {
  const text = String(f.search || '').trim().toLowerCase();
  const status = f.status || 'active';
  return (staff || []).filter(p => p.division !== 'trading' && (table === 'all' || tableOf(p) === table)   // v0.57.0: 'all' is staff and crew in one list
    && (status === 'all' || (status === 'left' ? p.status === 'left' : p.status !== 'left'))
    && (!f.position || positionsOf(p).includes(f.position))
    && (!f.tier || String(tierOfPerson(p) ?? '') === String(f.tier))
    && (!f.project || activeProjects(p).includes(f.project))
    && (!text || [p.name, ...positionsOf(p), p.phone, p.email, p.accountEmail].some(v => String(v || '').toLowerCase().includes(text))))
    .sort((a, b) => (tierOfPerson(a) ?? 9) - (tierOfPerson(b) ?? 9) || String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * Move a person to one project (or none): the assignment on `projectId` is switched on, every other one off.
 * Returns the new assignments and the projects that changed ({ on: [ids], off: [ids] }). Pure.
 */
export function moveTo(person, projectId) {
  const before = activeProjects(person);
  const list = (person.assignments || []).map(a => ({ ...a, active: a.projectId === projectId }));
  if (projectId && !list.some(a => a.projectId === projectId)) list.push({ projectId, role: person.title || '', dayRate: 0, active: true });
  return { assignments: list, on: projectId && !before.includes(projectId) ? [projectId] : [], off: before.filter(id => id !== projectId) };
}

/** v0.45.1: the directory person behind a sign-in email (their account email, else their work email); null if none. */
export function personByEmail(staff, email) {
  const m = String(email || '').trim().toLowerCase();
  if (!m) return null;
  return (staff || []).find(p => accountOf(p) === m) || (staff || []).find(p => String(p.email || '').trim().toLowerCase() === m) || null;
}

/**
 * What a person's positions set on their sign-in: the ranks of those that are titles, highest tier first (the first
 * rank sets the starting pages), and the main position's words. A string is one position. (v0.45.1, v0.47.0)
 */
export function rankPatchFor(positions) {
  const list = (Array.isArray(positions) ? positions : [positions]).map(normRole).filter(Boolean);
  const keys = list.map(w => TITLES.find(t => t[1] === w)).filter(Boolean).sort((a, b) => a[3] - b[3]).map(t => t[0]);
  if (keys.length === 1 && list.length === 1) return titlePatch(keys[0]);
  return { ranks: [...new Set(keys)], title: list[0] || '' };
}

/** Who added a person and when, for the directory's "Added by" column. */
export const addedStamp = (who, today) => ({ addedBy: String(who || ''), addedOn: today || '' });

/** v0.59.1 (owner, 2 Nov): "Added by" shows the person's name; an email kept there (older rows, Field Report adds) is
 *  read as the directory person or sign-in of that email, else left as it is. */
export function addedName(by, staff = [], users = []) {
  return String(by || '').replace(/[^\s()<>,]+@[^\s()<>,]+/g, e => {
    const low = e.toLowerCase();
    const p = (staff || []).find(x => String(x.accountEmail || x.email || '').toLowerCase() === low);
    const u = (users || []).find(x => String(x.email || '').toLowerCase() === low);
    return p?.name || u?.name || u?.signature || e;
  }).replace(/^([A-Z0-9]+_[A-Z0-9_]+) \(Field Report\)$/, 'Field Report, project $1');   // v0.78.0: before v0.78.0 only the project code was kept
}

// ---- v0.57.0 (owner, 2 Nov): the Manpower Directory is the one source of each person's position, tier and title ----

/** People whose position is kept in an old spelling (e.g. "Site manager", read as Project Engineer): the listed words. Pure. */
export function titleFixes(staff) {
  return (staff || []).flatMap(p => {
    const title = p.title ? normRole(p.title) : p.title, titles = (p.titles || []).map(normRole);
    return title !== p.title || titles.some((t, i) => t !== p.titles[i]) ? [{ id: p.id, title, titles }] : [];
  });
}

/** Sign-ins whose title or ranks differ from the person's positions in the directory: [{ email, patch }]. Pure. */
export function userSyncPatches(users, staff) {
  return (users || []).flatMap(u => {
    const p = personByEmail(staff, u.email), pos = positionsOf(p);
    if (!pos.length) return [];
    const patch = rankPatchFor(pos);
    const same = (u.title || '') === (patch.title || '') && JSON.stringify(u.ranks || []) === JSON.stringify(patch.ranks || []);
    return same ? [] : [{ email: u.email, patch }];
  });
}

/** Team members typed by name who are the one person of that name in the directory: [{ id, personId }]. Pure. */
export function sameNameLinks(team, staff) {
  const key = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const by = new Map();
  for (const p of (staff || []).filter(x => x.status !== 'left' && key(x.name))) by.set(key(p.name), [...(by.get(key(p.name)) || []), p]);
  return (team || []).flatMap(m => {
    const list = !m.personId && by.get(key(m.name));
    return list && list.length === 1 ? [{ id: m.id, personId: list[0].id }] : [];
  });
}
