// Attendance sheet: one pay period (a week, two weeks or a month, as the project is paid), one row per person,
// one column per day, from the attendance taken on site in the daily reports. The office corrects it here:
// tap a cell, choose the mark, type overtime. Each correction is kept as its own record with who and when.
// Prints, emails as PDF and shares like any sheet.

import { store } from '../core/store.js';
import { register, groupRows, MARK_LABEL, STATES, periodFor, shiftPeriod, correction, liveFixes, waitingNote } from '../engine/attendance.js';
import { wageOf, monthlyRolesOf } from '../engine/crewpay.js';
import { docRef } from '../engine/docref.js';
import { onSite } from '../sync/fieldreport.js';
import { toDay, fmtFull } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html } from './dom.js';
import { docHead, docFoot, footText, signoff } from './print.js';
import { openMail } from './maildialog.js';
import { tell } from '../core/image.js';

let at = '';            // a day inside the period on screen; '' = today
let editing = null;     // { date, key } of the cell being corrected
let extra = [];         // people added by name for this visit, until they get a mark
let notice = '';

const dayNo = d => String(+d.slice(8));
const weekday = d => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(((toDay(d) + 4) % 7) + 7) % 7];
/** The Admin and the office correct the sheet; the site reads it (the site corrects through Field Report). */
const mayEdit = () => (store.role === 'owner' || store.role === 'office') && !store.readOnly;
const crewOf = c => [...c.ws.team.filter(m => m.active !== false && onSite(m, c.company.staff || [])), ...extra];
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

export function render(c) {
  const p = periodOf(c);
  const r = register(c.project, c.ws, p, crewOf(c));
  const edit = mayEdit();
  const working = r.days.filter(d => !r.off.has(d)).length;
  const groups = groupRows(r.rows, perOf(c));
  const ref = docRef({ company: c.global.company, project: c.project, type: 'ATT', key: p.from.slice(0, 7) + (p.kind === 'monthly' ? '' : `-${p.from.slice(8)}`) });
  const span = r.days.length;
  const cellFor = (row, d) => {
    const cell = row.cells[d];
    const on = editing && editing.date === d && editing.key === row.key;
    const cls = `att-c ${r.off.has(d) ? 'att-off' : ''} ${cell?.mark ? `att-${cell.mark}` : ''} ${cell?.fixed ? 'att-fixed' : ''} ${on ? 'att-on' : ''} ${edit && d <= c.today ? 'att-edit' : ''}`;
    const tip = cell ? `${cell.mark ? MARK_LABEL[cell.mark] : 'Cleared'}${cell.ot ? `, ${cell.ot} h overtime` : ''}${cell.fixed ? ', corrected by the office' : ''}` : '';
    return html`<td class="${cls}" title="${tip}" ${edit && d <= c.today ? html`data-act="pick" data-d="${d}" data-k="${row.key}"` : ''}>${cell?.mark || ''}${cell?.ot ? html`<sup>${cell.ot}</sup>` : ''}</td>`;
  };
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
    </div>
    ${waitingNote(c.ws.reports, p) ? html`<p class="callout warn no-print"><b>!</b> <span>${waitingNote(c.ws.reports, p)}</span></p>` : ''}
    ${edit ? html`<p class="muted no-print att-help">Tap a day to correct it. The pay period (weekly, every two weeks or monthly) is set under Settings, This project, Calendar and rates.</p>` : ''}
    ${editor(c, r)}
    <section class="card sheet att-sheet"><div class="paper att dsr land" data-foot="${footText(c, 'Attendance sheet', ref)}">
      ${docHead(c, { title: 'Attendance sheet', sub: p.label, ref, facts: [['Project', c.project.name], ['Period', p.label], ['Days reported', `${r.reportedDays} of ${working} working days`], ['People', String(r.rows.length)]] })}
      ${r.rows.length ? html`<div class="att-scroll"><table class="att-grid">
        <thead>
          <tr><th class="att-name">Name</th>${r.days.map(d => html`<th class="${r.off.has(d) ? 'att-off' : ''}"><span>${dayNo(d)}</span><br><span class="muted">${weekday(d)}</span></th>`)}<th class="att-t">P</th><th class="att-t">A</th><th class="att-t">S</th><th class="att-t">L</th><th class="att-t">OT h</th></tr>
        </thead>
        ${groups.map(g => html`<tbody>
          <tr class="att-group"><td class="att-name" colspan="${span + 6}">${g.title} <span class="muted">${g.rows.length} ${g.rows.length === 1 ? 'person' : 'people'}${g.per === 'month' ? ' · attendance is a record; it does not change the monthly pay' : ''}</span></td></tr>
          ${g.rows.map(row => html`<tr>
          <td class="att-name"><b>${row.name}</b>${row.role ? html`<br><span class="muted">${row.role}</span>` : ''}</td>
          ${r.days.map(d => cellFor(row, d))}
          <td class="att-t"><b>${row.present}</b></td><td class="att-t">${row.absent || ''}</td><td class="att-t">${row.sick || ''}</td><td class="att-t">${row.leave || ''}</td><td class="att-t">${row.ot || ''}</td></tr>`)}
          ${groups.length > 1 ? html`<tr class="att-sub"><td class="att-name">Subtotal</td><td colspan="${span}"></td><td class="att-t"><b>${g.totals.present}</b></td><td class="att-t">${g.totals.absent || ''}</td><td class="att-t">${g.totals.sick || ''}</td><td class="att-t">${g.totals.leave || ''}</td><td class="att-t">${g.totals.ot || ''}</td></tr>` : ''}
        </tbody>`)}
        <tfoot><tr><td class="att-name">Present per day</td>${r.days.map(d => html`<td class="${r.off.has(d) ? 'att-off' : ''}">${r.heads[d] || ''}</td>`)}<td class="att-t"><b>${r.rows.reduce((s, x) => s + x.present, 0)}</b></td><td class="att-t">${r.rows.reduce((s, x) => s + x.absent, 0) || ''}</td><td class="att-t">${r.rows.reduce((s, x) => s + x.sick, 0) || ''}</td><td class="att-t">${r.rows.reduce((s, x) => s + x.leave, 0) || ''}</td><td class="att-t">${r.rows.reduce((s, x) => s + x.ot, 0) || ''}</td></tr></tfoot>
      </table></div>
      <p class="muted p-notes">P present, A absent, S sick, L on leave; a small number is overtime hours; an underlined mark was corrected by the office. Shaded days are not working days; a blank working day was not reported. Attendance comes from the daily reports filed from site.</p>
      ${signoff([{ label: 'Prepared by · Site engineer', name: holder(c, /site engineer/i) }, { label: 'Approved by · Project engineer', name: holder(c, /project engineer/i) }])}
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
