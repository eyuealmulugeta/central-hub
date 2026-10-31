// v0.26.0: the recycle bin of the whole hub. Whatever the Admin deletes, on any page, goes here first: what it
// was, who deleted it, when and from which page. Only the Admin restores an item or empties the bin; an item is
// erased for good after the bin's days (90 unless the Admin changes it). The store fills it from the same
// before/after comparison that offers Undo (engine/undo.js), so no page needs its own code. Pure functions.
import { restore as putBack } from './undo.js';

export const BIN_DAYS = 90;
const DAY = 86_400_000;

/** The bin's days, as the Admin set them in Admin settings (7 to 3650). */
export const binDays = global => {
  const d = Math.round(+global?.binDays);
  return d >= 7 && d <= 3650 ? d : BIN_DAYS;
};

/** One bin entry for what a single delete took away. `place` is { scope: 'project'|'company'|'global', projectId, projectName }. */
export function binEntry(lost, place, { page = '', by = '', byName = '' } = {}, now = new Date().toISOString()) {
  return {
    id: `b${Date.parse(now).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: 'records', at: now, by, byName, page, what: lost.label,
    scope: place.scope, projectId: place.projectId || '', projectName: place.projectName || '',
    removed: structuredClone(lost.removed),
  };
}

/** A whole project in the bin: its records stay where they are, the project is only hidden until restored or erased. */
export const projectEntry = (project, who = {}, now = new Date().toISOString()) => ({
  id: `bp_${project.id}`, kind: 'project', at: now, by: who.by || '', byName: who.byName || '', page: 'Settings, This project',
  what: `Project "${project.name}"`, scope: 'project', projectId: project.id, projectName: project.name, removed: [],
});

export const binExpired = (e, days = BIN_DAYS, now = new Date().toISOString()) => Date.parse(now) >= Date.parse(e.at) + days * DAY;
export const binDaysLeft = (e, days = BIN_DAYS, now = new Date().toISOString()) => Math.max(0, Math.ceil((Date.parse(e.at) + days * DAY - Date.parse(now)) / DAY));

/** Newest first. */
export const binList = bin => [...(bin || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));

/** Put the records of an entry back into the workspace, company or global object it came from, where they were. */
export function restoreEntry(target, entry) {
  for (const r of entry.removed || []) {
    if (r.record && !Array.isArray(target[r.section])) target[r.section] = [];
    else if (!r.record && (typeof target[r.section] !== 'object' || target[r.section] === null)) target[r.section] = {};
  }
  putBack(target, { removed: entry.removed || [], edited: [] });
}

/** What the entry holds, in a few words: the first record names and how many more. */
export function holds(entry) {
  if (entry.kind === 'project') return 'The project with its reports, schedule, costs and estimate';
  const names = (entry.removed || []).map(r => r.record ? String(r.record.name || r.record.title || r.record.number || r.record.description || r.record.ref || (r.record.date ? `report of ${r.record.date}` : r.record.id)) : String(r.key));
  const more = names.length > 3 ? `, and ${names.length - 3} more` : '';
  return `${names.slice(0, 3).join(', ')}${more}`;
}
