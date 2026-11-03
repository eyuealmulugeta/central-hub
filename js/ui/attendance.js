// Attendance sheet: one pay period (a week, two weeks or a month, as the project is paid), one row per person,
// one column per day, from the attendance taken on site in the daily reports. The office corrects it here:
// tap a cell, choose the mark, type overtime. Each correction is kept as its own record with who and when.
// Prints, emails as PDF and shares like any sheet.

import { store } from '../core/store.js';
import { register, groupRows, MARK_LABEL, STATES, MARK, periodFor, shiftPeriod, correction, liveFixes, waitingNote, photoDay, PHOTO_WORD, delegated, officeId, daysOf, officeStaffOf } from '../engine/attendance.js';
import { tierOfPerson } from '../engine/manpower.js';
import { tierOfPosition } from '../engine/positions.js';
import { wageOf, monthlyRolesOf } from '../engine/crewpay.js';
import { docRef } from '../engine/docref.js';
import { onSite } from '../sync/fieldreport.js';
import { toDay, fmtFull } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html } from './dom.js';
import { docHead, docFoot, footText, signoff } from './print.js';
import { checkOf, checkRecord, checkId } from '../engine/paysteps.js';
import { openMail } from './maildialog.js';
import { tell } from '../core/image.js';
import { siteEngineerSig } from '../engine/sitesig.js';   // v0.73.0

let at = '';            // a day inside the period on screen; '' = today
let editing = null;     // { date, key } of the cell being corrected
let extra = [];         // people added by name for this visit, until they get a mark
let notice = '';
let office = false;     // v0.50.0: the office staff's sheet (people with no project); v0.50.1 also HR (Office attendance)
const isHR = () => (store.ranks || []).includes('hr_assistant');
export function preset(p = {}) { office = !!p.office; }

const dayNo = d => String(+d.slice(8));
const weekday = d => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(((toDay(d) + 4) % 7) + 7) % 7];
/** The Admin and the office correct the sheet; the site reads it (the site corrects through Field Report). */
const mayEdit = () => (store.role === 'owner' || store.role === 'office') && !store.readOnly;
// v0.50.0: everyone delegated to the project in the Manpower Directory is on its sheet; Tier 1 is on no sheet
const tierOfRow = (m, staff) => { const p = m.personId && staff.find(x => x.id === m.personId); return (p && tierOfPerson(p)) || tierOfPosition(m.role || m.title) || 4; };
const crewOf = c => {
  const staff = c.company.staff || [], team = c.ws.team.filter(m => m.active !== false && onSite(m, staff) && tierOfRow(m, staff) !== 1);
  const known = new Set(team.flatMap(m => [m.personId, String(m.name || '').trim().toLowerCase()]).filter(Boolean));
  const more = delegated(staff, c.project.id, p => tierOfPerson(p)).filter(p => !known.has(p.personId) && !known.has(String(p.name || '').trim().toLowerCase()));
  return [...team, ...more, ...extra];
};
const periodOf = c => periodFor(c.project, at || c.today);
const nameOf = (r, key) => r.rows.find(x => x.key === key)?.name || '';
/** Monthly or daily, for the grouping only: the sheet itself never shows money. */
const perOf = c => row => wageOf(row, { ws: c.ws, project: c.project, staff: c.company.staff || [], monthlyRoles: monthlyRolesOf(store.global) }).per;
const holder = (c, re) => c.ws.team.find(m => m.active !== false && re.test(m.role || ''))?.name || '';

function editor(c, r) {
  if (!editing) return '';
  const row = r.rows.find(x => x.key === editing.key);
  if (!row) return '';
  const cell = row.cells[editing.date];
  return html`<div class="att-editor no-print" role="group" aria-label="Correct the attendance">
    <b>${row.name}</b><span class="muted">${fmtFull(editing.date)}</span>
    ${STATES.map(([k, label]) => html`<button type="button" class="btn small ${cell?.state === k ? 'primary' : ''}" data-act="setMark" data-s="${k}">${label}</button>`)}
    <button type="button" class="btn small ghost" data-act="setMark" data-s="none" title="No mark for this day">Clear</button>
    <label class="inline">Overtime <input type="number" min="0" max="16" step="0.5" data-chg="setOt" data-fk="att-ot" value="${cell?.ot || ''}" placeholder="0" ${cell && cell.state !== 'none' ? '' : 'disabled'}> h</label>
    <button type="button" class="btn small" data-act="closeEdit">Done</button>
  </div>`;
}

