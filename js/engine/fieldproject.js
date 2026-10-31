// A Central Hub project as Field Report's project list holds it, so that the two never describe a project differently.
// Central Hub is the source: what is set here is what Field Report shows, on the desktop and the phone. Pure functions;
// the calls to the script are in sync/fieldreport.js.

import { iso3 } from './countries.js';
import { statusOf, activitiesOf, cleanActivities, cleanText, cleanEmail } from './deployment.js';

/** The country codes Field Report takes (three letters), for the countries of the price regions. */
export const COUNTRY3 = { ET: 'ETH', CD: 'DRC', SC: 'SYC', AE: 'UAE', IL: 'ISR', KE: 'KEN', UG: 'UGA', TZ: 'TZA', ZA: 'ZAF', EG: 'EGY', SA: 'SAU', TR: 'TUR' };
const SUBS_MAX = 12;       // Field Report keeps at most 12 activities (subs) on a project

const up = (v, n) => String(v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, n);

/**
 * The project's country code: what was typed for it; else the one Field Report already holds (the price region is a
 * guess, and Field Report files a project's reports under its country, so a held country is never overwritten by a guess);
 * else from the price region, else ''.
 */
export const countryOf = (project, regions = [], existing = null) => up(project.fieldCc, 3) || up(existing?.cc, 3) || COUNTRY3[project.regionId] || iso3(project.regionId) || '';

/**
 * What Field Report should hold for a project. `existing` is what it holds now: fields Central Hub has no say in (the
 * default working hours, the report day, the site coordinates) are kept from it, and given usual values on a new project.
 */
export function fieldProjectOf(project, { regions = [], existing = null } = {}) {
  const hold = statusOf(project) !== 'active';
  const nwDow = [0, 1, 2, 3, 4, 5, 6].filter(d => !(project.workDays || [1, 2, 3, 4, 5, 6]).includes(d));
  return {
    code: up(project.fieldCode, 6),
    cc: countryOf(project, regions, existing),
    pn: up(project.fieldPn ?? existing?.pn, 6),
    name: cleanText(project.name, 80),
    job: cleanText(project.fieldJob ?? existing?.job, 20),
    client: cleanText(project.client?.name, 80),
    address: cleanText(project.client?.address, 160),
    subs: cleanActivities(activitiesOf(project)).map(s => s.slice(0, 40)).slice(0, SUBS_MAX),
    siteName: cleanText(project.location, 80),
    siteLa: existing?.siteLa ?? null,
    siteLo: existing?.siteLo ?? null,
    defStart: existing?.defStart || '08:00',
    defEnd: existing?.defEnd || '17:00',
    nwDow,
    nonWorking: [...new Set((project.nonWorking || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(),
    hold,
    day: existing?.day || 1,
  };
}

/** What must be fixed before a project can be sent: the things Field Report refuses without. */
export function problemsOf(payload) {
  const out = [];
  if (payload.code.length < 2) out.push('a project code of 2 to 6 letters or digits');
  if (payload.cc.length !== 3) out.push('a country code of 3 letters (for example ETH)');
  if (!payload.name) out.push('a project name');
  return out;
}

const FIELDS = ['cc', 'pn', 'name', 'job', 'client', 'address', 'subs', 'siteName', 'nwDow', 'nonWorking', 'hold'];
const LABEL = { cc: 'country', pn: 'short name', name: 'name', job: 'job number', client: 'client', address: 'address', subs: 'activities', siteName: 'site', nwDow: 'weekly days off', nonWorking: 'non-working dates', hold: 'hold' };
const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].map(x => String(x).toLowerCase()).sort() : a ?? '') === JSON.stringify(Array.isArray(b) ? [...b].map(x => String(x).toLowerCase()).sort() : b ?? '');

/** The differences between what Field Report holds and what it should hold: [{ field, label, from, to }]. Empty when they match. */
export function differences(existing, desired) {
  if (!existing) return [];
  const read = (o, f) => (f === 'hold' ? !!o[f] : o[f]);   // a project with no hold mark is not on hold
  return FIELDS.filter(f => !same(read(existing, f), read(desired, f))).map(f => ({ field: f, label: LABEL[f], from: existing[f], to: desired[f] }));
}

/** A short fingerprint of what would be sent, to know when something changed since the last send. */
export function fingerprint(payloads) {
  const text = JSON.stringify(payloads.map(p => FIELDS.concat('code').map(f => p[f])));
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return String(h);
}

/** Field Report projects that Central Hub does not have: by code, among the projects that carry a code. */
export const onlyInFieldReport = (frProjects, projects) => {
  const mine = new Set(projects.map(p => up(p.fieldCode, 6)).filter(Boolean));
  return frProjects.filter(p => !mine.has(up(p.code, 6)));
};

export { cleanEmail };
