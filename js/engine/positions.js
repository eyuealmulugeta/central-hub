// The values a job position or a department is chosen from, instead of typed: the same list wherever a position is
// asked for (the employee record, the project team, putting a person on a project), so they always match.
// Roles are one fixed list in five groups. The client's billing tiers ("Crew, flat rate" and the like) are not roles:
// they are kept under Calendar and rates only. A record that holds a role outside the list keeps it, shown as old.

import { NATIONALITY } from './docread.js';

export const ROLE_GROUPS = [
  ['Management', ['General Manager', 'Project Engineer', 'Chief Engineer', 'Site Engineer', 'Site Architect']],
  ['Supervision', ['Foreman', 'HSE Officer']],
  ['Technicians', ['Technician', 'Welder', 'Mason', 'Electrician', 'Plumber']],
  ['Labour', ['Skilled Labourer', 'Semi-skilled labor', 'Labourer', 'Daily labor', 'Site Guard']],
  ['Office', ['Accountant', 'Quantity Surveyor (QS)', 'Procurement Manager', 'Logistics Coordinator', 'Office Engineer', 'Coordinator', 'HR/Admin Assistant']],
];
export const ROLES = ROLE_GROUPS.flatMap(([, list]) => list);
/** v0.24.0: positions merged or renamed by the owner, and the one each became. A record is read as the new one. Operations Lead is gone (shown as old). */
const OLD_ROLES = {
  'container house technician': 'Technician', 'general foreman': 'Foreman', 'steel structure foreman': 'Foreman',
  'daily labourer': 'Daily labor', 'semi-skilled labourer': 'Semi-skilled labor',
};
export const normRole = r => OLD_ROLES[String(r || '').trim().toLowerCase()] || String(r || '').trim();

export const DEPARTMENTS = ['Executive & General Management', 'Project Management & Site Supervision', 'Engineering & Technical Services',
  'Procurement, Supply Chain & Logistics', 'Finance, Accounting & Administration', 'Commercial, Sales & International Trade'];
/** The departments of before v0.13.0, and the one each became. A record keeps its old word until it is changed; it is read as the new one. */
const OLD_DEPARTMENTS = {
  management: DEPARTMENTS[0], site: DEPARTMENTS[1], engineering: DEPARTMENTS[2], 'procurement and logistics': DEPARTMENTS[3],
  'finance and accounts': DEPARTMENTS[4], administration: DEPARTMENTS[4], sales: DEPARTMENTS[5],
};
export const normDepartment = d => OLD_DEPARTMENTS[String(d || '').trim().toLowerCase()] || String(d || '').trim();
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
