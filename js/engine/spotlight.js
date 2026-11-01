// Spotlight in Central Hub (v0.49.0, Phase B5c). Two kinds of note, kept in company.spotlight:
//   person:  about someone the writer may rate (one tier below; Tier 1 about anyone): positive or negative, a category,
//            the note and an optional photo. Read by the writer, HR and the Admin; never by the person. It is evidence
//            in their evaluation of the period (engine/evaluation.js factsOf).
//   project: an update or alert from anyone on the project: a topic, the note, an optional camera photo. It goes to
//            HR and the Admin in Needs attention. Never in the daily report.
// A note can be changed for 24 hours; only the Admin deletes one. Field Report's own Spotlight notes are read from
// Field Report (ui/reports.js) and shown beside these. Pure functions.

export const SPOT_CATS = [['safety', 'Safety'], ['quality', 'Quality'], ['teamwork', 'Teamwork'], ['punctuality', 'Punctuality'], ['conduct', 'Conduct'], ['other', 'Other']];
export const SPOT_TOPICS = [['project', 'The project'], ['crew', 'The crew'], ['company', 'The company'], ['client', 'The client'], ['other', 'Other']];
export const catLabel = k => SPOT_CATS.find(([x]) => x === k)?.[1] || k || '';
export const topicLabel = k => SPOT_TOPICS.find(([x]) => x === k)?.[1] || k || '';
export const EDIT_HOURS = 24;

/** What is missing before a note is saved, in plain words (none = valid). */
export function checkSpot(n) {
  const problems = [];
  if (n.kind === 'person') {
    if (!n.subjectId) problems.push('Choose who the note is about.');
    if (!['positive', 'negative'].includes(n.tone)) problems.push('Choose Positive or Negative.');
    if (!SPOT_CATS.some(([k]) => k === n.category)) problems.push('Choose a category.');
  } else if (!SPOT_TOPICS.some(([k]) => k === n.topic)) problems.push('Choose a topic.');
  if (!String(n.note || '').trim()) problems.push('Write the note.');
  return problems;
}

/** May this note still be changed by its writer? For 24 hours after it was written. */
export const editable = (n, nowMs = Date.now()) => nowMs - Date.parse(n.at) < EDIT_HOURS * 3600e3;

/** Field Report's Spotlight notes in the same shape as these (for the evaluation facts and the list). */
export const fromField = (list, projectName = '') => (list || []).map(x => ({
  id: `fr_${x.id || x.at}`, kind: /project/i.test(x.about || '') ? 'project' : 'person', from: 'Field Report',
  tone: x.tone === 'pos' ? 'positive' : 'negative', category: String(x.cat || '').toLowerCase(), topic: 'project',
  subjectName: x.about || '', note: x.note || '', at: x.at, date: String(x.at || '').slice(0, 10), byName: x.byName || x.by, projectName, media: x.media || [],
}));

/** The list, filtered: kind, person (name), project, tone, from and to (dates). Newest first. */
export function spotFilter(list, f = {}) {
  return (list || []).filter(n => (!f.kind || n.kind === f.kind) && (!f.person || n.subjectName === f.person) && (!f.project || n.projectName === f.project)
    && (!f.tone || n.tone === f.tone) && (!f.from || n.date >= f.from) && (!f.to || n.date <= f.to))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Needs attention for HR and the Admin: project updates of the last 7 days not yet marked seen. */
export function spotFlags(list, today, projectId) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  return (list || []).filter(n => n.kind === 'project' && n.projectId === projectId && n.date >= from && !n.seenAt)
    .map(n => ({ sev: /safety|accident|injur|urgent/i.test(n.note) ? 'high' : 'warn', kind: 'Spotlight', title: `Project update: ${topicLabel(n.topic)}`, detail: `${n.byName || n.by}, ${n.date}: ${String(n.note).slice(0, 120)}`, link: 'spotlight' }));
}