function fixList(c) {
  const p = periodOf(c);
  const list = liveFixes(c.ws.attendance).filter(f => f.date >= p.from && f.date <= p.to).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!list.length) return '';
  const word = s => (s === 'none' ? 'no mark' : MARK_LABEL[{ present: 'P', absent: 'A', sick: 'S', leave: 'L' }[s]] || s);
  return html`<section class="card no-print" id="att-fixes">
    <h3>Corrections in this period <span class="muted">kept when reports are imported again, and sent to Field Report with the lists</span></h3>
    <table class="table compact"><thead><tr><th>Day</th><th>Person</th><th>Was</th><th>Now</th><th>By</th><th>When</th><th></th></tr></thead>
      <tbody>${list.map(f => html`<tr>
        <td class="nowrap">${fmtFull(f.date)}</td><td>${f.name}</td>
        <td>${f.was ? `${word(f.was.state)}${f.was.ot ? `, ${f.was.ot} h` : ''}` : html`<span class="muted">not reported</span>`}</td>
        <td><b>${word(f.state)}${f.ot ? `, ${f.ot} h` : ''}</b></td>
        <td>${f.by || ''}</td><td class="nowrap">${String(f.at || '').slice(0, 16).replace('T', ' ')}</td>
        <td>${mayEdit() ? html`<button type="button" class="btn small ghost" data-act="undoFix" data-id="${f.id}" title="Go back to what the report said">Undo</button>` : ''}</td>
      </tr>`)}</tbody></table>
  </section>`;
}

/** v0.42.0: corrections sent from site (Field Report, Crew attendance): they count once accepted here. */
function siteList(c) {
  const list = (c.ws.attendance || []).filter(f => f.review === 'waiting').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!list.length) return '';
  const word = s => (s === 'none' ? 'no mark' : MARK_LABEL[{ present: 'P', absent: 'A', sick: 'S', leave: 'L' }[s]] || s);
  return html`<section class="card no-print" id="att-site">
    <h3>From site · ${list.length} waiting for your review <span class="muted">sent from Field Report; a correction counts once accepted</span>
      <button type="button" class="btn small primary" data-act="acceptAll">Accept all</button></h3>
    <table class="table compact"><thead><tr><th>Day</th><th>Person</th><th>Was</th><th>Asked</th><th>By</th><th>When</th><th></th></tr></thead>
      <tbody>${list.map(f => html`<tr>
        <td class="nowrap">${fmtFull(f.date)}</td><td>${f.name}</td>
        <td>${f.was ? `${word(f.was.state)}${f.was.ot ? `, ${f.was.ot} h` : ''}` : html`<span class="muted">not reported</span>`}</td>
        <td><b>${word(f.state)}${f.ot ? `, ${f.ot} h` : ''}</b></td>
        <td>${String(f.by || '').replace(/^Site: /, '')}</td><td class="nowrap">${String(f.at || '').slice(0, 16).replace('T', ' ')}</td>
        <td class="nowrap"><button type="button" class="btn small primary" data-act="acceptFix" data-id="${f.id}">Accept</button> <button type="button" class="btn small ghost" data-act="rejectFix" data-id="${f.id}">Reject</button></td>
      </tr>`)}</tbody></table>
  </section>`;
}

/** v0.42.0: a site correction accepted (it becomes the office's correction of that cell) or rejected, with who and when. */
function decide(ids, review) {
  const by = store.user?.email || 'this computer', at = new Date().toISOString();
  let n = 0;
  store.update(ws => {
    for (const id of ids) {
      const f = (ws.attendance || []).find(x => x.id === id && x.review === 'waiting');
      if (!f) continue;
      if (review === 'accepted') {
        const rec = correction(ws, { date: f.date, key: f.key, personId: f.personId || '', name: f.name, state: f.state, ot: f.ot }, `${f.by || 'Site'}, accepted by ${by}`, at);
        const i = ws.attendance.findIndex(x => x.id === rec.id);
        if (i >= 0) ws.attendance[i] = rec; else ws.attendance.push(rec);
      }
      Object.assign(f, { review, reviewBy: by, reviewAt: at });
      n++;
    }
  });
  tell(`${n} ${n === 1 ? 'correction' : 'corrections'} from site ${review}.`);
}

