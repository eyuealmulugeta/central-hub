// Crew evaluation: who may rate whom, the 1 to 5 scale, the four pillars, and the
// figures worked out from the ratings. Pure functions; the screen is ui/evaluation.js.
//
// Everybody sits in one of five tiers, and each tier rates the one directly below it:
//   Tier 1  Owners and General Manager      rate everybody; nobody rates them
//   Tier 2  Project Engineer, Operations Lead, Chief Engineer, Accountant, HSE Officer
//   Tier 3  Site Engineer, QS, Procurement Manager, Logistics Coordinator
//   Tier 4  Technicians, Foremen, HR/Admin Assistant, skilled and semi-skilled labourers
//   Tier 5  Daily labourers, site guards
// A rater's tier comes from their title (users/<email>.ranks); the tier of a team member is the one
// chosen for them (`level`, 't2' to 't5'), else the one of their job position.

import { sum } from '../core/util.js';
import { TITLES } from './titles.js';

/** What the Admin holds without being asked. firestore.rules lets the Owner write at any level. */
export const OWNER_RANKS = ['general_manager', 'project_manager'];
/** The tier of the person being rated, kept on each team member (`level`). Tier 1 is never rated. */
export const LEVELS = [['t1', 'Tier 1 · Owners and General Manager (not rated)'], ['t2', 'Tier 2 · Project Engineer and heads'], ['t3', 'Tier 3 · Site Engineer, QS, procurement, logistics'],
  ['t4', 'Tier 4 · Technicians, foremen, skilled labour'], ['t5', 'Tier 5 · Daily labourers, site guards']];
/** Job positions by tier, for a member whose tier was never chosen. Anything else is tier 4. */
const ROLE_TIERS = {
  t1: ['General Manager', 'Owner'],
  t2: ['Project Engineer', 'Project Manager', 'Operations Lead', 'Chief Engineer', 'Accountant', 'HSE Officer'],
  t3: ['Site Engineer', 'Site Architect', 'QS', 'Procurement Manager', 'Logistics Coordinator', 'Quantity Surveyor (QS)', 'Office Engineer', 'Coordinator'],
  t5: ['Daily Labourer', 'Labourer', 'Site Guard'],
};
/** The levels of before the tiers. */
const OLD_LEVELS = { project_manager: 't2', site_engineer: 't3' };

/** title key -> the rater's tier. Must match myTier() in firestore.rules. */
export const RATER_TIER = Object.fromEntries(TITLES.map(([k, , , tier]) => [k, tier]));
/** Tier n rates tier n + 1; tier 1 rates tiers 2 to 5. */
export const RATES = { 1: ['t2', 't3', 't4', 't5'], 2: ['t3'], 3: ['t4'], 4: ['t5'] };

export const rankLabel = id => TITLES.find(([k]) => k === id)?.[1] || id;
export const levelLabel = id => LEVELS.find(([k]) => k === id)?.[1] || LEVELS[3][1];
export const tierOfRole = role => {
  const r = String(role || '').trim().toLowerCase();
  const hit = Object.entries(ROLE_TIERS).find(([, list]) => list.some(x => x.toLowerCase() === r));
  return hit ? hit[0] : 't4';
};
export const levelOf = member => (LEVELS.some(([k]) => k === member?.level) ? member.level : OLD_LEVELS[member?.level] || tierOfRole(member?.role || member?.title));

/** The rater's tier: the highest of their titles' (1 is highest); 0 when none rates anybody. */
export const raterTier = ranks => Math.min(9, ...(ranks || []).map(r => RATER_TIER[r] || 9)) % 9;
/** Levels these ranks may rate. */
export const ratableLevels = ranks => RATES[raterTier(ranks)] || [];
export const canRate = (ranks, level) => ratableLevels(ranks).includes(level);
/** The title that rates `level`, for the label on a record. */
export const raterRank = (ranks, level) => (ranks || []).find(r => (RATES[RATER_TIER[r]] || []).includes(level)) || '';

export const SCALE = [
  [5, 'Exceptional', 'Consistently exceeds standards; shows leadership and mastery.'],
  [4, 'Exceeds expectations', 'Often performs above requirements; reliable and works on their own.'],
  [3, 'Meets expectations', 'Does all that the role needs, consistently.'],
  [2, 'Needs improvement', 'Inconsistent; needs supervision or guidance to reach the standard.'],
  [1, 'Unsatisfactory', 'Below the minimum; a performance plan is needed now.'],
];
export const scaleLabel = n => SCALE.find(([k]) => k === Math.round(n))?.[1] || '';

