// Bridge to the Amistad Field Report app. Site staff file their daily report
// there; its receiver script keeps the report data in Drive. This module pulls
// that data (action 'export', see apps-script/field-report-export.gs) and turns
// it into Central Hub daily reports waiting for the Office to confirm.

import { statusOf, activitiesOf, cleanActivities, cleanText, cleanLink, cleanEmail, LIMITS } from '../engine/deployment.js';
import { targetFor } from '../engine/calendar.js';
import { toDay, fromDay } from '../core/util.js';
import { SITE_DEPARTMENTS, normDepartment } from '../engine/positions.js';
import { fieldProjectOf, problemsOf, differences } from '../engine/fieldproject.js';
import { fixesForField, siteFixes } from '../engine/attendance.js';

const KEY = 'sf:fieldreport';
const OVERLAP_DAYS = 3;            // re-read the last few days so re-submitted reports are picked up
/** How far back "Check now" looks, for reports filed late or corrected long after their date. */
export const DEEP_OVERLAP_DAYS = 30;
const REQUEST_DUE_DAYS = 3;
/** Bump when more of the field data is kept, so reports imported earlier are refreshed on the next pull. */
export const FIELD_SCHEMA = 4;

/** Web app URL and manager key. Kept in this browser only: the key is a secret and is never written to the shared database. */
export const fieldConfig = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  set(cfg) { localStorage.setItem(KEY, JSON.stringify(cfg)); },
};

/**
 * Step 1C: signed in to the cloud, every request goes through the server function fieldAction, which holds the key
 * and checks who asks (set by main.js). Locally, and in the Admin's browser while the server cannot be reached and
 * the old key is still saved there (until 1D), the browser asks the script itself.
 */
export const fieldServer = { call: null };
/** Can this browser make Field Report requests at all? */
export const fieldReady = () => { if (fieldServer.call) return true; const c = fieldConfig.get(); return !!(c.url && c.key); };
const SERVER_DOWN = /not-found|unavailable|internal|deadline-exceeded|unauthenticated/;

/** One request to the receiver script. Network and non-JSON answers become messages a person can act on. */
async function post(body) {
  if (fieldServer.call) {
    try { return await fieldServer.call(body); }
    catch (err) {
      const code = String(err?.code || '');
      const msg = String(err?.message || err).replace(/^Firebase(Error)?:s*/, '');
      const old = fieldConfig.get();
      // refused (who may do what) is final; only a server that is missing or down falls back to a key still saved here
      if (!SERVER_DOWN.test(code) || !(old.url && old.key)) throw new Error(code.includes('permission-denied') ? msg : `The Central Hub server could not ask Field Report: ${msg}`);
      console.warn('Field Report through the server failed, asking with the key saved in this browser:', msg);
    }
  }
  const { url, key } = fieldConfig.get();
  if (!url || !key) throw new Error('Enter the Field Report web app URL and your manager key first.');
  let text;
  try {
    const res = await fetch(url, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, token: key }),
      redirect: 'follow',
    });
    text = await res.text();
  } catch {
    throw new Error('Could not reach Field Report. Check the internet connection and the web app URL.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The web app URL did not answer as Field Report. Check that the link ends in /exec and the script is deployed for "Anyone".');
  }
}

export async function fetchFieldReports({ proj, since }) {
  if (fieldReady() && !proj) throw new Error('Enter this project\'s Field Report code first (for example MJO).');
  const out = await post({ action: 'export', proj: String(proj || '').toUpperCase(), since: since || '' });
  if (!out.ok) {
    // a receiver without the export action treats the request as a PDF upload
    if (/file name|PDF/i.test(out.error || '')) throw new Error('The Field Report script has no export action yet. Add field-report-export.gs and deploy a new version.');
    throw new Error(out.error || 'The Field Report server refused the request.');
  }
  return out;
}

/**
 * Send the Office's verdict on a field report back to the person who prepared it.
 * The receiver records it, notifies the preparer's phone and shows it in their Field Report app.
 *   approve  the report is accepted and locked against further edits by the site
 *   changes  the site must correct and re-submit (text required)
 *   comment  a remark only (text required)
 *   reopen   unlock a report that was approved
 */
export async function reviewFieldReport({ name, decision, text }) {
  if (!name) throw new Error('This report has no Field Report file name yet. Click "Check now" once, then try again.');
  const out = await post({ action: 'review', name, decision, text: text || '' });
  if (!out.ok) throw new Error(out.error || 'The Field Report server refused the request.');
  return out.report;
}

/**
 * Is the server's last Field Report import (system/fieldImport, written every 2 minutes by functions/ since v0.24.1) recent
 * enough for browsers to leave the checking to it? Older than 15 minutes, the browser checks again itself.
 */
export const serverFresh = (status, now = Date.now(), minutes = 15) =>
  !!status?.lastRun && now - Date.parse(status.lastRun) < minutes * 60_000;

/** What an export holds from `since` on, in short: when it is the same as last time, nothing needs importing. */
export const fieldFingerprint = (out, since) => JSON.stringify([
  (out.reports || []).filter(m => m.date >= since).map(m => [m.date, m.version || 1, m.status || '', (m.comments || []).length]),
  (out.nowork || []).filter(n => n.date >= since).map(n => n.date),
  (out.attendance || []).map(a => [a.date, a.at]),
]);

