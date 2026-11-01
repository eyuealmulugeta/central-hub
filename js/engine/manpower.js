// Manpower Directory (Phase B1): the one list of everybody who works for the company, in two tables. Staff are Tiers
// 1, 2, 3 and 5 (paid monthly), crew is Tier 4 (paid by the day). The tier comes from the person's position, by the
// owner's Excel positions sheet (the Shared prompt's <tiers>). Pure functions over the staff records.

import { normRole } from './positions.js';
import { activeProjects, accountOf } from './people.js';
import { TITLES, titlePatch } from './titles.js';

const TIER_LIST = [
  [1, ['Owner', 'General Manager', 'CEO', 'Board member']],
  [2, ['Project Engineer', 'Project Coordinator', 'Coordinator', 'Chief Engineer', 'Accountant', 'HR', 'HR/Admin Assistant', 'HSE Officer']],
  [3, ['Site Engineer', 'Office Engineer', 'Architect', 'Draft person', 'Quantity Surveyor (QS)', 'QS', 'Procurement Manager', 'Procurement', 'Logistics Coordinator', 'Logistics', 'Foreman']],
  [4, ['Technician', 'Welder', 'Carpenter', 'Mason', 'Bar bender', 'Tiler', 'Plasterer', 'Painter', 'Plumber', 'Electrician', 'Skilled Labourer', 'Semi-skilled labor', 'Labourer', 'Daily labor', 'Daily labourer']],
  [5, ['Site Guard', 'Security', 'Guard']],
];
const TIER_OF = new Map(TIER_LIST.flatMap(([t, list]) => list.map(w => [w.toLowerCase(), t])));
export const TIER_WORDS = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3', 4: 'Tier 4', 5: 'Tier 5' };

/** The tier of a position, by the Excel sheet; null for a position it does not name. */
export const tierOfTitle = title => TIER_OF.get(normRole(title).toLowerCase()) ?? null;
/** Which table a person is in: crew (Tier 4) or staff (everybody else, a person with no position too). */
export const tableOf = person => (tierOfTitle(person?.title) === 4 ? 'crew' : 'staff');

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
  return (staff || []).filter(p => p.division !== 'trading' && tableOf(p) === table
    && (status === 'all' || (status === 'left' ? p.status === 'left' : p.status !== 'left'))
    && (!f.position || normRole(p.title) === f.position)
    && (!f.tier || String(tierOfTitle(p.title) ?? '') === String(f.tier))
    && (!f.project || activeProjects(p).includes(f.project))
    && (!text || [p.name, p.title, p.phone, p.email, p.accountEmail].some(v => String(v || '').toLowerCase().includes(text))))
    .sort((a, b) => (tierOfTitle(a.title) ?? 9) - (tierOfTitle(b.title) ?? 9) || String(a.name || '').localeCompare(String(b.name || '')));
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

/** v0.45.1: what a directory position sets on the person's sign-in: the matching title (its rank), else the words only. */
export function rankPatchFor(position) {
  const key = TITLES.find(t => t[1] === normRole(position))?.[0];
  return key ? titlePatch(key) : { ranks: [], title: normRole(position) };
}

/** Who added a person and when, for the directory's "Added by" column. */
export const addedStamp = (who, today) => ({ addedBy: String(who || ''), addedOn: today || '' });
