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

import { normRole, tierOfPosition } from './positions.js';
import { sum } from '../core/util.js';
import { TITLES } from './titles.js';

/** What the Admin holds without being asked. firestore.rules lets the Owner write at any level. */
export const OWNER_RANKS = ['general_manager', 'project_manager'];
/** The tier of the person being rated, kept on each team member (`level`). Tier 1 is never rated. */
export const LEVELS = [['t1', 'Tier 1 · Owners and General Manager (not rated)'], ['t2', 'Tier 2 · Project Engineer and heads'], ['t3', 'Tier 3 · Site Engineer, QS, procurement, logistics'],
  ['t4', 'Tier 4 · Technicians, foremen, skilled labour'], ['t5', 'Tier 5 · Daily labourers, site guards']];
/** The levels of before the tiers. */
const OLD_LEVELS = { project_manager: 't2', site_engineer: 't3' };

/** title key -> the rater's tier. Must match myTier() in firestore.rules. */
export const RATER_TIER = Object.fromEntries(TITLES.map(([k, , , tier]) => [k, tier]));
/** Tier n rates tier n + 1; tier 1 rates tiers 2 to 5. */
// v0.49.0: only Tiers 1, 2 and 3 evaluate (owner); Tier 3 rates the crew and Security
export const RATES = { 1: ['t2', 't3', 't4', 't5'], 2: ['t3'], 3: ['t4', 't5'] };

export const rankLabel = id => TITLES.find(([k]) => k === id)?.[1] || id;
export const levelLabel = id => LEVELS.find(([k]) => k === id)?.[1] || LEVELS[3][1];
/** The tier of a member whose tier was never chosen: by the position list (v0.47.0); anything else is tier 4. */
export const tierOfRole = role => { const t = tierOfPosition(role); return t ? `t${t}` : 't4'; };
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
  // v0.49.0: the Excel form (c1..c10, engagement) has no pillars; the overall is the average of every score
  const old = CRITERIA.some(c => c.id in scores);
  return { pillars: old ? pillars : [], overall: avg((old ? CRITERIA.map(c => scores[c.id]).filter(isScore) : Object.values(scores).filter(x => typeof x === 'number' && x >= 0 && x <= 5))) };
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

// ---- v0.49.0 (Phase B5): the owner's Excel form. 10 criteria per tier, 1 to 5; a 1 or a 5 needs a reason; one
// evaluation a person a period (3 or 6 months, the Admin's choice); the facts of the period beside the form; an
// automatic 11th score, Report engagement, for people who send daily reports. Records of this form have `form: 2`;
// the older ones (four pillars) are exported once by the Admin and then removed.
const crit = list => list.map((label, i) => ({ id: `c${i + 1}`, label }));
export const TIER_CRITERIA = {
  t2: crit(['Technical/professional knowledge required for the role', 'Planning & scheduling accuracy', 'Documentation & reporting quality', 'Communication & coordination with project teams', 'Problem-solving & decision-making', 'Compliance with company policies & procedures', 'Budget/cost control awareness', 'Timeliness & meeting deadlines', 'Teamwork & leadership', 'Initiative & continuous improvement']),
  t3: crit(['Technical drawing / design / take-off accuracy', 'Site supervision & quality control', 'Material & procurement management', 'Schedule adherence & progress tracking', 'Safety compliance & enforcement', 'Reporting accuracy & timeliness', 'Problem-solving on site/office issues', 'Coordination with contractors & suppliers', 'Resource & manpower management', 'Attention to detail & workmanship standards']),
  t4: crit(['Technical/trade skill proficiency', 'Workmanship quality', 'Speed & productivity', 'Tool & equipment handling/care', 'Safety practices & PPE compliance', 'Attendance & punctuality', 'Adherence to instructions/drawings', 'Material usage & wastage control', 'Teamwork & cooperation', 'Discipline & conduct on site']),
  t5: crit(['Punctuality & attendance', 'Vigilance & alertness', 'Access control & gate management', 'Incident reporting & documentation', 'Knowledge of security procedures/protocols', 'Physical fitness & presentation', 'Communication & conflict handling', 'Discipline & adherence to rules', 'Equipment handling (CCTV, logbook, etc.)', 'Honesty & integrity']),
};
export const ENGAGEMENT = { id: 'engagement', label: 'Report engagement (automatic, from the daily reports)' };
export const criteriaFor = level => TIER_CRITERIA[level] || TIER_CRITERIA.t4;
/** The label of a score key on a record of either form. */
export const criterionLabel = (r, k) => (k === ENGAGEMENT.id ? ENGAGEMENT.label : r?.form === 2 ? criteriaFor(r.level).find(c => c.id === k)?.label : CRITERIA.find(c => c.id === k)?.label) || k;