/** Earliest date worth asking for: a few days before the newest report already imported. */
export function importSince(ws, overlapDays = OVERLAP_DAYS) {
  // reports kept in an older, thinner form are all fetched again so they can be completed
  if (ws.reports.some(r => r.source === 'field' && !r.field?.nowork && r.field?.v !== FIELD_SCHEMA)) return '';
  const last = ws.reports.filter(r => r.source === 'field').map(r => r.date).sort().at(-1);
  return last ? fromDay(toDay(last) - overlapDays) : '';
}

// Field Report logs crew as { trade, qty, hrs per person }; hours beyond the normal day are overtime.
function manpower(crew, hoursPerDay) {
  const byTrade = new Map();
  for (const c of crew || []) {
    if (!c.trade || !(c.qty > 0)) continue;
    const m = byTrade.get(c.trade) || { trade: c.trade, count: 0, ot: 0, hrs: c.hrs || 0 };
    m.count += c.qty;
    m.ot += Math.max(0, (c.hrs || 0) - hoursPerDay) * c.qty;
    byTrade.set(c.trade, m);
  }
  return [...byTrade.values()];
}

/**
 * Merge exported field data into a workspace. Safe to run repeatedly: each day
 * has one record (id fr_<date>), and an unchanged report version is skipped.
 * The task entries the Office has already confirmed are kept when the site re-submits.
 */
/**
 * One report per day. Field Report can hold two files for one date when the day number changed after the report was
 * sent (it is saved again under the new number and the old file stays). The newest counts: the later upload, then
 * the higher version. Returns { reports, replaced: [{ date, kept, dropped }] } (kept and dropped are report numbers).
 */
