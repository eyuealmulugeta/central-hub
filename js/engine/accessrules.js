// v0.29.0: the access rules. Who sees (S), who does (D) and who is told (N), for every feature of Field Report (FR)
// and Central Hub (CH). The Admin sets them under Settings, People and access, Access rules, for a whole tier, for a
// position, or for one person. The nearest one wins: person, then position, then tier, then the starting value of the
// position (the owner's decisions of 31 Oct 2026). The Admin, who is also the General Manager, has everything.
// The CH pages a person may open come out of these rules (users/<email>.pages, which firestore.rules enforces);
// the FR part goes to the script (action accessRules), which checks it on every report, approval and alert.

import { TITLES } from './titles.js';

/** [key, app, number on the access table, words, what it covers, CH pages it opens, Admin only] */
export const FEATURES = [
  ['fr_report', 'fr', 1, 'Write the daily report', 'Prepare and change the report of the day'],
  ['fr_approve', 'fr', 2, 'Approve a report', 'Approve or send back, in FR and CH, with the signature'],
  ['fr_crewphoto', 'fr', 3, 'Attendance and crew photo', 'Morning crew photo; told when it is late or missing'],
  ['fr_crew', 'fr', 4, 'Crew list', 'The site sends names and trades; wages are typed by the approver'],
  ['fr_photos', 'fr', 5, 'Report photos', 'Camera only'],
  ['fr_spot', 'fr', 6, 'Spotlight', 'Photos, videos and notes for Central Hub only'],
  ['fr_requests', 'fr', 7, 'Requests', 'Materials, manpower, equipment', ['requests']],
  ['fr_incidents', 'fr', 8, 'Delays and incidents', 'They stay in the report'],
  ['fr_hours', 'fr', 9, 'Working hours and reminder', 'Start hour, working days, the daily reminder'],
  ['fr_users', 'fr', 10, 'Sign-up, devices, FR users', 'Approve new people and phones', null, true],
  ['fr_missing', 'fr', 11, 'Missing report alerts', 'No report or no-work notice by evening'],
  ['ch_projects', 'ch', 12, 'Projects', 'Create and set up projects; others see the ones they are on', ['dashboard']],
  ['ch_delete', 'ch', 13, 'Delete', 'Anything deleted goes to the recycle bin', null, true],
  ['ch_reports', 'ch', 14, 'Daily reports in CH', 'Read, approve, send back, comment', ['reports']],
  ['ch_pdf', 'ch', 15, 'Client report PDF', 'Make and send the client PDF', null, true],
  ['ch_schedule', 'ch', 16, 'Schedule', 'Tasks, plan, progress', ['schedule']],
  ['ch_money', 'ch', 17, 'Money', 'Costs, cash flow, invoices, company finance', ['ledger', 'cashflow', 'docs', 'finance']],
  ['ch_crewpay', 'ch', 18, 'Crew pay', 'Payments of the site crew', ['payments']],
  ['ch_crew', 'ch', 19, 'Crew approval', 'Approve the crew the site sends, with their wages (moving crew between projects stays with the Admin)'],
  ['ch_hr', 'ch', 20, 'HR', 'Staff records, payroll, letters', null, true],
  ['ch_eval', 'ch', 21, 'Evaluation', 'Each rank rates the one below', ['evaluation']],
  ['ch_contracts', 'ch', 22, 'Contracts and trading', 'Agreements, shipments, stock and sales', ['contracts', 'trade']],
  ['ch_talk', 'ch', 23, 'Meetings and contacts', 'Discuss is open to everyone on a project', ['meetings', 'contacts']],
  ['ch_directory', 'ch', 23, 'Staff directory', 'Names and phone numbers of the staff', ['directory']],
].map(([key, app, no, label, about, pages = null, admin = false]) => ({ key, app, no, label, about, pages: pages || [], admin }));
export const feature = key => FEATURES.find(f => f.key === key);

/** The tiers, the same five as the evaluations. */
export const TIERS = [[1, 'Tier 1 · Owners and General Manager'], [2, 'Tier 2 · Project Engineer, Accountant, HSE'], [3, 'Tier 3 · Site Engineer, QS, office engineers'], [4, 'Tier 4 · Foremen, technicians, assistants'], [5, 'Tier 5 · Daily labour, guards']];

/** Positions: the titles, and a place for people with no title yet (by their sign-in role). */
export const POSITIONS = [...TITLES.map(([key, words, group, tier]) => ({ key, words, group, tier })),
  { key: '_office', words: 'Office, no title', group: 'Office', tier: 4 }, { key: '_site', words: 'Site, no title', group: 'Site', tier: 4 }];
export const positionOf = user => {
  const t = (user?.ranks || []).find(k => TITLES.some(x => x[0] === k));
  return t || (user?.role === 'office' ? '_office' : '_site');
};
export const tierOf = user => POSITIONS.find(p => p.key === positionOf(user))?.tier || 4;
export const positionWords = key => POSITIONS.find(p => p.key === key)?.words || key;

