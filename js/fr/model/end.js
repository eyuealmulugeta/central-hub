// Slice 4: the end of the day. Requests and tomorrow's plan (step 8), then the checks before sending and the
// report file Central Hub imports (schema 4: the old fields it reads, plus the new ones beside them).

import { uid, num, sum, plural, pad, fnv, dayLabel } from '../core/util.js';
import { rateReport, rateLine, checkLines } from './rating.js';
import { codesOf } from '../core/names.js';
import { openPlanned } from './report.js';
import { itemLine, itemReady, workMeta } from './items.js';
import { manpowerMeta, attendanceRows, totals } from './crew.js';
import { dayMeta, photoNeedsCaption } from './day.js';

export const REQUEST_TYPES = ['Manpower', 'Material', 'Equipment', 'Tool', 'Expense', 'Other'];
// 2.29.0 (owner, Phase B1): an expense: amount in ETB or USD, the Ledger category, who was paid, a receipt photo. The PE
// approves it in Central Hub (the GM too above the limit); approved, it is a cost in the Ledger.
export const EXPENSE_COSTS = [['Material', 'material'], ['Labour', 'labor'], ['Equipment', 'equipment'], ['Subcontract', 'subcontract'], ['Transport', 'transport'], ['Overhead', 'overhead']];
export const CURRENCIES = ['ETB', 'USD'];
export const PRIORITIES = ['Normal', 'Urgent'];
export const REQUEST_UNITS = ['pcs', 'people', 'days', 'kg', 't', 'm', 'm²', 'm³', 'bags', 'lot'];

export const newRequest = (time, category = 'Material') => ({
  id: uid(), at: time, category, text: '', qty: null, unit: category === 'Manpower' ? 'people' : 'pcs', neededBy: '', priority: 'Normal', location: '',
  amount: null, currency: 'ETB', cost: 'Material', vendor: '', receipt: '',   // 2.29.0: for an expense
});
export const newPlanLine = (zone = '') => ({ id: uid(), zone, taskId: '', task: '', type: '', text: '' });

export const requestReady = q => !!String(q.text || '').trim() && (q.category !== 'Expense' || num(q.amount) > 0);
export const planReady = x => !!(String(x.text || '').trim() || x.task || x.type);

/** "2 people · needed by 22 Oct" */
export function requestLine(q) {
  if (q.category === 'Expense') return ['Expense', `${q.currency || 'ETB'} ${(num(q.amount) || 0).toLocaleString('en-US')}`, q.vendor ? `to ${q.vendor}` : '', q.receipt ? 'receipt' : ''].filter(Boolean).join(' · ');
  const amt = q.qty != null && q.qty !== '' ? `${q.qty} ${q.unit || ''}`.trim() : '';
  return [q.category, amt, q.neededBy ? `needed by ${dayLabel(q.neededBy)}` : ''].filter(Boolean).join(' · ');
}

/** "Zone C2 · Roof trusses: lift trusses 9 and 10" */
export const planLine = x => [[x.zone, x.task || x.type].filter(Boolean).join(' · '), String(x.text || '').trim()].filter(Boolean).join(': ');

/**
 * "Copy unfinished work from today": the planned activities not logged, and today's tasks that are not complete
 * (the office's figure plus today's amount still under the total). Lines already in the plan are left out.
 */
export function unfinishedWork(r, setup = {}) {
  const tasks = new Map((setup.tasks || []).map(t => [t.id, t]));
  const out = openPlanned(r).map(p => ({ zone: p.zone, taskId: p.taskId, task: p.task, type: p.type, text: p.text }));
  const seen = new Set();
  for (const i of r.items) {
    if (!i.taskId || seen.has(`${i.zone}|${i.taskId}`)) continue;
    seen.add(`${i.zone}|${i.taskId}`);
    const t = tasks.get(i.taskId);
    if (!t || !(t.total > 0) || t.unit === '%') continue;
    const today = sum(r.items.filter(x => x.taskId === i.taskId), x => num(x.qty));
    const left = t.total - (Number(t.done) || 0) - today;
    if (left > 0) out.push({ zone: i.zone, taskId: t.id, task: t.name, type: '', text: `${left} ${t.unit} left` });
  }
  const has = new Set((r.plan || []).map(x => `${x.zone}|${x.taskId || x.type || x.text}`));
  return out.filter(x => !has.has(`${x.zone}|${x.taskId || x.type || x.text}`)).map(x => ({ id: uid(), ...x }));
}