export function newestPerDay(reports = []) {
  const best = new Map();
  const replaced = [];
  const older = new Map();   // v0.24.0: date -> the other reports of that day, never discarded (they stay listed and openable)
  const newer = (a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')) || (a.version || 1) - (b.version || 1);
  for (const m of reports || []) {
    if (!m?.date) continue;
    const old = best.get(m.date);
    if (!old) { best.set(m.date, m); continue; }
    const [keep, drop] = newer(m, old) > 0 ? [m, old] : [old, m];
    best.set(m.date, keep);
    older.set(m.date, [...(older.get(m.date) || []), drop]);
    replaced.push({ date: m.date, kept: keep.reportNo || '', dropped: drop.reportNo || '' });
  }
  return { reports: [...best.values()], replaced, older };
}
/** What a report keeps of an older one of its day (no Drive ids: Site reads reports; those go to reportfiles). */
const olderLine = m => ({ no: m.reportNo || '', by: m.preparedBy || m.uploadedBy || '', at: m.uploadedAt || '', version: m.version || 1, pdf: m.pdf || '' });
/** The reportfiles id of an older report of the day. */
export const olderId = (id, o) => `${id}~${o.no || o.pdf}`;

/**
 * Where a report's PDF is in Drive. Kept in `reportfiles`, a section Site users never read (v0.22.6), so a site
 * engineer cannot reach the client PDF through Central Hub; older records still have the ids on the report.
 */
export const fileOf = (ws, r) => (ws.reportfiles || []).find(x => x.id === r.id)
  || { id: r.id, pdfId: r.field?.pdfId || '', folderId: r.field?.folderId || '' };

function putFile(ws, id, pdfId, folderId) {
  ws.reportfiles ||= [];
  const i = ws.reportfiles.findIndex(x => x.id === id);
  const old = i < 0 ? null : ws.reportfiles[i];
  const rec = { id, pdfId: pdfId || old?.pdfId || '', folderId: folderId || old?.folderId || '' };
  if (!rec.pdfId && !rec.folderId) return;
  if (!old) ws.reportfiles.push(rec);
  else if (old.pdfId !== rec.pdfId || old.folderId !== rec.folderId) ws.reportfiles[i] = rec;
}

/** Moves the Drive ids of older reports off the report (which Site reads) into `reportfiles`. Returns how many moved. */
export function movePdfIds(ws) {
  let n = 0;
  for (const r of ws.reports || []) {
    if (!r.field || !('pdfId' in r.field || 'folderId' in r.field)) continue;
    putFile(ws, r.id, r.field.pdfId, r.field.folderId);
    const { pdfId, folderId, ...rest } = r.field;
    r.field = rest;
    n++;
  }
  return n;
}

export function importFieldReports(ws, payload, { hoursPerDay = 8, addTrades = true } = {}) {
  let added = 0, updated = 0;
  movePdfIds(ws);
  const put = rec => {
    const i = ws.reports.findIndex(r => r.id === rec.id);
    if (i < 0) { ws.reports.push(rec); added++; } else { ws.reports[i] = { ...ws.reports[i], ...rec }; updated++; }
  };

  // a report deleted on purpose waits in the recycle bin; Field Report must not bring it back meanwhile
  const trashed = new Set((ws.trash || []).map(t => t.record?.id).filter(Boolean));

  const { reports, replaced, older } = newestPerDay(payload.reports);
  const droppedOn = new Map(replaced.map(x => [x.date, x.dropped]));
  for (const meta of reports) {
    const id = `fr_${meta.date}`;
    if (trashed.has(id)) continue;
    const old = ws.reports.find(r => r.id === id);
    const others = (older.get(meta.date) || []).map(olderLine);
    for (const o of older.get(meta.date) || []) putFile(ws, olderId(id, olderLine(o)), o.pdfId, o.folderId);
    const version = meta.version || 1;
    const sameVersion = old && !old.field?.nowork && old.field?.version === version;
    if (sameVersion && old.field.v === FIELD_SCHEMA) {
      // nothing new from the site, but a review made elsewhere may have changed its status or added comments
      const comments = meta.comments || [];
      const keepOlder = others.length ? { older: others } : {};
      if (old.field.status !== (meta.status || 'submitted') || (old.field.comments || []).length !== comments.length || JSON.stringify(old.field.older || []) !== JSON.stringify(others) || (old.field.checked?.at || '') !== (meta.checked?.at || '')) {
        // v0.27.0: "Checked by" signed in Field Report (script 7.36.0) comes with the review
        put({ id, field: { ...old.field, status: meta.status || 'submitted', comments, reviewedBy: meta.reviewedBy || '', ...(meta.checked ? { checked: meta.checked } : {}), ...keepOlder } });
      }
      putFile(ws, id, meta.pdfId, meta.folderId);
      continue;
    }
    const by = meta.preparedBy || meta.uploadedBy || 'Site';
    const crew = manpower(meta.manpower?.crew, hoursPerDay);
    put({
      id, date: meta.date, by, weather: meta.weather?.cond || '', manpower: crew,
      entries: old?.entries || [], issue: '', source: 'field',
      // a re-submitted report needs confirming again; a refresh of the same version keeps its state
      review: sameVersion ? old.review : 'pending',
      // every entry the Field Report app collects, kept as the site wrote it
      field: {
        v: FIELD_SCHEMA, no: meta.reportNo || '', version, status: meta.status || 'submitted',
        pdf: meta.pdf || '', comments: meta.comments || [], reviewedBy: meta.reviewedBy || '', ...(meta.checked ? { checked: meta.checked } : {}),
        position: meta.position || '', location: meta.location || '', activities: meta.activities || [],
        hours: meta.hours || null, tempC: meta.weather?.tempC ?? null, ground: meta.weather?.ground || '',
        delays: meta.delays || [],
        pressedAt: meta.pressedAt || '', receivedAt: meta.uploadedAt || '',   // v0.30.0: a report sent offline shows both times
        attention: Array.isArray(meta.attention) ? meta.attention.map(String).filter(Boolean) : [],   // v0.30.0: a serious issue for the client (Field Report 2.7.0)
        safety: meta.safety?.status || '', toolbox: meta.safety ? !!meta.safety.toolboxTalk : null, safetyNotes: meta.safety?.notes || [],
        equipment: meta.equipment || [],
        progress: meta.progress || [], extra: meta.progressExtra || [], notes: meta.notes || [], plan: meta.plan || [],
        requests: meta.requestItems || [], photos: meta.photos || 0,
        photoFiles: meta.photoFiles || [],   // v0.23.1: the photos in Drive (Field Report 2.1.0)
        // structured entries, sent once Field Report works from this project's lists (see buildSetup)
        work: meta.work || [], milestones: meta.milestones || [], attendance: meta.attendance || [],
        delayItems: meta.delayItems || [], received: meta.received || [], instructions: meta.instructions || [],
        // an older report of the same day that this one replaced (its number), shown on the report
        ...(droppedOn.has(meta.date) ? { replaced: droppedOn.get(meta.date) || '?' } : {}),
        ...(others.length ? { older: others } : {}),   // v0.24.0: every other report of the day, listed under this one
      },
    });
    putFile(ws, id, meta.pdfId, meta.folderId);
    // unknown trades appear under Settings with a zero rate, so their cost is visibly missing rather than silently skipped
    if (addTrades) for (const m of crew) if (!(m.trade in ws.laborRates)) ws.laborRates[m.trade] = 0;

    (meta.requestItems || []).forEach((r, i) => {
      const itemId = `${id}_${i}`;
      if (!r.text || ws.items.some(x => x.id === itemId)) return;
      const urgent = r.priority === 'Urgent';
      ws.items.push({
        id: itemId, type: 'site_request', title: urgent ? `URGENT: ${r.text}` : r.text, owner: by, created: meta.date,
        due: urgent ? meta.date : fromDay(toDay(meta.date) + REQUEST_DUE_DAYS), status: 'open', remindEvery: urgent ? 1 : 2,
      });
    });
  }

  // v0.23.2: an approval the site already knows of, or one taken back, no longer needs telling
  for (const r of ws.reports) if (r.tellSite && (r.review !== 'done' || r.field?.status !== 'submitted')) delete r.tellSite;

  for (const n of payload.nowork || []) {
    if (!n.date || ws.reports.some(r => r.id === `fr_${n.date}`) || trashed.has(`fr_${n.date}`)) continue;
    put({
      id: `fr_${n.date}`, date: n.date, by: n.byName || n.by || 'Site', weather: '', manpower: [], entries: [], issue: '',
      source: 'field', review: 'pending', field: { nowork: true, reason: n.reason || '', note: n.note || '' },
    });
  }
  // attendance the site corrected after the report (script 7.27.0); the office's corrections stay final
  const attendance = siteFixes(ws, payload.attendance);
  updated += attendance;
  return { added, updated, ...(attendance ? { attendance } : {}), ...(replaced.length ? { replaced } : {}) };
}

export const SETUP_VERSION = 1;
export const DELAY_CAUSES = ['Weather', 'Material not on site', 'Equipment', 'Manpower', 'Client instruction or approval', 'Drawings or information', 'Access to the work area', 'Other'];
export const DELAY_PARTIES = ['Client', 'Supplier', 'Weather', 'Amistad', 'Other'];
/** The owner's request types (25 Oct 2026); Field Report gets them with the next Send lists. */
export const REQUEST_CATEGORIES = ['Manpower', 'Material', 'Equipment', 'Tool', 'Other'];

/**
 * The lists Field Report needs so the site picks from them and does not type free text:
 * the open tasks with their units, the payment milestones, the crew by name, the trades
 * and the equipment seen so far. Built from the open project; sent with sendSetup.
 */
/** Titles of people who work in the office: they are left out of the site roll in Field Report. */
const OFFICE_ROLE = /\b(admin|administrator|owner|general manager|managing director|office engineer|coordinator|accountant|procurement|logistics|cashier|secretary|human resources|hr)\b/i;
/** Whether a project's team member works on site: their HR department decides; without one, their role. Pure. */
export function onSite(member, staff = []) {
  const person = member.personId ? staff.find(p => p.id === member.personId) : null;
  if (person && person.department) return SITE_DEPARTMENTS.includes(normDepartment(person.department));   // the HR department decides when there is one
  return !OFFICE_ROLE.test(String(member.role || ''));
}

export function buildSetup({ project, ws, sched, bill, people = [], company = {} }, today) {
  const site = ws.team.filter(m => onSite(m, company.staff || []));
  const triggers = new Set((bill?.stages || []).map(s => s.taskId).filter(Boolean));
  const open = sched.rows.filter(r => r.progress < 100);
  return {
    v: SETUP_VERSION, proj: String(project.fieldCode || '').toUpperCase(), project: project.name, updated: today,
    tasks: open.filter(r => !r.milestone).map(r => ({
      id: r.id, name: r.name, unit: r.qtyTotal ? r.unit || '' : '%', total: r.qtyTotal || 0, done: r.qtyTotal ? r.qtyDone : r.progress,
      // who the schedule gives the task to, so the site can see whose it is
      assigneeId: r.assigneeId || '', assignee: ws.team.find(m => m.id === r.assigneeId)?.name || '',
    })),
    // a milestone the site can report as reached; the ones that release a payment are marked
    milestones: open.filter(r => r.milestone).map(r => ({ id: r.id, name: r.name, payment: triggers.has(r.id) })),
    crew: site.map(m => ({ id: m.id, name: m.name, role: m.role || '' })),
    // the roster of this project: only people currently on it (a team member can be switched off without being deleted)
    staff: site.filter(m => m.active !== false).map(m => ({ id: m.id, name: m.name, trade: m.role || '', active: true, level: m.level || 'crew' })),
    // the calendar and the target (finish) date: start + planned working days, skipping every non-working day
    ...(({ nonWorking, nwDow, targetDate, workingDaysLeft, plannedWorkingDays }) => ({ nonWorking, nwDow, targetDate, workingDaysLeft, plannedWorkingDays }))(targetFor(project, ws, today)),
    // the people whose email the Admin linked to this project: the only ones who should see it in Field Report
    linked: linkedList(project, people),
    // the office's corrections of the Attendance sheet: Field Report shows these marks as final (from 1.61.0)
    attendanceFixes: fixesForField(ws.attendance, today),
    // trade rates are pay (hidden from some office people): the team's roles count too
    trades: [...new Set([...Object.keys(ws.laborRates || {}), ...ws.team.map(m => m.role).filter(Boolean)])],
    // what the Admin deployed for this project: where it is, what it covers, the activity types to pick from
    status: statusOf(project), location: cleanText(project.location, LIMITS.location), scope: cleanText(project.scope, LIMITS.scope),
    mapLink: cleanLink(project.mapLink), layoutLink: cleanLink(project.layoutLink), activities: cleanActivities(activitiesOf(project)),
    equipment: [...new Set(ws.reports.flatMap(r => (r.field?.equipment || []).map(e => e.name)).filter(Boolean))],
    delayCauses: DELAY_CAUSES, delayParties: DELAY_PARTIES, requestCategories: REQUEST_CATEGORIES,
  };
}

/** What Field Report holds for a project code right now (null when Central Hub has sent nothing yet). */
export async function fetchSetup(proj) {
  const out = await post({ action: 'getSetup', proj: String(proj || '').toUpperCase() });
  if (!out.ok) {
    if (/file name|PDF/i.test(out.error || '')) throw new Error('The Field Report script has no getSetup line in doPost, so it cannot hand the lists to the app. Paste the three lines and deploy a new version.');
    throw new Error(out.error || 'The Field Report server refused the request.');
  }
  return out.setup || null;
}

/** The numbers worth showing about a set of lists: what is in them. */
export const countsOf = setup => ({
  tasks: (setup?.tasks || []).length, milestones: (setup?.milestones || []).length,
  people: (setup?.staff || setup?.crew || []).length, linked: (setup?.linked || []).length,
});

/** Store the lists with the receiver, where Field Report fetches them for this project code. */
export async function sendSetup(setup) {
  if (!setup.proj) throw new Error('Enter this project\'s Field Report code first.');
  const out = await post({ action: 'setup', proj: setup.proj, setup });
  if (!out.ok) {
    if (/file name|PDF/i.test(out.error || '')) throw new Error('The Field Report script cannot take the lists yet. Paste the new export file and the two extra lines, then deploy a new version.');
    throw new Error(out.error || 'The Field Report server refused the request.');
  }
  return out;
}

/**
 * What a field report says about each task, from its structured entries:
 *   { [taskId]: { qty, pct, delayDays, note } }
 * Used to fill in the confirmation form exactly, with no guessing from text.
 */
export function reportedByTask(field, hoursPerDay = 8) {
  const out = {};
  const at = id => (out[id] ??= { qty: 0, pct: null, delayDays: 0, notes: [] });
  for (const w of field?.work || []) {
    if (!w.taskId) continue;
    const t = at(w.taskId);
    if (w.qty > 0) t.qty += +w.qty;
    if (w.pct != null && w.pct !== '') t.pct = Math.max(0, Math.min(100, Math.round(+w.pct)));
    for (const s of [w.location, w.note]) if (s) t.notes.push(String(s));
  }
  for (const m of field?.milestones || []) if (m.taskId && m.reached) { at(m.taskId).pct = 100; if (m.note) at(m.taskId).notes.push(String(m.note)); }
  for (const d of field?.delayItems || []) {
    if (!d.taskId || !(d.hours > 0)) continue;
    const t = at(d.taskId);
    // lost time is reported in hours; the schedule counts days, to the nearest half
    t.delayDays += Math.round(d.hours / hoursPerDay * 2) / 2;
    t.notes.push(`Delay: ${[d.cause, d.party && `by ${d.party}`, d.note].filter(Boolean).join(', ')}`);
  }
  for (const t of Object.values(out)) { t.note = t.notes.join('; '); delete t.notes; }
  return out;
}

const UNITS = 'pcs|pc|pieces|nos|units|sheets|panels|m2|m²|sqm|tons?|kg';
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = name => name.toLowerCase().match(/[a-z]{4,}/g) || [];

/**
 * Read installed quantities out of the site's free text, for example
 * "Installed 25 pcs roof sheeting between Axis 04 and 08" -> 25 for the roof sheeting task.
 * A line counts for a task when it contains a word that only that task's name has,
 * and the quantity is the number written in front of a unit. These are suggestions
 * the Office confirms, not final figures.
 */
export function suggestQuantities(lines, tasks) {
  const uses = new Map();
  for (const t of tasks) for (const w of new Set(words(t.name))) uses.set(w, (uses.get(w) || 0) + 1);
  const out = {};
  for (const t of tasks) {
    const own = words(t.name).filter(w => uses.get(w) === 1);
    const unit = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${t.unit ? escapeRe(t.unit.toLowerCase()) + '|' : ''}${UNITS})(?![a-z])`);
    let qty = 0;
    const from = [];
    for (const line of lines) {
      const low = String(line).toLowerCase();
      if (!own.some(w => low.includes(w))) continue;
      const m = unit.exec(low);
      if (m) { qty += parseFloat(m[1]); from.push(String(line)); }
    }
    if (qty > 0) out[t.id] = { qty, note: from.join('; ') };
  }
  return out;
}

// ---- reading Field Report's projects (one source: the script's own actions, never its config file)

/** The setup of a project whose tasks and team have not been sent yet: who and where it is, and its status. */
export const minimalSetup = (project, today) => ({
  v: SETUP_VERSION, proj: String(project.fieldCode || '').toUpperCase(), project: project.name, updated: today,
  tasks: [], milestones: [], crew: [], staff: [], trades: [], linked: [],
  status: statusOf(project), location: cleanText(project.location, LIMITS.location), scope: cleanText(project.scope, LIMITS.scope),
  mapLink: cleanLink(project.mapLink), layoutLink: cleanLink(project.layoutLink), activities: cleanActivities(activitiesOf(project)),
});

/** Field Report's list of projects, as the script's `projects` action gives it (with hasLinked, linkedCount, staffCount). */
export async function fetchProjects() {
  const out = await post({ action: 'projects' });
  if (!out.ok) {
    if (/file name|PDF/i.test(out.error || '')) throw new Error('The Field Report script has no projects action: it is older than 7.21.0. Deploy 7.21.0 or newer.');
    throw new Error(out.error || 'Field Report would not give its list of projects.');
  }
  return out.projects || [];
}

/**
 * v0.23.0 (script 7.30.0): the Field Report users, their devices and what was sent to the Admin, in one answer:
 * { people: [{ email, id, role, projects, st, full, pos, uName, uPos, ok, okBy, okAt }], catalog: [{ code, label, status }], devices, inbox }.
 */
export async function fieldUsers() {
  const out = await post({ action: 'hubFeed' });
  if (!out.ok) {
    if (/file name|PDF|Unknown action|Invalid file name/i.test(out.error || '')) throw new Error('The Field Report script is older than 7.30.0. Deploy 7.30.0 first.');
    throw new Error(out.error || 'Field Report would not give its users.');
  }
  return { people: out.people || [], catalog: out.catalog || [], devices: out.devices || [], inbox: out.inbox || [], signups: out.signups || [], crewReqs: out.crewReqs || [] };
}
/** v0.23.1: one site photo from Drive (script 7.31.0), as base64 JPEG. proj = Field Report code, report = the PDF name. */
export async function fieldPhoto(proj, report, id) {
  const out = await post({ action: 'photoGet', proj, report, id });
  if (!out.ok) throw new Error(out.error || 'Field Report would not give the photo.');
  return out.data;
}

/**
 * One change to a Field Report user: userSet { email, full, pos, ok, st }, accessSet { email, role, projects }, accessRemove { email },
 * devDecide { email, device, decision } or (script 7.35.0) signupDecide { email, decision, by }, which emails the person the result.
 */
export async function fieldUserDo(action, body) {
  if (!['userSet', 'accessSet', 'accessRemove', 'devDecide', 'signupDecide', 'crewDecide', 'accessRules'].includes(action)) throw new Error('Unknown change.');   // crewDecide: script 7.37.0; accessRules: 7.38.0
  const out = await post({ action, ...body });
  if (!out.ok) throw new Error(out.error || 'Field Report refused the change.');
  return out;
}

/** v0.30.0: the Spotlight notes of one project from the site (script 7.39.0, spotList), newest first. */
export async function fieldSpotlight(code) {
  const out = await post({ action: 'spotList', proj: String(code || '').toUpperCase() });
  if (!out.ok) throw new Error(/file name|PDF/i.test(out.error || '') ? 'The Field Report script is older than 7.39.0: deploy the new script first.' : out.error || 'Field Report would not say.');
  return out.notes || [];
}

/** Why an email can or cannot see each project (the script's linkCheck, admin key): [{ code, name, status, hasLinked, inLinked, visible, why }]. */
export async function linkCheck(email) {
  const out = await post({ action: 'linkCheck', email: cleanEmail(email) });
  if (!out.ok) {
    if (/file name|PDF/i.test(out.error || '')) throw new Error('The Field Report script has no linkCheck action: it is older than 7.22.0.');
    throw new Error(out.error || 'Field Report would not say.');
  }
  return out.projects || [];
}

/**
 * One row of Field Report's linkCheck, said plainly: { tone: 'ok' | 'warn' | 'bad' | '', text }.
 * Seeing a project without being in its linked list is the odd case: a project whose linked list is empty is shown to
 * everyone, which is how a person comes to see projects that are not theirs.
 */
export function explainLink(row) {
  if (row.visible && row.inLinked) return { tone: 'ok', text: row.why || 'Linked and active.' };
  if (row.visible) return { tone: 'warn', text: `${row.why && row.hasLinked ? `${row.why} ` : ''}This email is not in the project's linked list, yet it can see the project${row.hasLinked ? '' : ': the linked list is empty, so Field Report shows it to everyone. Link the people who work on it and press "Send lists to Field Report" on that project, and it disappears for the others'}.` };
  return { tone: '', text: row.why || 'Cannot see it.' };
}

/** The people linked to a project, as Field Report's setup holds them: the only thing that lets a person see the project there. */
export const linkedList = (project, people = []) => people
  .filter(u => (u.projects || []).includes(project.id))
  .map(u => ({ email: cleanEmail(u.email), name: u.name || '', title: u.title || '', role: u.role === 'office' ? 'office' : 'site', ranks: u.ranks || [] }));

// ---- checking the whole connection

/** Run one request and keep the answer or the reason it failed, so one broken step does not hide the others. */
const attempt = async run => { try { return { value: await run() }; } catch (err) { return { error: err.message || String(err) }; } };

/** Ask Field Report everything the link depends on. `since` is today's date: only a test of reading, nothing is imported. */
export async function probeConnection({ code, since, emails = [] }) {
  const [ping, projects, exported, setup, ...links] = await Promise.all([
    attempt(() => post({ action: 'ping' })),
    attempt(() => fetchProjects()),
    attempt(() => fetchFieldReports({ proj: code, since })),
    attempt(() => fetchSetup(code)),
    ...emails.slice(0, 10).map(email => attempt(() => linkCheck(email)).then(r => ({ email, ...r }))),
  ]);
  return { ping, projects, exported, setup, links };
}

/**
 * Turn the answers into a checklist a person can act on. Each line is { ok: true | false | 'warn', label, detail }.
 * `linked` are the Central Hub people linked to the project ({ email, name }), `plan` the counts Central Hub would send.
 */
export function judgeConnection({ code, linked = [], plan = {} }, probe) {
  const lines = [];
  const add = (ok, label, detail = '') => lines.push({ ok, label, detail });
  const { ping, projects, exported, setup, links = [] } = probe;

  if (ping.error || !ping.value?.ok) {
    add(false, 'Field Report answers', ping.error || ping.value?.error || 'It did not answer as Field Report.');
    return lines;   // nothing else can be asked
  }
  const p = ping.value;
  add(true, 'Field Report answers', `${p.folder ? `Folder "${p.folder}". ` : ''}Version ${p.build || '?'}, signed in as ${p.who || 'this key'}.`);
  add(p.role === 'admin', `The key is an admin key (it is "${p.role || 'unknown'}")`,
    p.role === 'admin' ? 'Needed to send the lists and to create projects.' : 'Only an admin key may send the lists and create projects. Use the admin\'s manager key.');

  const wanted = String(code || '').toUpperCase();
  const there = (projects.value || []).find(x => String(x.code || '').toUpperCase() === wanted);
  if (projects.error) add(false, 'Project list of Field Report', projects.error);
  else if (!there) add(false, `Project ${wanted || '(no code)'} is in Field Report`, `Field Report holds: ${(projects.value || []).map(x => x.code).filter(Boolean).join(', ') || 'no project yet'}. Open the All projects tab and press "Sync all projects now": it creates the project in Field Report.`);
  else add(true, `Project ${wanted} is in Field Report`, `Named "${there.name || there.code}". ${there.linkedCount != null ? `${there.linkedCount} linked, ${there.staffCount ?? 0} staff.` : ''}`);

  // a project is on hold only when Central Hub saved the status paused or closed (or set the hold flag): "active" is active everywhere
  const status = setup.value?.status;
  if (setup.value && !status) add('warn', 'The project has a status in Field Report', 'No status is saved with its lists, so Field Report decides for itself and may treat it as on hold. Press "Send lists to Field Report": it saves the status.');
  else if (['paused', 'closed'].includes(status) || !!there?.hold) add('warn', 'The project is on hold in Field Report', `Central Hub saved it as ${status === 'closed' ? 'Completed' : 'On hold'}${there?.hold && !['paused', 'closed'].includes(status) ? ' (the hold flag is set)' : ''}, so it takes no new reports from the site. To open it, set it Active in Settings, This project, Site and deployment, then sync and send the lists.`);

  if (there && there.hasLinked === false) add(false, 'People are linked to the project in Field Report', 'Its linked list is empty, so nobody sees it. Press "Send lists to Field Report": the people linked here are put in its linked list.');
  for (const l of links) {
    const person = linked.find(u => u.email === l.email) || { email: l.email };
    const who = person.name || l.email;
    if (l.error) { add('warn', `Can ${who} see ${wanted}?`, l.error); continue; }
    const row = (l.value || []).find(x => String(x.code || '').toUpperCase() === wanted);
    if (!row) add(false, `${who} can see ${wanted}`, `Field Report does not list ${wanted} for this email at all.`);
    else add(!!row.visible, `${who} ${row.visible ? 'can' : 'cannot'} see ${wanted}`, row.why || '');
  }

  if (exported.error) add(false, 'Reading reports works', exported.error);
  else add(true, 'Reading reports works', `Code ${exported.value.proj} is "${exported.value.project}".`);

  const stored = setup.value;
  if (setup.error) add(false, 'Field Report holds the lists', setup.error);
  else if (!stored) add(false, 'Field Report holds the lists', 'It holds nothing for this project. Press "Send lists to Field Report".');
  else {
    const now = countsOf(stored);
    const same = ['tasks', 'milestones', 'people', 'linked'].every(k => now[k] === plan[k]);
    const line = `${now.tasks} tasks, ${now.milestones} milestones, ${now.people} people, ${now.linked} linked.`;
    if (!now.tasks) add(false, 'Field Report holds the lists', `${line} There are no tasks, so the site has nothing to report against.`);
    else add(same ? true : 'warn', 'Field Report holds the lists', same ? line : `${line} Central Hub now has ${plan.tasks} tasks, ${plan.milestones} milestones, ${plan.people} people, ${plan.linked} linked: send the lists again.`);
  }
  return lines;
}

// ---- keeping Field Report's project list the same as Central Hub's

const FORMAT_KEY = 'sf:fieldreport-put-format';
const PUT_FORMATS = [
  project => ({ action: 'projectPut', project }),
  project => ({ action: 'projectPut', ...project }),
];

/**
 * Create or change one project in Field Report (the script's projectPut: the same code edits it). The script's exact
 * request shape is not written down here, so the likely shapes are tried in turn: only a refusal about the request's
 * shape moves on to the next, any other answer is final. The shape that worked is remembered in this browser.
 */
export async function putProject(project) {
  const remembered = (() => { try { return localStorage.getItem(FORMAT_KEY); } catch { return null; } })();
  const order = [...PUT_FORMATS.keys()].sort((a, b) => (String(a) === remembered ? -1 : String(b) === remembered ? 1 : a - b));
  let last = '';
  for (const i of order) {
    const out = await post(PUT_FORMATS[i](project));
    if (out.ok) { try { localStorage.setItem(FORMAT_KEY, String(i)); } catch { /* not remembered */ } return out; }
    last = out.error || 'Field Report refused the project.';
    if (/file name|PDF/i.test(last)) throw new Error('The Field Report script does not know projectPut: it is older than 7.21.0. Deploy 7.21.0 or newer.');
    // a refusal about the project's own content (a wrong country code, a duplicate) is final; one about a missing project or code means the shape was wrong
    if (!/missing|required|no project|project is|unknown project|invalid project|expected/i.test(last)) throw new Error(last);
  }
  throw new Error(`Field Report refused the project: ${last}`);
}

/** Remove a project from Field Report's shared list. Drive folders and reports stay; the last project cannot be removed. */
export async function removeProject(code) {
  const out = await post({ action: 'projectDelete', code: String(code || '').toUpperCase() });
  if (!out.ok) {
    if (/file name|PDF/i.test(out.error || '')) throw new Error('The Field Report script does not know projectDelete: it is older than 7.21.0.');
    throw new Error(out.error || 'Field Report refused to remove the project.');
  }
  return out;
}

const emailSet = list => [...new Set((list || []).map(l => cleanEmail(l?.email ?? l)).filter(Boolean))].sort();

/**
 * Make Field Report's project list agree with Central Hub's, project by project: create what is missing, change what
 * differs, put the linked people in each project's linked list, leave what is the same. Linking is only ever done through
 * the linked list of a project's setup: that is the only thing that lets a person see a project in Field Report. A
 * project's other lists (tasks, milestones, crew) are kept as they are; they are sent from the project's own page.
 * Projects Field Report has and Central Hub does not are reported, never removed here.
 * With `dry` nothing is sent: the rows say what would be created ('create') or changed ('update').
 * @returns {{ rows: { id, name, code, action: 'create'|'update'|'created'|'updated'|'same'|'nocode'|'skipped'|'failed', note?: string, changes?: object[], linkedCount?: number }[], extra: object[] }}
 */
export async function syncProjects({ projects, users = [], regions = [], dry = false, today = new Date().toISOString().slice(0, 10) }) {
  const held = await fetchProjects();
  const rows = [];
  for (const p of projects) {
    const row = { id: p.id, name: p.name, code: String(p.fieldCode || '').toUpperCase() };
    if (!row.code) { rows.push({ ...row, action: 'nocode', note: 'Not in Field Report: it has no Field Report code. Type one on its Field Report tab when it should be.' }); continue; }
    const existing = held.find(x => String(x.code || '').toUpperCase() === row.code) || null;
    const payload = fieldProjectOf(p, { regions, existing });
    const problems = problemsOf(payload);
    if (problems.length) { rows.push({ ...row, action: 'skipped', note: `Needs ${problems.join(' and ')} first.` }); continue; }
    const changes = differences(existing, payload);
    // who is linked there now, from the project's setup; a project with no setup yet is linked when its lists are first sent
    const want = linkedList(p, users);
    const have = existing ? await attempt(() => fetchSetup(row.code)) : { value: null };
    // if its lists could not be read, nothing is sent for it: writing blind could replace the tasks Field Report holds
    if (have.error) { rows.push({ ...row, action: 'failed', note: `Its lists could not be read, so nothing was changed: ${have.error}` }); continue; }
    const setupNow = have.value;
    const status = statusOf(p);
    // every project's setup carries an explicit status and its linked people: Field Report holds a project on hold only on the status saved here
    const linkedChanged = !setupNow || JSON.stringify(emailSet(setupNow.linked)) !== JSON.stringify(emailSet(want));
    const statusChanged = !setupNow || setupNow.status !== status;
    if (linkedChanged) changes.push({ field: 'linked', label: 'who sees it' });
    if (statusChanged) changes.push({ field: 'status', label: 'status' });
    const note = !setupNow ? 'Its tasks and team are sent from its own page (step 2): until then Field Report holds only its status and who sees it.' : '';
    const unchanged = existing && !changes.length;
    if (unchanged) { rows.push({ ...row, action: 'same', note, linkedCount: existing.linkedCount, heldCc: existing.cc, source: existing.source }); continue; }
    if (dry) { rows.push({ ...row, action: existing ? 'update' : 'create', changes, note, linkedCount: existing?.linkedCount, heldCc: existing?.cc, source: existing?.source }); continue; }
    try {
      let put = null;
      if (!existing || changes.some(c => c.field !== 'linked' && c.field !== 'status')) put = await putProject(payload);
      if (linkedChanged || statusChanged) await sendSetup({ ...(setupNow || minimalSetup(p, today)), status, linked: want });
      // MJO, MOS and BAG are built into the script: the first projectPut with the project's own country adopts it
      const adopted = put?.project?.adopted ? 'Taken over from the script\'s built-in list: Central Hub now manages it.' : '';
      rows.push({ ...row, action: existing ? 'updated' : 'created', changes, note: [adopted, note].filter(Boolean).join(' '), source: existing?.source, heldCc: existing?.cc });
    } catch (err) {
      // a code Field Report calls used while its list shows no such project: the script is older than the one that lists its built-in projects, or the code is left over
      const reserved = !existing && /already (used|exists|in use)|duplicate/i.test(err.message);
      const country = /country|\bcc\b/i.test(err.message);
      rows.push({ ...row, action: 'failed', heldCc: existing?.cc, source: existing?.source, note: reserved
        ? `${err.message} Field Report's list shows no project with this code. Since script 7.20.0 its list also shows the built-in projects (MJO, MOS, BAG), so if this is one of them the deployed script is older: deploy the newest one. Otherwise use another code (its Field Report tab, step 1).`
        : country ? `${err.message} Type the country Field Report names in this project's Country box, then sync again.` : err.message });
    }
  }
  const mine = new Set(rows.map(r => r.code).filter(Boolean));
  return { rows, extra: held.filter(x => !mine.has(String(x.code || '').toUpperCase())) };
}