/** The period holding `date`: Jan–Jun and Jul–Dec (6 months), or the quarters (3). */
export function evalPeriod(date, months = 6) {
  const n = +months === 3 ? 3 : 6, y = +date.slice(0, 4), m = +date.slice(5, 7);
  const a = Math.floor((m - 1) / n) * n + 1, b = a + n - 1;
  const mm = x => String(x).padStart(2, '0');
  const name = x => new Date(Date.UTC(y, x - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return { from: `${y}-${mm(a)}-01`, to: new Date(Date.UTC(y, b, 0)).toISOString().slice(0, 10), label: `${name(a)}–${name(b)} ${y}`, months: n };
}

const samePerson = (a, b) => (a.subjectPersonId && b.subjectPersonId ? a.subjectPersonId === b.subjectPersonId : a.subjectId === b.subjectId);

/** The new form: every criterion of the tier scored, a reason for each 1 or 5, one evaluation a person a period. */
export function checkForm(e, mine, records = []) {
  const problems = [];
  if (!e.subjectId) problems.push('Choose the person being rated.');
  if (mine?.email && e.subjectEmail && e.subjectEmail.toLowerCase() === mine.email.toLowerCase()) problems.push('You cannot rate yourself.');
  const list = criteriaFor(e.level);
  const missing = list.filter(c => !isScore(e.scores?.[c.id]));
  if (missing.length) problems.push(`Score every criterion from 1 to 5. Missing: ${missing.map(c => c.label).join(', ')}.`);
  const why = list.filter(c => [1, 5].includes(e.scores?.[c.id]) && !String(e.reasons?.[c.id] || '').trim());
  if (why.length) problems.push(`A 1 or a 5 needs a written reason: ${why.map(c => c.label).join(', ')}.`);
  if (records.some(r => r.form === 2 && r.id !== e.id && r.period?.from === e.period?.from && samePerson(r, e))) problems.push(`${e.subjectName} already has an evaluation for ${e.period?.label}.`);
  return problems;
}

/** The person's last evaluation before this one (either form), for the salary flag. */
export function lastOverall(records, e) {
  const prev = records.filter(r => r.type === 'evaluation' && r.id !== e.id && samePerson(r, e)).sort((a, b) => b.date.localeCompare(a.date) || (b._o || 0) - (a._o || 0))[0];
  return prev ? averages(prev.scores).overall : null;
}
/** One point (or more) higher than the last: the General Manager reviews the salary. */
export const salaryFlag = (prev, now) => prev != null && now != null && now - prev >= 1 - 1e-9;

// ---- Report engagement: 1 point for each of five things in one daily report; days with no work are not counted ----
const hm = t => { const m = /(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const addisHm = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Addis_Ababa', hour: '2-digit', minute: '2-digit' }); };
const addisDay = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' }); };
export function engagementOf(report, start = '08:00') {
  const f = report?.field;
  if (!f || f.nowork) return null;
  const on = hm(start) ?? 480, closes = on + 15;
  const photos = f.photoFiles || [];
  const crew = photos.filter(p => /crew/i.test(p.caption || '')).map(p => hm(p.time)).filter(x => x != null);
  const marks = (f.attendance || []).map(a => hm(a.at)).filter(x => x != null);
  const hours = new Set(photos.map(p => hm(p.time)).filter(x => x != null).map(x => Math.floor(x / 60)));
  const sent = f.pressedAt || f.receivedAt;
  const parts = {
    crewPhoto: crew.some(x => x <= on),
    attendance: (f.attendance || []).length > 0 && (marks.length ? Math.min(...marks) <= closes : crew.some(x => x <= closes)),
    photoHours: hours.size >= 3,
    sentBy1730: !!sent && addisDay(sent) === report.date && hm(addisHm(sent)) <= 17 * 60 + 30,
    full: ((f.progress || []).length + (f.work || []).length) > 0 && (f.attendance || []).length > 0 && !!f.safety && photos.length > 0,
  };
  return { v: Object.values(parts).filter(Boolean).length, parts };
}
export const ENGAGE_WORDS = { crewPhoto: 'Morning crew photo on time', attendance: 'Attendance on time', photoHours: 'Photos in 3 different hours', sentBy1730: 'Sent by 17:30', full: 'No section left empty' };
const byPerson = (r, person) => [person?.name, person?.email].filter(Boolean).map(x => String(x).trim().toLowerCase()).includes(String(r.by || r.field?.preparedBy || '').trim().toLowerCase());
/** The period average of a person's reports, out of 5; null when they sent none on a work day. */
export function engagementAvg(reports, person, period, start) {
  const list = (reports || []).filter(r => r.source === 'field' && r.date >= period.from && r.date <= period.to && byPerson(r, person)).map(r => engagementOf(r, start)).filter(Boolean);
  return list.length ? { v: Math.round(list.reduce((s, x) => s + x.v, 0) / list.length * 10) / 10, reports: list.length } : null;
}

/** The facts beside the form for one person and period: attendance, reports on time, Spotlight notes. */
export function factsOf({ reports = [], spotlight = [], person, period }) {
  const name = String(person?.name || '').trim().toLowerCase();
  let present = 0, absent = 0, late = 0;
  for (const r of reports) {
    if (r.date < period.from || r.date > period.to) continue;
    for (const a of r.field?.attendance || []) {
      if (String(a.name || '').trim().toLowerCase() !== name) continue;
      if ((a.state || 'present') === 'present') present++; else if (a.state === 'absent') absent++;
      if (a.late) late++;
    }
  }
  const mine = reports.filter(r => r.source === 'field' && r.date >= period.from && r.date <= period.to && byPerson(r, person) && !r.field?.nowork);
  const onTime = mine.filter(r => engagementOf(r)?.parts.sentBy1730).length;
  const notes = spotlight.filter(s => s.kind === 'person' && s.date >= period.from && s.date <= period.to && (s.subjectPersonId && person?.personId ? s.subjectPersonId === person.personId : s.subjectId === person?.id));
  return {
    attendance: present + absent ? Math.round(present / (present + absent) * 100) : null, present, absent, late,
    reports: mine.length, onTime,
    positive: notes.filter(n => n.tone === 'positive').length, negative: notes.filter(n => n.tone === 'negative').length,
    safety: notes.filter(n => n.category === 'safety').length, notes,
  };
}

/** The old evaluations (before the Excel form) as CSV rows: the Admin's one copy before they are removed. */
export function oldRows(records) {
  const old = records.filter(r => r.form !== 2).sort((a, b) => String(a.date || a.at).localeCompare(String(b.date || b.at)));
  return [['Date', 'Type', 'Person', 'Project', 'Tier', 'Evaluator', 'Title', 'Overall or stars', 'Scores', 'Comment or notes'],
    ...old.map(r => [r.date || String(r.at || '').slice(0, 10), r.type === 'evaluation' ? 'Evaluation' : `Feedback: ${r.category || ''}`, r.subjectName, r.projectName || '', r.level || '', r.byName || r.by, rankLabel(r.byRank || ''),
      r.type === 'evaluation' ? String(averages(r.scores).overall ?? '').slice(0, 4) : r.stars, r.type === 'evaluation' ? Object.entries(r.scores || {}).map(([k, v]) => `${criterionLabel(r, k)} ${v}`).join('; ') : '', r.comment || r.notes || ''])];
}
