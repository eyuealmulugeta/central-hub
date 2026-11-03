// The values a job position or a department is chosen from, instead of typed: the same list wherever a position is
// asked for (the employee record, the project team, putting a person on a project), so they always match.
// Roles are one fixed list in five groups. The client's billing tiers ("Crew, flat rate" and the like) are not roles:
// they are kept under Calendar and rates only. A record that holds a role outside the list keeps it, shown as old.

import { NATIONALITY } from './docread.js';

// v0.47.0 (Phase B3): the owner's Excel positions sheet, by tier; Chief Engineer, HSE Officer, Welder and the labourers
// are kept with a tier (owner, 1 Nov 2026). Positions the Admin or GM adds ("+ Add a position") join their tier.
const BASE_GROUPS = [
  ['Tier 1', ['Owner', 'General Manager', 'CEO', 'Board member']],
  ['Tier 2', ['Project Engineer', 'Project Coordinator', 'Chief Engineer', 'Accountant', 'HR', 'HSE Officer']],
  ['Tier 3', ['Site Engineer', 'Office Engineer', 'Architect', 'Draft person', 'QS', 'Procurement', 'Logistics', 'Foreman']],
  ['Tier 4', ['Technician', 'Welder', 'Carpenter', 'Mason', 'Bar bender', 'Tiler', 'Plasterer', 'Painter', 'Plumber', 'Electrician', 'Skilled Labourer', 'Semi-skilled labor', 'Labourer', 'Daily labourer']],
  ['Tier 5', ['Security']],
];
let EXTRA = [];   // [{ name, tier }] from company.extraPositions
/** v0.47.0: the positions added by the Admin or GM (company.extraPositions), kept in their tiers. */
export function setExtraPositions(list) {
  const base = new Set(BASE_GROUPS.flatMap(([, l]) => l.map(x => x.toLowerCase())));
  EXTRA = (Array.isArray(list) ? list : []).filter(x => x && String(x.name || '').trim() && [1, 2, 3, 4, 5].includes(+x.tier) && !base.has(String(x.name).trim().toLowerCase()))
    .map(x => ({ name: String(x.name).trim(), tier: +x.tier }));
  ROLE_GROUPS = BASE_GROUPS.map(([g, l], i) => [g, [...l, ...EXTRA.filter(x => x.tier === i + 1).map(x => x.name)]]);
  ROLES = ROLE_GROUPS.flatMap(([, l]) => l);
}
export let ROLE_GROUPS = BASE_GROUPS;
export let ROLES = ROLE_GROUPS.flatMap(([, list]) => list);
/** v0.57.0: the site trades of the Manpower Directory (Tiers 4 and 5), the positions added there included. */
export const tradeChoices = () => ROLE_GROUPS.slice(3).flatMap(([, l]) => l);
/** v0.57.0: the positions a new person may choose on the form link (no tiers shown; Tier 1 is not hired by a link). */
export const linkTrades = () => ROLE_GROUPS.slice(1).flatMap(([, l]) => l);
/** The tier (1-5) of a position, by the list; null for a position it does not have. */
export const tierOfPosition = r => {
  const w = normRole(r).toLowerCase();
  const i = ROLE_GROUPS.findIndex(([, l]) => l.some(x => x.toLowerCase() === w));
  return i < 0 ? null : i + 1;
};
/** v0.24.0: positions merged or renamed by the owner, and the one each became. A record is read as the new one. Operations Lead is gone (shown as old). */
const OLD_ROLES = {
  'container house technician': 'Technician', 'general foreman': 'Foreman', 'steel structure foreman': 'Foreman',
  'site manager': 'Project Engineer',   // v0.57.0 (owner): the same position, not a new one
  'daily labor': 'Daily labourer', 'site architect': 'Architect',   // v0.29.0: an office position
  'semi-skilled labourer': 'Semi-skilled labor',
  'site guard': 'Security', 'procurement manager': 'Procurement', 'logistics coordinator': 'Logistics', 'quantity surveyor (qs)': 'QS', 'hr/admin assistant': 'HR', 'coordinator': 'Project Coordinator', 'site technician': 'Technician', 'welder / fitter': 'Welder',   // v0.47.0: the Excel words
};
export const normRole = r => {
  const w = String(r || '').trim(), k = w.toLowerCase();
  return OLD_ROLES[k] || ROLES.find(x => x.toLowerCase() === k) || w;   // v0.47.0: a listed position in its own spelling
};

export const DEPARTMENTS = ['Executive & General Management', 'Project Management & Site Supervision', 'Engineering & Technical Services',
  'Procurement, Supply Chain & Logistics', 'Finance, Accounting & Administration', 'Commercial, Sales & International Trade'];
/** The departments of before v0.13.0, and the one each became. A record keeps its old word until it is changed; it is read as the new one. */
const OLD_DEPARTMENTS = {
  management: DEPARTMENTS[0], site: DEPARTMENTS[1], engineering: DEPARTMENTS[2], 'procurement and logistics': DEPARTMENTS[3],
  'finance and accounts': DEPARTMENTS[4], administration: DEPARTMENTS[4], sales: DEPARTMENTS[5],
};
export const normDepartment = d => OLD_DEPARTMENTS[String(d || '').trim().toLowerCase()] || String(d || '').trim();
/**
 * v0.78.0 (owner: Employee data and the Manpower Directory agree, departments too): a person's department is the one
 * written on their record, else the one of their position.
 */
const DEPT_OF_ROLE = [[/general manager|managing director|\bgm\b|executive|\bceo\b|owner/i, 0], [/site engineer|project engineer|project manager|foreman|supervis|site|labou?r|welder|fitter|rigger|erector|mason|carpenter|electrician|plumber|painter|helper|technician|operator|driver|guard|security/i, 1],
  [/procure|logistic|store|supply|purchas/i, 3], [/financ|account|cashier|\bhr\b|admin|secretar|human/i, 4], [/sales|commercial|trade|marketing/i, 5], [/engineer|architect|\bqs\b|quantity|design|draft|surveyor/i, 2]];
export function departmentOf(p) {
  const d = normDepartment(p?.department);
  if (d) return d;
  const role = [p?.title, ...(p?.titles || [])].map(normRole).filter(Boolean)[0] || '';
  const hit = role && DEPT_OF_ROLE.find(([re]) => re.test(role));
  return hit ? DEPARTMENTS[hit[1]] : '';
}
/** Departments whose people work on site (the others are office people). */
export const SITE_DEPARTMENTS = [DEPARTMENTS[1], DEPARTMENTS[2]];

const unique = list => [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];

/** Job positions: the fixed roles, then `current` when it is not one of them. */
export const positionChoices = ({ current = '' } = {}) => unique([...ROLES, normRole(current)]);

/** The roles in their groups; a `current` role outside the list comes first, as the one group "Old". */
export const positionGroups = (current = '') => {
  const old = normRole(current);
  return [...(old && !ROLES.includes(old) ? [['Old', [old]]] : []), ...ROLE_GROUPS];
};

/** Nationalities: the common ones (the same words the document reader writes), then those already used, then `current`. */
export const nationalityChoices = ({ used = [], current = '' } = {}) =>
  unique([...new Set(Object.values(NATIONALITY).filter(n => n !== 'Utopian')), ...used, current]).sort((a, b) => a.localeCompare(b));

/** Departments: the fixed ones, then those already used by the staff, then `current`. */
export const departmentChoices = ({ staff = [], current = '' } = {}) =>
  unique([...DEPARTMENTS, ...staff.map(p => normDepartment(p.department)), normDepartment(current)]);