/** v0.48.0: the pay period's days and hours, checked by the Site Engineer (or anyone who keeps this sheet) before pay is approved. */
function checkBar(c, p) {
  const ck = checkOf(c.ws, p.from);
  return html`<div class="actions left no-print">${ck ? html`<span class="chip ok">✓ Days and hours checked by ${ck.byName || ck.by}, ${String(ck.at).slice(0, 10)}</span> <button type="button" class="btn ghost small" data-act="uncheck">Undo</button>`
    : html`<button type="button" class="btn small primary" data-act="checkDays" title="The pay of this period can then be approved">The days and hours of ${p.label} are right</button>`}</div>`;
}

/** v0.50.0: the morning crew photo of each day: its time and tag, a tap opens it, the place on the map. */
function photoRow(c, r) {
  const cell = d => {
    const s = r.off.has(d) ? { state: '' } : photoDay(c.ws, d);
    if (!s.state) return html`<td class="${r.off.has(d) ? 'att-off' : ''}"></td>`;
    const tip = s.state === 'missing' ? 'No crew photo with the report' : `${PHOTO_WORD[s.state]} ${s.time}${s.tags.length ? ` · ${s.tags.join(', ')}` : ''}${s.geo ? ` · ${s.geo.lat}, ${s.geo.lng}` : ''}`;
    const mark = s.state === 'missing' ? '✗' : s.state === 'late' ? 'L' : '✓';
    const link = s.fileId ? `https://drive.google.com/file/d/${s.fileId}/view` : s.geo ? `https://maps.google.com/?q=${s.geo.lat},${s.geo.lng}` : '';
    return html`<td class="att-photo att-ph-${s.state}${s.tags?.length ? ' att-ph-tag' : ''}" title="${tip}">${link ? html`<a href="${link}" target="_blank" rel="noopener">${mark}</a>` : mark}${s.time ? html`<br><small>${s.time}</small>` : ''}</td>`;
  };
  return html`<tr class="att-photos"><th class="att-name">Crew photo</th>${r.days.map(cell)}<th colspan="5"></th></tr>`;
}

/** v0.50.0: office staff (no project): a month, one row each, the Admin taps a day to mark it (P, A, S, L, blank). */
function officeSheet(c) {
  const month = (at || c.today).slice(0, 7), days = daysOf(month);
  // the Admin reads the directory; HR the names-and-positions list the Admin's app keeps (company.officeStaff)
  const people = store.isAdmin ? officeStaffOf(c.company.staff, tierOfPerson) : (c.company.officeStaff || []);
  const marks = new Map((c.company.officeAttendance || []).map(m => [m.id, m]));
  return html`<div class="toolbar no-print"><h2>Office staff attendance</h2><span class="muted">People with no project. Tap a day: Present, Absent, Sick, On leave, blank. Absent days go to Payroll as unpaid days.</span><span class="grow"></span>
      <button class="btn small" data-act="shift" data-n="-1" aria-label="Previous month">‹</button><b class="att-period">${month}</b><button class="btn small" data-act="shift" data-n="1" aria-label="Next month">›</button>
      ${store.isAdmin ? html`<button class="btn" data-act="officeOff">← Project sheet</button>` : ''}</div>
    <section class="card sheet att-sheet">${people.length ? html`<div class="att-scroll"><table class="att-grid">
      <thead><tr><th class="att-name">Name</th>${days.map(d => html`<th><span>${dayNo(d)}</span><br><span class="muted">${weekday(d)}</span></th>`)}</tr></thead>
      <tbody>${people.map(p => html`<tr><td class="att-name"><b>${p.name}</b><br><span class="muted">${p.title || ''}</span></td>
        ${days.map(d => { const m = marks.get(officeId(d, p.id)), k = MARK[m?.state] || ''; return html`<td class="att-c ${k ? `att-${k}` : ''} ${d <= c.today ? 'att-edit' : ''}" ${d <= c.today ? html`data-act="officeMark" data-d="${d}" data-p="${p.id}"` : ''}>${k}</td>`; })}</tr>`)}</tbody></table></div>`
      : html`<p class="empty">Everyone in the directory is on a project.</p>`}</section>`;
}

