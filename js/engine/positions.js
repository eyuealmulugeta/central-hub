// The values a job position or a department is chosen from, instead of typed: the same list wherever a position is
// asked for (the employee record, the project team, putting a person on a project), so they always match.
// Roles are one fixed list in five groups. The client's billing tiers ("Crew, flat rate" and the like) are not roles:
// they are kept under Calendar and rates only. A record that holds a role outside the list keeps it, shown as old.

import { NATIONALITY } from './docread.js';

export const ROLE_GROUPS = [
  ['Management', ['General Manager', 'Project Engineer', 'Site Engineer', 'Site Architect']],
  ['Supervision', ['General Foreman', 'Steel Structure Foreman']],
  ['Technicians', ['Container House Technician', 'Technician', 'Welder', 'Mason', 'Electrician', 'Plumber']],
  ['Labour', ['Labourer']],
  ['Office', ['Office Engineer', 'Coordinator', 'Accountant']],
];
export const ROLES = ROLE_GROUPS.flatMap(([, list]) => list);

export const DEPARTMENTS = ['Management', 'Engineering', 'Site', 'Finance and accounts', 'Administration', 'Procurement and logistics', 'Sales'];

const unique = list => [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];

/** Job positions: the fixed roles, then `current` when it is not one of them. */
export const positionChoices = ({ current = '' } = {}) => unique([...ROLES, current]);

/** The roles in their groups; a `current` role outside the list comes first, as the one group "Old". */
export const positionGroups = (current = '') => {
  const old = String(current || '').trim();
  return [...(old && !ROLES.includes(old) ? [['Old', [old]]] : []), ...ROLE_GROUPS];
};

/** Nationalities: the common ones (the same words the document reader writes), then those already used, then `current`. */
export const nationalityChoices = ({ used = [], current = '' } = {}) =>
  unique([...new Set(Object.values(NATIONALITY).filter(n => n !== 'Utopian')), ...used, current]).sort((a, b) => a.localeCompare(b));

/** Departments: the fixed ones, then those already used by the staff, then `current`. */
export const departmentChoices = ({ staff = [], current = '' } = {}) =>
  unique([...DEPARTMENTS, ...staff.map(p => p.department), current]);
