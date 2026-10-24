// The title of a person with access: one, chosen from the same list for everybody. It is kept as the person's one
// "rank" (users/<email>.ranks = [key]) and as the readable title. The three ranks of the evaluation chain (Site
// Engineer, Project Manager, General Manager) keep their meaning there; the others rate nobody.
// Titles come in three groups. A Project Engineer (who manages the project) and a Site Engineer (who manages the site)
// are on one project at a time. The key project_manager is kept for the Project Engineer: it is the rank of the chain.

export const TITLES = [
  ['general_manager', 'General Manager', 'Management'],
  ['project_manager', 'Project Engineer', 'Management'],
  ['site_engineer', 'Site Engineer', 'Management'],
  ['technician', 'Technician', 'Site'],
  ['office_engineer', 'Office Engineer', 'Office'],
  ['coordinator', 'Coordinator', 'Office'],
  ['accountant', 'Accountant', 'Office'],
];
export const GROUPS = ['Management', 'Site', 'Office'];
/** Titles whose holder can be on only one project at a time. */
export const ONE_PROJECT = ['project_manager', 'site_engineer'];

export const titleLabel = key => TITLES.find(t => t[0] === key)?.[1] || '';

/** The key of a person's title: the first of their ranks that is one of the titles, else ''. */
export const titleOf = user => (user?.ranks || []).find(k => TITLES.some(t => t[0] === k)) || '';

/** What to save when a title is chosen: exactly one rank, and its words. An empty choice clears both. */
export const titlePatch = key => (key ? { ranks: [key], title: titleLabel(key) } : { ranks: [], title: '' });

/** May this person be put on `projectId`? A Project Engineer or Site Engineer already on another project may not. */
export function mayJoin(user, projectId, existing = null) {
  // `existing`: the ids of the projects that still exist, so a deleted project left on the person does not count
  const projects = (user?.projects || []).filter(id => !existing || existing.includes(id));
  if (projects.includes(projectId)) return { ok: true };
  if (ONE_PROJECT.includes(titleOf(user)) && projects.length >= 1) return { ok: false, reason: `A ${titleLabel(titleOf(user))} can be on one project only. Unlink ${user.name || user.email} from the other project first.` };
  return { ok: true };
}

/** May this person take `key` as their title, given the projects they are on already? */
export function mayTake(user, key, existing = null) {
  const projects = (user?.projects || []).filter(id => !existing || existing.includes(id));
  if (ONE_PROJECT.includes(key) && projects.length > 1) return { ok: false, reason: `${user.name || user.email} is on ${projects.length} projects, and a ${titleLabel(key)} can be on one only. Unlink the others first.` };
  return { ok: true };
}