// The starting value of each position, from the owner's answers (31 Oct 2026). A feature left out is none.
const OFFICE = ['accountant', 'qs', 'procurement_manager', 'logistics_coordinator', 'office_engineer', 'architect', 'hr_assistant', '_office'];
const ALL_TALK = { ch_projects: 'S', ch_talk: 'D', ch_directory: 'S' };
const START = {
  general_manager: Object.fromEntries(FEATURES.filter(f => !f.admin).map(f => [f.key, 'DN'])),
  project_manager: { fr_report: 'D', fr_approve: 'DN', fr_crewphoto: 'SN', fr_crew: 'DN', fr_photos: 'D', fr_spot: 'DN', fr_requests: 'DN', fr_incidents: 'DN', fr_hours: 'DN', fr_missing: 'N',
    ch_reports: 'DN', ch_schedule: 'DN', ch_crew: 'D', ch_eval: 'D', ...ALL_TALK },
  site_engineer: { fr_report: 'D', fr_approve: 'N', fr_crewphoto: 'D', fr_crew: 'D', fr_photos: 'D', fr_spot: 'D', fr_requests: 'D', fr_incidents: 'D', fr_hours: 'S', fr_missing: 'N',
    ch_reports: 'S', ch_schedule: 'S', ch_eval: 'D', ch_projects: 'S', ch_directory: 'S' },
  coordinator: { fr_report: 'S', fr_approve: 'S', fr_photos: 'S', fr_spot: 'SN', fr_requests: 'S', fr_incidents: 'S', ch_reports: 'S', ch_schedule: 'DN', ch_eval: 'D', ...ALL_TALK },
  chief_engineer: { fr_report: 'S', fr_photos: 'S', fr_incidents: 'S', ch_reports: 'S', ch_schedule: 'S', ch_eval: 'D', ...ALL_TALK },
  hse_officer: { fr_incidents: 'SN', fr_photos: 'S', ch_reports: 'S', ch_schedule: 'S', ch_eval: 'D', ch_projects: 'S', ch_directory: 'S' },
  foreman: { ch_projects: 'S', ch_schedule: 'S', ch_eval: 'D', ch_directory: 'S' },
  technician: { ch_projects: 'S', ch_schedule: 'S', ch_eval: 'D', ch_directory: 'S' },
  _site: { fr_report: 'D', fr_requests: 'D', ch_projects: 'S', ch_reports: 'S', ch_schedule: 'S', ch_directory: 'S' },   // a Site person with no title keeps today's pages
  accountant: { fr_crewphoto: 'S', ch_money: 'DN', ch_crewpay: 'DN', ch_schedule: 'S', ch_eval: 'D', ...ALL_TALK },
  procurement_manager: { fr_requests: 'S', ch_schedule: 'S', ch_eval: 'D', ...ALL_TALK },
  logistics_coordinator: { fr_requests: 'S', ch_schedule: 'S', ch_eval: 'D', ...ALL_TALK },
};
for (const k of OFFICE) START[k] ||= { ch_schedule: 'S', ...(k === '_office' ? {} : { ch_eval: 'D' }), ...ALL_TALK };
export const startOf = (pos, feat) => (START[pos] || {})[feat] || '';

/** Flags kept in a fixed order, D bringing S with it. */
export const norm = v => { const s = String(v || ''); const d = s.includes('D'); return `${d || s.includes('S') ? 'S' : ''}${d ? 'D' : ''}${s.includes('N') ? 'N' : ''}`; };
export const blank = () => ({ v: 1, tier: {}, pos: {}, person: {}, log: [] });

/** The value of one feature for one person, and where it comes from. */
export function valueOf(rules, user, feat) {
  if (user?.role === 'owner') return { v: 'SDN', from: 'admin' };
  const f = feature(feat);
  if (!f || f.admin) return { v: '', from: 'admin only' };
  const r = rules || blank(), pos = positionOf(user), email = String(user?.email || '').toLowerCase();
  const at = [['person', r.person?.[email]], ['position', r.pos?.[pos]], ['tier', r.tier?.[tierOf(user)]]];
  for (const [from, m] of at) if (m && feat in m) return { v: norm(m[feat]), from };
  return { v: norm(startOf(pos, feat)), from: 'start' };
}
/** The value a level holds or passes on: what a person, a position or a tier gets for `feat` before anything nearer. */
export function levelValue(rules, scope, id, feat, users = []) {
  const r = rules || blank();
  const own = scope === 'person' ? r.person?.[String(id).toLowerCase()] : scope === 'pos' ? r.pos?.[id] : r.tier?.[id];
  if (own && feat in own) return { v: norm(own[feat]), from: 'set here' };
  if (scope === 'person') { const u = users.find(x => x.email === id); const x = valueOf({ ...r, person: {} }, u, feat); return { v: x.v, from: x.from }; }
  if (scope === 'pos') { const t = POSITIONS.find(p => p.key === id)?.tier; const m = r.tier?.[t]; return m && feat in m ? { v: norm(m[feat]), from: 'tier' } : { v: norm(startOf(id, feat)), from: 'start' }; }
  return { v: '', from: 'start' };   // a tier has no value of its own until it is set: each position keeps its start
}