export const PILLARS = [
  { id: 'technical', name: 'Technical competence', criteria: [
    ['skill', 'Core technical skill'], ['drawings', 'Drawing and work order analysis'], ['workmanship', 'Precision and workmanship'],
    ['digital', 'Technology and digital adoption'], ['computer', 'Computer skills'] ] },
  { id: 'field', name: 'Field execution', criteria: [
    ['problems', 'Problem solving'], ['decisions', 'Decision ownership'], ['mobilization', 'Site mobilization'], ['reporting', 'Reporting quality'] ] },
  { id: 'team', name: 'Communication and teamwork', criteria: [
    ['leadership', 'Crew leadership'], ['language', 'Language proficiency'], ['interpersonal', 'Interpersonal skills'] ] },
  { id: 'conduct', name: 'Work ethic and conduct', criteria: [
    ['discipline', 'Professional discipline'], ['drive', 'Drive and motivation'], ['punctuality', 'Punctuality'], ['conduct', 'Professional conduct'] ] },
];
export const CRITERIA = PILLARS.flatMap(p => p.criteria.map(([id, label]) => ({ id, label, pillar: p.id })));

export const CATEGORIES = ['Safety achievement', 'Exceptional quality', 'Milestone completion', 'Teamwork', 'Late or absent', 'Safety breach', 'Disciplinary', 'Other'];

const isScore = n => Number.isInteger(n) && n >= 1 && n <= 5;

/**
 * Check a periodic evaluation before it is saved. Returns the problems in plain words (none = valid).
 * Every criterion must be scored 1 to 5, and nobody rates themselves.
 */
export function checkEvaluation(e, mine) {
  const problems = [];
  if (!e.subjectId) problems.push('Choose the person being rated.');
  if (mine?.email && e.subjectEmail && e.subjectEmail.toLowerCase() === mine.email.toLowerCase()) problems.push('You cannot rate yourself.');
  const missing = CRITERIA.filter(c => !isScore(e.scores?.[c.id]));
  if (missing.length) problems.push(`Score every criterion from 1 to 5. Missing: ${missing.map(c => c.label).join(', ')}.`);
  return problems;
}

/** Check a feedback note. */
export function checkFeedback(f, mine) {
  const problems = [];
  if (!f.subjectId) problems.push('Choose the person this is about.');
  if (mine?.email && f.subjectEmail && f.subjectEmail.toLowerCase() === mine.email.toLowerCase()) problems.push('You cannot write feedback about yourself.');
  if (!f.category) problems.push('Choose a category.');
  if (!isScore(f.stars)) problems.push('Give 1 to 5 stars.');
  if (!String(f.notes || '').trim()) problems.push('Write the feedback.');
  return problems;
}

const avg = list => (list.length ? sum(list, n => n) / list.length : null);

/** Average of the criteria of one pillar, and overall. */
export function averages(scores = {}) {
  const pillars = PILLARS.map(p => ({ id: p.id, name: p.name, value: avg(p.criteria.map(([k]) => scores[k]).filter(isScore)) }));
  return { pillars, overall: avg(CRITERIA.map(c => scores[c.id]).filter(isScore)) };
}

/**
 * Where one person stands: their periodic evaluations newest first, the trend against the
 * one before, the average of the stars on feedback notes, and the notes themselves.
 */
export function summarise(records, subjectId) {
  const mine = records.filter(r => r.subjectId === subjectId);
  const evals = mine.filter(r => r.type === 'evaluation').sort((a, b) => b.date.localeCompare(a.date) || (b._o || 0) - (a._o || 0));
  const notes = mine.filter(r => r.type === 'feedback').sort((a, b) => b.at.localeCompare(a.at));
  const latest = evals[0] ? averages(evals[0].scores) : null;
  const before = evals[1] ? averages(evals[1].scores).overall : null;
  return {
    evals, notes, latest,
    trend: latest && before != null ? latest.overall - before : null,
    stars: avg(notes.map(n => n.stars).filter(isScore)),
  };
}

/**
 * Everything written about one person, across every project: matched by email (work or private) or,
 * failing that, by exact name. Newest first, with the overall average of their evaluations and the
 * average stars of the feedback notes.
 */
export function ratingsOf(records, person) {
  const emails = [person?.email, person?.privateEmail].map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
  const name = String(person?.name || '').trim().toLowerCase();
  // a record written about a directory person carries their id and belongs to them alone; older ones are matched by email or name
  const mine = records.filter(r => (r.subjectPersonId ? r.subjectPersonId === person?.id
    : (emails.length && emails.includes(String(r.subjectEmail || '').trim().toLowerCase())) || (name && String(r.subjectName || '').trim().toLowerCase() === name)));
  const evals = mine.filter(r => r.type === 'evaluation').sort((a, b) => b.date.localeCompare(a.date) || (b._o || 0) - (a._o || 0));
  const notes = mine.filter(r => r.type === 'feedback').sort((a, b) => b.at.localeCompare(a.at));
  const overalls = evals.map(e => averages(e.scores).overall).filter(n => n != null);
  return {
    evals, notes,
    latest: evals[0] ? averages(evals[0].scores) : null,
    overall: avg(overalls),
    stars: avg(notes.map(n => n.stars).filter(isScore)),
  };
}