/** The line under step 8 on Today. */
export function endStatus(r) {
  const q = (r.requests || []).filter(requestReady), p = (r.plan || []).filter(planReady);
  if (!q.length && !p.length) return { state: r.done.end ? 'ok' : 'no', line: r.done.end ? 'No requests · no plan' : 'Copy unfinished work' };
  const urgent = q.filter(x => x.priority === 'Urgent').length;
  const line = [q.length ? plural(q.length, 'request') + (urgent ? ` (${urgent} urgent)` : '') : 'No requests', p.length ? `${plural(p.length, 'line')} for tomorrow` : 'no plan yet'].join(' · ');
  return { state: r.done.end ? 'ok' : 'half', count: q.length + p.length, line };
}

/**
 * What to look at before sending: [{ step, level: 'warn' | 'need', text }]. Warnings never block;
 * 'need' (name and signature) does, because the report is signed.
 */
export function checks(r, profile = {}) {
  const out = [];
  const w = (step, text) => out.push({ step, level: 'warn', text });
  if (!r.start.done) w('start', 'Start of day is not confirmed');
  if (!r.crew.done) w('crew', 'Attendance is not done');
  if (!r.items.filter(itemReady).length) w('work', 'No work done is logged');
  else if (openPlanned(r).length) w('work', `${plural(openPlanned(r).length, 'planned activity', 'planned activities')} not logged`);
  if (!r.done.equipment) w('equipment', 'Equipment is not ticked');
  if (!r.done.materials) w('materials', 'Materials received is not ticked');
  if (!r.safety.done) w('safety', 'Safety and delays is not ticked');
  if (r.safety.incident && !String(r.safety.note || '').trim()) w('safety', 'The incident has no description');
  const noParty = r.delays.filter(d => d.cause && !d.party).length;
  if (noParty) w('safety', `${plural(noParty, 'delay')} without who is responsible`);
  const caps = r.photos.filter(photoNeedsCaption).length;
  if (caps) w('photos', `${plural(caps, 'photo')} without a caption`);
  if (!r.photos.length) w('photos', 'No photos today');
  if (!(r.plan || []).filter(planReady).length) w('end', 'No plan for tomorrow');
  if (!String(profile.name || '').trim()) out.push({ step: 'me', level: 'need', text: 'Your name is missing' });
  if (!profile.sig || !r.signed) out.push({ step: 'sign', level: 'need', text: profile.sig ? 'Tap your signature below' : 'Sign the report below' });
  return out;
}

export const canSend = list => !list.some(x => x.level === 'need');

/** Zones and work types of the day, for the old "activities" field. */
const activitiesOf = r => [...new Set(r.items.filter(itemReady).map(i => i.task || i.type).filter(Boolean))];

/**
 * The report file Central Hub and the Apps Script read (schema 4). Every old field is kept;
 * items, request category, photoTags and crewFrom are added beside them.
 */