/** The people a change at this level reaches. A person is reached only when nothing nearer to them holds the feature. */
export function reached(rules, users, scope, id, feat) {
  const r = rules || blank();
  return users.filter(u => u.role !== 'owner').filter(u => {
    const email = String(u.email || '').toLowerCase(), pos = positionOf(u);
    if (scope === 'person') return email === String(id).toLowerCase();
    if (r.person?.[email] && feat in r.person[email]) return false;
    if (scope === 'pos') return pos === id;
    if (r.pos?.[pos] && feat in r.pos[pos]) return false;
    return String(tierOf(u)) === String(id);
  });
}

/** Set one flag (S, D or N) on or off at a level. Returns the new rules; nothing is changed in place. */
export function setFlag(rules, scope, id, feat, flag, on, by = '', at = new Date().toISOString(), users = []) {
  const r = structuredClone(rules || blank());
  const box = scope === 'person' ? (r.person ||= {}) : scope === 'pos' ? (r.pos ||= {}) : (r.tier ||= {});
  const key = scope === 'person' ? String(id).toLowerCase() : String(id);
  const before = levelValue(rules, scope, id, feat, users).v;
  let v = before.replace(flag, '');
  if (on) v += flag;
  if (flag === 'S' && !on) v = v.replace('D', '');   // no doing without seeing
  if (flag === 'D' && on) v += 'S';
  v = norm(v);
  (box[key] ||= {})[feat] = v;
  r.log = [{ at, by, scope, id: key, feat, from: before, to: v }, ...(r.log || [])].slice(0, 300);
  return r;
}
/** Take a level's own value away: it follows the level above again. */
export function clearAt(rules, scope, id, feat, by = '', at = new Date().toISOString(), users = []) {
  const r = structuredClone(rules || blank());
  const box = scope === 'person' ? r.person : scope === 'pos' ? r.pos : r.tier;
  const key = scope === 'person' ? String(id).toLowerCase() : String(id);
  if (!box?.[key] || !(feat in box[key])) return r;
  const before = norm(box[key][feat]);
  delete box[key][feat];
  if (!Object.keys(box[key]).length) delete box[key];
  r.log = [{ at, by, scope, id: key, feat, from: before, to: `follows ${scope === 'person' ? 'position' : scope === 'pos' ? 'tier' : 'start'}` }, ...(r.log || [])].slice(0, 300);
  return r;
}

const WORD = { S: 'see', D: 'do', N: 'be told about' };
/** The question asked before a change is made. */
export function askText(scope, idWords, feat, flag, on, people) {
  const f = feature(feat);
  const who = scope === 'person' ? idWords : `everyone who is ${idWords}`;
  const names = people.map(u => u.name || u.email);
  return `${on ? 'Let' : 'Stop'} ${who} ${on ? '' : 'from '}${WORD[flag]}${on ? '' : 'ing'} "${f.label}"?\n\n`
    + (names.length ? `This changes the access of ${names.length} ${names.length === 1 ? 'person' : 'people'}: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ` and ${names.length - 12} more` : ''}.` : 'Nobody has this access yet; it applies to people added later.')
    + '\n\nPress OK to apply, Cancel to leave it as it is.';
}

/** The CH pages a person opens under the rules: every page of a feature they see or do. */
export function pagesFrom(rules, user) {
  return [...new Set(FEATURES.filter(f => f.pages.length && valueOf(rules, user, f.key).v.includes('S')).flatMap(f => f.pages))];
}
/** What the script gets: for each person with an email, the FR features as a short string per feature. */
export function frRules(rules, users) {
  const fr = FEATURES.filter(f => f.app === 'fr' && !f.admin).map(f => f.key).concat(['ch_crew']);
  const out = {};
  for (const u of users) if (u.email && u.role !== 'owner') out[String(u.email).toLowerCase()] = Object.fromEntries(fr.map(k => [k, valueOf(rules, u, k).v]).filter(([, v]) => v));
  return out;
}
/** May this person do (D) the feature? */
export const mayDo = (rules, user, feat) => valueOf(rules, user, feat).v.includes('D');
/** Is this person told (N) about the feature? */
export const isTold = (rules, user, feat) => valueOf(rules, user, feat).v.includes('N');

/** What changes for each person when the rules start: their pages today against the pages the rules give. */
export function startChanges(rules, users, pagesNow) {
  return users.filter(u => u.role !== 'owner').map(u => {
    const now = new Set(pagesNow(u)), next = new Set(pagesFrom(rules, u));
    return { user: u, gain: [...next].filter(p => !now.has(p)), lose: [...now].filter(p => !next.has(p)) };
  }).filter(x => x.gain.length || x.lose.length);
}