// v0.71.0: the reporter's check of each day in Field Report
const CHECK = { ok: ['✓', 'Confirmed correct by'], changed: ['!', 'Changed after it was confirmed by'], open: ['…', 'Not confirmed by the reporter yet'] };
function checkRow(r) {
  if (!Object.keys(r.checks || {}).length) return '';
  const cell = d => { const k = r.checks[d]; return k ? html`<th class="att-k att-k-${k.state}" title="${CHECK[k.state][1]}${k.by ? ` ${k.by}` : ''}">${CHECK[k.state][0]}</th>` : html`<th></th>`; };
  return html`<tr class="att-check"><th class="att-name">Reporter's check</th>${r.days.map(cell)}<th colspan="5"></th></tr>`;
}

export function render(c) {
  if (office && (store.isAdmin || isHR())) return officeSheet(c);
  const p = periodOf(c);
  const r = register(c.project, c.ws, p, crewOf(c), { live: true });
  const edit = mayEdit();
  const working = r.days.filter(d => !r.off.has(d)).length;
  const groups = groupRows(r.rows, perOf(c));
  const ref = docRef({ company: c.global.company, project: c.project, type: 'ATT', key: p.from.slice(0, 7) + (p.kind === 'monthly' ? '' : `-${p.from.slice(8)}`) });
  const span = r.days.length;
  const cellFor = (row, d) => {
    const cell = row.cells[d];
    const on = editing && editing.date === d && editing.key === row.key;
    const cls = `att-c ${r.off.has(d) ? 'att-off' : ''} ${cell?.mark ? `att-${cell.mark}` : ''} ${cell?.fixed ? 'att-fixed' : ''} ${cell?.live ? 'att-live' : ''} ${on ? 'att-on' : ''} ${edit && d <= c.today ? 'att-edit' : ''}`;
    const tip = cell ? `${cell.mark ? MARK_LABEL[cell.mark] : 'Cleared'}${cell.ot ? `, ${cell.ot} h overtime` : ''}${cell.fixed ? ', corrected by the office' : ''}${cell.live ? ', live from Field Report (report not sent yet)' : ''}` : '';
    return html`<td class="${cls}" title="${tip}" ${edit && d <= c.today ? html`data-act="pick" data-d="${d}" data-k="${row.key}"` : ''}>${cell?.mark || ''}${cell?.ot ? html`<sup>${cell.ot}</sup>` : ''}</td>`;
  };
  // v0.33.0: the photo and the Fayda ID (or passport) of each person, from Employee data, the main record
  const staff = c.company.staff || [];
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const personOf = row => { const m = (c.ws.team || []).find(x => x.id === row.id); return staff.find(p => m?.personId && p.id === m.personId) || staff.find(p => same(p.name, row.name)) || null; };
  const pics = row => { const p = personOf(row), id = p && (p.idImage || p.passportImage); return p && (p.photo || id) ? html`<span class="att-pics">${p.photo ? html`<img class="att-face" src="${p.photo}" alt="">` : ''}${id ? html`<img class="att-id" src="${id}" alt="ID">` : ''}</span>` : ''; };
  return html`
    <div class="toolbar no-print">
      <h2>Attendance sheet</h2><span class="muted">${c.project.name}. ${notice}</span><span class="grow"></span>
      <button class="btn small" data-act="shift" data-n="-1" aria-label="Previous period">‹</button>
      <b class="att-period">${p.label}</b>
      <button class="btn small" data-act="shift" data-n="1" aria-label="Next period" ${p.to >= c.today ? 'disabled' : ''}>›</button>
      ${at ? html`<button class="btn small ghost" data-act="today">This period</button>` : ''}
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this sheet as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="print">Print</button>
      ${store.isAdmin && mayEdit() ? html`<button class="btn" data-act="officeOn" title="Attendance of the staff with no project">Office staff</button>` : ''}
    </div>
    ${waitingNote(c.ws.reports, p) ? html`<p class="callout warn no-print"><b>!</b> <span>${waitingNote(c.ws.reports, p)}</span></p>` : ''}
    ${edit ? html`<p class="muted no-print att-help">Tap a day to correct it. The pay period (weekly, every two weeks or monthly) is set under Settings, This project, Calendar and rates.</p>` : ''}
    ${edit ? siteList(c) : ''}
    ${editor(c, r)}
    <section class="card sheet att-sheet"><div class="paper att dsr land" data-foot="${footText(c, 'Attendance sheet', ref)}">
      ${checkBar(c, p)}
      ${docHead(c, { title: 'Attendance sheet', sub: p.label, ref, facts: [['Project', c.project.name], ['Period', p.label], ['Days reported', `${r.reportedDays} of ${working} working days`], ['People', String(r.rows.length)]] })}
      ${r.rows.length ? html`<div class="att-scroll"><table class="att-grid">
        <thead>
          <tr><th class="att-name">Name</th>${r.days.map(d => html`<th class="${r.off.has(d) ? 'att-off' : ''}"><span>${dayNo(d)}</span><br><span class="muted">${weekday(d)}</span></th>`)}<th class="att-t">P</th><th class="att-t">A</th><th class="att-t">S</th><th class="att-t">L</th><th class="att-t">OT h</th></tr>
          ${photoRow(c, r)}
          ${checkRow(r)}
        </thead>
        ${groups.map(g => html`<tbody>
          <tr class="att-group"><td class="att-name" colspan="${span + 6}">${g.title} <span class="muted">${g.rows.length} ${g.rows.length === 1 ? 'person' : 'people'}${g.per === 'month' ? ' · by the month (Tiers 2, 3, 5): absent days go to Payroll as unpaid days' : ' · by the day (Tier 4): days and overtime make the crew pay'}</span></td></tr>
          ${g.rows.map(row => html`<tr>
          <td class="att-name">${pics(row)}<b>${row.name}</b>${row.role ? html`<br><span class="muted">${row.role}</span>` : ''}</td>
          ${r.days.map(d => cellFor(row, d))}
          <td class="att-t"><b>${row.present}</b></td><td class="att-t">${row.absent || ''}</td><td class="att-t">${row.sick || ''}</td><td class="att-t">${row.leave || ''}</td><td class="att-t">${row.ot || ''}</td></tr>`)}
          ${groups.length > 1 ? html`<tr class="att-sub"><td class="att-name">Subtotal</td><td colspan="${span}"></td><td class="att-t"><b>${g.totals.present}</b></td><td class="att-t">${g.totals.absent || ''}</td><td class="att-t">${g.totals.sick || ''}</td><td class="att-t">${g.totals.leave || ''}</td><td class="att-t">${g.totals.ot || ''}</td></tr>` : ''}
        </tbody>`)}
        <tfoot><tr><td class="att-name">Present per day</td>${r.days.map(d => html`<td class="${r.off.has(d) ? 'att-off' : ''}">${r.heads[d] || ''}</td>`)}<td class="att-t"><b>${r.rows.reduce((s, x) => s + x.present, 0)}</b></td><td class="att-t">${r.rows.reduce((s, x) => s + x.absent, 0) || ''}</td><td class="att-t">${r.rows.reduce((s, x) => s + x.sick, 0) || ''}</td><td class="att-t">${r.rows.reduce((s, x) => s + x.leave, 0) || ''}</td><td class="att-t">${r.rows.reduce((s, x) => s + x.ot, 0) || ''}</td></tr></tfoot>
      </table></div>
      <p class="muted p-notes">P present, A absent, S sick, L on leave; a small number is overtime hours; an underlined mark was corrected by the office. Shaded days are not working days; a blank working day was not reported. Attendance comes from the daily reports filed from site. Crew photo: ✓ on time, L late, ✗ missing; the time is below, the tag and place in the tip.</p>
      ${signoff([{ label: 'Prepared by · Site engineer', name: holder(c, /site engineer/i) || siteEngineerSig(c.ws)?.name || '', sig: siteEngineerSig(c.ws)?.sig || '' }, { label: 'Approved by · Project engineer', name: holder(c, /project engineer/i) }])}
      ${docFoot(footText(c, 'Attendance sheet', ref))}`
      : html`<p class="empty">Nobody is on this project's site team yet, and no attendance was reported for ${p.label}.</p>`}
    </div></section>
    ${edit ? html`<form data-form="addPerson" class="entry no-print att-add">
      <input name="name" required placeholder="Someone not on the list: full name" aria-label="Name of a person to add to the sheet">
      <button class="btn">Add to the sheet</button>
      <span class="muted">They stay on the sheet once a day is marked.</span>
    </form>` : ''}
    ${fixList(c)}`;
}

/** Save the mark of the cell being corrected. */
function save(c, patch) {
  const r = register(c.project, c.ws, periodOf(c), crewOf(c));
  const row = r.rows.find(x => x.key === editing?.key);
  if (!row) return;
  const cell = row.cells[editing.date];
  const want = { state: cell?.state && cell.state !== 'none' ? cell.state : 'present', ot: cell?.ot || 0, ...patch };
  store.update(ws => {
    ws.attendance = ws.attendance || [];
    const rec = correction(ws, { date: editing.date, key: row.key, personId: row.id, name: row.name, ...want }, store.user?.email || 'this computer', new Date().toISOString());
    const i = ws.attendance.findIndex(f => f.id === rec.id);
    if (i >= 0) ws.attendance[i] = rec; else ws.attendance.push(rec);
  });
}

export const changes = {
  setOt(el, c) { if (editing) save(c, { ot: Math.max(0, +el.value || 0) }); },
};

export const actions = {
  officeOn() { office = true; editing = null; },
  officeOff() { office = false; },
  officeMark(el, c) {
    const cycle = ['present', 'absent', 'sick', 'leave', ''];
    const p = (store.isAdmin ? c.company.staff : c.company.officeStaff || []).find(x => x.id === el.dataset.p), id = officeId(el.dataset.d, el.dataset.p);
    if (!p) return;
    store.updateCompany(co => {
      const list = (co.officeAttendance ||= []), m = list.find(x => x.id === id);
      const next = cycle[(cycle.indexOf(m?.state || '') + 1) % cycle.length];
      if (m) { if (next) Object.assign(m, { state: next, by: store.user?.email || '', at: new Date().toISOString() }); else co.officeAttendance = list.filter(x => x.id !== id); }
      else list.push({ id, date: el.dataset.d, personId: p.id, name: p.name, state: next, by: store.user?.email || '', at: new Date().toISOString() });
    });
  },
  checkDays(el, c) {
    const p = periodOf(c);
    if (!confirm(`The days and hours of ${p.label} on ${c.project.name} are right? The pay can then be approved.`)) return;
    store.update(ws => { ws.attendance = [...(ws.attendance || []).filter(r => r.id !== checkId(p.from)), checkRecord(p, { by: store.user?.email || 'local', byName: store.signature || store.user?.name || '', at: new Date().toISOString() })]; });
  },
  uncheck(el, c) { const p = periodOf(c); store.update(ws => { ws.attendance = (ws.attendance || []).filter(r => r.id !== checkId(p.from)); }); },
  print() { print(); },
  shift(el, c) { at = shiftPeriod(c.project, periodOf(c), +el.dataset.n).from; editing = null; notice = ''; },
  today() { at = ''; editing = null; },
  pick(el) { editing = editing && editing.date === el.dataset.d && editing.key === el.dataset.k ? null : { date: el.dataset.d, key: el.dataset.k }; },
  closeEdit() { editing = null; },
  setMark(el, c) {
    if (!editing) return;
    save(c, { state: el.dataset.s, ...(el.dataset.s === 'none' ? { ot: 0 } : {}) });
    tell(`✓ ${nameOf(register(c.project, c.ws, periodOf(c), crewOf(c)), editing.key)}, ${fmtFull(editing.date)}: ${el.dataset.s === 'none' ? 'cleared' : STATES.find(([k]) => k === el.dataset.s)[1]}.`);
  },
  acceptFix(el) { decide([el.dataset.id], 'accepted'); },
  rejectFix(el) { decide([el.dataset.id], 'rejected'); },
  acceptAll(el, c) { decide((c.ws.attendance || []).filter(f => f.review === 'waiting').map(f => f.id), 'accepted'); },
  undoFix(el) { store.update(ws => { const f = (ws.attendance || []).find(x => x.id === el.dataset.id); if (f) f.undone = true; }); },
  email(el, c) {
    const p = periodOf(c);
    const name = `Attendance sheet ${p.label}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: name,
      message: `Dear Sir or Madam,\n\nPlease find attached the attendance sheet of ${c.project.name} for ${p.label}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
};

export const submits = {
  addPerson(fd) {
    const name = String(fd.get('name') || '').trim();
    if (!name) return false;
    if (!extra.some(x => x.name.toLowerCase() === name.toLowerCase())) extra.push({ id: '', name, role: '' });
    notice = `${name} is on the sheet: tap a day to mark them.`;
  },
};