export function reportMeta(r, project, profile = {}) {
  const c = codesOf(project), s = r.start;
  const day = dayMeta(r), work = workMeta(r.items);
  const requests = (r.requests || []).filter(requestReady);
  const plan = (r.plan || []).filter(planReady);
  const meta = {
    schema: 4, app: '2.0', date: r.date, cc: c.cc, proj: c.code, pn: c.pn,
    project: project.name || '', client: project.client || '', address: project.address || '', location: s.location || '',
    reportNo: pad(r.no), day: r.no,
    activities: activitiesOf(r),
    weather: { cond: s.cond || '', tempC: num(s.tempC), ground: s.ground || '', ...(s.wind ? { note: s.wind } : {}) },
    hours: { start: s.start, end: s.end },
    delays: day.delays,
    safety: day.safety,
    manpower: manpowerMeta(r.crew, s.start, s.end),
    equipment: day.equipment,
    progress: work.progress ? work.progress.split('\n').map(x => x.replace(/^•\s*/, '')) : [],
    progressExtra: [],
    notes: String(r.notes || '').split('\n').map(x => x.trim()).filter(Boolean),
    plan: plan.map(planLine),
    planItems: plan.map(({ zone, taskId, task, type, text }) => ({ zone, taskId, task, type, text: String(text || '').trim() })),
    requests: requests.map(q => `${q.priority}: ${q.text.trim()}`),
    requestItems: requests.map(q => ({
      priority: q.priority, text: q.text.trim(), category: q.category,
      ...(num(q.qty) != null ? { qty: num(q.qty) } : {}), ...(q.unit && num(q.qty) != null ? { unit: q.unit } : {}),
      ...(q.neededBy ? { neededBy: q.neededBy } : {}), ...(q.location ? { location: q.location } : {}),
      ...(q.live ? { live: true } : {}),   // 2.14.0: already under Requests in Central Hub
      // 2.29.0: an expense (the receipt photo goes only with the shared request, too large for the report)
      ...(q.category === 'Expense' ? { amount: num(q.amount) || 0, currency: q.currency || 'ETB', cost: q.cost || 'Material', vendor: String(q.vendor || '').trim() } : {}),
    })),
    work: work.work, milestones: work.milestones, items: work.items,
    attendance: attendanceRows(r.crew), crewFrom: 'attendance',
    delayItems: day.delayItems, received: day.received,
    instructions: String(r.instructions || '').split('\n').map(x => x.trim()).filter(Boolean),
    preparedBy: String(profile.name || '').trim(), position: String(profile.position || '').trim(),
    photos: r.photos.length,
    photoTags: r.photos.map(p => ({ caption: p.caption || p.captionKind || '', time: p.at || '', zone: p.zone || '', task: (r.items.find(i => i.id === p.itemId) || {}).task || '' })),
    // 2.1.0: the photos sent to Drive with this report (the script fills in fileId)
    photoFiles: r.photos.map(p => ({ id: p.id, caption: `${p.gallery ? 'From gallery: ' : ''}${p.caption || p.captionKind || ''}`,   // 2.32.0: a GM's gallery photo says so
      time: p.at || '', zone: p.zone || '', task: (r.items.find(i => i.id === p.itemId) || {}).task || '',
      ...(p.crew ? { crew: { st: p.crew.st, tags: p.crew.tags || [], geo: p.crew.geo || null } } : {}) })),   // 2.22.0: the crew photo's tag and place, for Central Hub's attendance sheet
  };
  meta.hash = fnv(JSON.stringify(meta));
  const rt = rateReport(r);   // 2.18.0: shown in the office's notification
  meta.rating = { v: rt.v, ...Object.fromEntries(Object.entries(rt.parts).map(([k, p]) => [k, p.v])), line: rateLine(rt), checks: checkLines(rt) };   // 2.27.0
  return meta;
}

/** The figures at the top of the report and of the review page. */
export function summary(r) {
  const t = totals(r.crew, r.start.start, r.start.end);
  return {
    present: t.present, manHours: t.manHours, items: r.items.filter(itemReady).length, photos: r.photos.length,
    delayHours: sum(r.delays, d => num(d.hours)), safety: r.safety.incident ? r.safety.kind || 'Incident' : 'No incidents',
    machines: sum(r.equipment, e => e.qty),
  };
}

/** Work done grouped by zone, for the review page and the PDF: [{ zone, lines: [...] }]. */
export function byZone(items) {
  const m = new Map();
  for (const i of items.filter(itemReady)) {
    const z = i.zone || 'Site';
    if (!m.has(z)) m.set(z, []);
    const what = [i.task || i.type, i.qty != null && i.qty !== '' ? `${i.qty} ${i.unit || ''}`.trim() : ''].filter(Boolean).join(' · ');
    m.get(z).push([what, i.text.trim()].filter(Boolean).join(': ') || itemLine(i));
  }
  return [...m].map(([zone, lines]) => ({ zone, lines }));
}

/** 2.14.0: a shared request record (Central Hub) as the phone's request. */
export const fromLive = d => { const f = d.fr || {}; return { id: f.id, at: f.at || '', category: f.category || 'Material', text: f.text || '', qty: f.qty ?? null, unit: f.unit || '', neededBy: f.neededBy || '', priority: f.priority || 'Normal', location: f.location || '', live: true }; };

/** 2.14.0: today's requests as the shared drafts say: changed and new ones from other phones in, deleted ones out. */
export function mergeRequests(cur, list, date) {
  const mine = list.filter(d => d.fr && d.fr.date === date);
  const want = mine.filter(d => d.status === 'draft').map(fromLive);
  const gone = new Set(mine.filter(d => d.status === 'deleted').map(d => d.fr.id));
  return [...cur.filter(q => !gone.has(q.id)).map(q => want.find(w => w.id === q.id) || q), ...want.filter(w => !cur.some(q => q.id === w.id))];
}
