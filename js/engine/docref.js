// Reference numbers printed on documents (v0.21.0): <company>-<project>-<type>-<period or number>,
// for example AP-CHB-ATT-2026-10 (the attendance sheet of CHB Warehouse for October 2026). Pure functions.

const initials = (text, max) => String(text || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  .map(w => (/^\d+$/.test(w) ? w : w[0])).join('').toUpperCase().slice(0, max);

/** The short code of a project: its own code, else its Field Report code, else the initials of its name. */
export const projectCode = project => String(project?.code || project?.fieldCode || initials(project?.name, 4) || 'PRJ').toUpperCase();

/** The company's short code: the initials of its name, AP for Amistad Prefab. */
export const companyCode = company => initials(company?.name, 3) || 'AP';

/** A document reference. `key` is a period (2026-10, or a date) or a number. */
export const docRef = ({ company, project, type, key }) => [companyCode(company), projectCode(project), type, String(key ?? '')].filter(Boolean).join('-');
