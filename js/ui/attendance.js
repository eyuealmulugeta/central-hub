// Attendance: the register of a month, one row per person, one column per day, from the attendance
// taken on site in the daily reports. Prints, emails as PDF and shares like any sheet.

import { store } from '../core/store.js';
import { register, MARK_LABEL } from '../engine/attendance.js';
import { toDay, fmtFull } from '../core/util.js';
import { monthLabel } from '../engine/payroll.js';
import { paperHtml } from '../sync/mail.js';
import { html } from './dom.js';
import { letterhead } from './docs.js';
import { openMail } from './maildialog.js';

let month = '';
let notice = '';

const dayNo = d => String(+d.slice(8));
const weekday = d => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(((toDay(d) + 4) % 7) + 7) % 7];

export function render(c) {
  const m = month || c.today.slice(0, 7);
  const r = register(c.project, c.ws, m);
  return html`
    <div class="toolbar no-print">
      <h2>Attendance</h2><span class="muted">${c.project.name}. ${notice}</span><span class="grow"></span>
      <label class="inline">Month <input type="month" data-chg="month" data-fk="at-month" value="${m}" max="${c.today.slice(0, 7)}"></label>
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this register as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="print">Print</button>
    </div>
    <section class="card sheet"><div class="paper att">
      ${letterhead(c, 'Attendance register', [['Project', c.project.name], ['Month', monthLabel(m)], ['Days reported', `${r.reportedDays} of ${r.days.filter(d => !r.off.has(d)).length} working days`]])}
      ${r.rows.length ? html`<table class="att-grid">
        <thead>
          <tr><th class="att-name">Name</th>${r.days.map(d => html`<th class="${r.off.has(d) ? 'att-off' : ''}"><span>${dayNo(d)}</span><br><span class="muted">${weekday(d)}</span></th>`)}<th>P</th><th>A</th><th>S</th><th>L</th><th>OT h</th></tr>
        </thead>
        <tbody>${r.rows.map(p => html`<tr>
          <td class="att-name"><b>${p.name}</b>${p.role ? html`<br><span class="muted">${p.role}</span>` : ''}</td>
          ${r.days.map(d => { const cell = p.cells[d]; return html`<td class="att-c ${r.off.has(d) ? 'att-off' : ''} ${cell ? `att-${cell.mark}` : ''}" title="${cell ? `${MARK_LABEL[cell.mark]}${cell.ot ? `, ${cell.ot} h overtime` : ''}` : ''}">${cell ? cell.mark : ''}${cell?.ot ? html`<sup>${cell.ot}</sup>` : ''}</td>`; })}
          <td class="r"><b>${p.present}</b></td><td class="r">${p.absent || ''}</td><td class="r">${p.sick || ''}</td><td class="r">${p.leave || ''}</td><td class="r">${p.ot || ''}</td></tr>`)}</tbody>
      </table>
      <p class="muted p-notes">P present, A absent, S sick, L on leave; a small number is overtime hours. Shaded days are not working days. Attendance comes from the daily reports filed from site.</p>`
      : html`<p class="empty">No attendance was reported in ${monthLabel(m)}. It comes from the daily reports filed from site.</p>`}
    </div></section>`;
}

export const changes = { month(el) { month = el.value; notice = ''; } };

export const actions = {
  print() { print(); },
  email(el, c) {
    const m = month || c.today.slice(0, 7);
    const name = `Attendance ${monthLabel(m)}, ${c.project.name}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: '',
      subject: name,
      message: `Dear Sir or Madam,\n\nPlease find attached the attendance register of ${c.project.name} for ${monthLabel(m)}.\n\nKind regards,\n${store.signature}\n${c.global.company?.name || 'Amistad Prefab'}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) { notice = `Sent to ${to}.`; store.notify(); },
    });
  },
};
