// Deployment: which projects are live, what each one carries to site (location,
// scope, standard activities) and who may see it. A project reaches a person's
// screen only when their email is linked to it and the project is active.
// Pure functions; firestore.rules enforces the same lines (isSiteOn, officeOn).

export const STATUSES = [['active', 'Active'], ['paused', 'On hold'], ['closed', 'Completed']];
export const statusOf = p => (STATUSES.some(([k]) => k === p?.status) ? p.status : 'active');
export const statusLabel = p => STATUSES.find(([k]) => k === statusOf(p))[1];
export const isActive = p => statusOf(p) === 'active';

/** The activity types a daily report picks from, until the Admin writes the project's own list. */
export const DEFAULT_ACTIVITIES = {
  container: ['Leveling', 'Module alignment', 'Paneling', 'Flooring', 'Roofing', 'Sanitary', 'Electrical', 'Furniture assembly'],
  steel: ['Anchor bolts and foundations', 'Column erection', 'Rafter and purlin erection', 'Bracing', 'Roof sheeting', 'Wall cladding', 'Gutters and flashing', 'Welding and touch-up painting', 'Inspection and handover'],
};
export const activitiesOf = p => (Array.isArray(p?.activities) && p.activities.length ? p.activities : DEFAULT_ACTIVITIES[p?.type] || DEFAULT_ACTIVITIES.container);

/** The limits Field Report applies to what Central Hub sends. Longer text is cut, not refused, so keep inside them. */
export const LIMITS = { activity: 60, activities: 40, location: 200, scope: 1000 };

/** One activity per line: trimmed, no blanks or repeats, each at most 60 characters, at most 40 of them. */
export const cleanActivities = list => [...new Set((list || []).map(s => String(s).trim().slice(0, LIMITS.activity)).filter(Boolean))].slice(0, LIMITS.activities);
export const parseList = text => cleanActivities(String(text || '').split(/\r?\n/));
export const cleanText = (text, max) => String(text || '').trim().slice(0, max);
/** A link is kept only if it starts with http:// or https://. */
export const cleanLink = url => (/^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : '');
/** Emails are compared trimmed and lower case, exactly: no dot-stripping, so the Admin types the address as the person signs in. */
export const cleanEmail = email => String(email || '').trim().toLowerCase();

/** Everyone but the Admin sees only the projects they are assigned to (Site and Office alike); an Office person may be on several. */
export const isLimited = user => user?.role !== 'owner';
export const assignedUsers = (users, projectId) => users.filter(u => (u.projects || []).includes(projectId));

/** Which of `projects` this person may open. A Site user also needs the project to be active. */
export function visibleProjects(projects, user) {
  if (!user || user.role === 'owner') return projects;
  return projects.filter(p => (user.projects || []).includes(p.id) && (user.role !== 'site' || isActive(p)));
}
