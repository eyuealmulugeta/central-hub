// The values a job position or a department is chosen from, instead of typed: the same list wherever a position is
// asked for (the employee record, the project team, putting a person on a project), so they always match.
// The titles of the people with access come first, then the trades the project pays by the day, then whatever is
// already written (nothing a person has typed ever disappears from the list).

import { TITLES } from './titles.js';
import { NATIONALITY } from './docread.js';

export const DEPARTMENTS = ['Management', 'Engineering', 'Site', 'Finance and accounts', 'Administration', 'Procurement and logistics', 'Sales'];

const unique = list => [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];

/** Job positions: titles, then trades, then `extra` (what the records already hold), then `current`. */
export const positionChoices = ({ trades = [], extra = [], current = '' } = {}) =>
  unique([...TITLES.map(t => t[1]), ...trades, ...extra, current]);

/** Nationalities: the common ones (the same words the document reader writes), then those already used, then `current`. */
export const nationalityChoices = ({ used = [], current = '' } = {}) =>
  unique([...new Set(Object.values(NATIONALITY).filter(n => n !== 'Utopian')), ...used, current]).sort((a, b) => a.localeCompare(b));

/** Departments: the fixed ones, then those already used by the staff, then `current`. */
export const departmentChoices = ({ staff = [], current = '' } = {}) =>
  unique([...DEPARTMENTS, ...staff.map(p => p.department), current]);
