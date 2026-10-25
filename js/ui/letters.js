// Letters: the standard letters of the office (employment confirmation, salary confirmation,
// experience certificate, warning, introduction of the crew), written from a template and the
// person's record, edited here, then printed or emailed as a PDF on the company letterhead.
// Admin only, because most of them are built from HR records.

import { store } from '../core/store.js';
import { TEMPLATES, templateOf, valuesFor, fill, unfilled, nextNumber } from '../engine/letters.js';
import { uid, fmtFull } from '../core/util.js';
import { paperHtml } from '../sync/mail.js';
import { html, options, chip } from './dom.js';
import { stamp } from '../core/division.js';
import { docHead, footText, signoff } from './print.js';
import { companyCode } from '../engine/docref.js';
import { openMail, emailIn } from './maildialog.js';

let selected = null;
let notice = '';

const find = company => company.letters.find(l => l.id === selected);
/** Open one letter from outside this screen (search). */
export const focusOn = id => { selected = id; };
const staffOf = (company, l) => company.staff.find(p => p.id === l.staffId);

export function render(c) {
  const letter = find(c.company);
  return letter ? detail(letter, c) : list(c);
}

function list(c) {
  const letters = [...c.company.letters].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  const active = c.company.staff.filter(p => p.status !== 'left');
  return html`
    <section class="card">
      <div class="toolbar"><h2>New letter</h2><span class="muted">${notice}</span></div>
      <form data-form="newLetter" class="entry">
        <select name="template" aria-label="Kind of letter">${options(TEMPLATES.map(t => [t.id, t.name]), 'employment')}</select>
        <select name="staffId" aria-label="About which employee"><option value="">No employee (blank or crew letter)</option>${options(active.map(p => [p.id, p.title ? `${p.name}, ${p.title}` : p.name]), null)}</select>
        <input name="to" class="wide" placeholder="To (a name or organisation, optional)" aria-label="Addressed to">
        <button class="btn primary">Write the letter</button>
      </form>
      <p class="muted">The letter is filled from the employee's record and the company letterhead. You read and edit it before it is printed or emailed. Anything still in {{braces}} or [square brackets] must be completed first.</p>
    </section>
    <section class="card">
      <h2>Letters</h2>
      ${letters.length ? html`<table class="table">
        <thead><tr><th>Number</th><th>Date</th><th>Subject</th><th>To</th><th>About</th><th>Status</th></tr></thead>
        <tbody>${letters.map(l => html`<tr class="click" data-act="open" data-id="${l.id}">
          <td class="nowrap"><button class="link" type="button">${l.number}</button></td><td class="nowrap">${fmtFull(l.date)}</td>
          <td>${l.subject || '(no subject)'}</td><td>${l.to || ''}</td><td>${staffOf(c.company, l)?.name || ''}</td>
          <td>${l.status === 'issued' ? chip('Issued', 'ok') : chip('Draft', 'warn')}</td></tr>`)}</tbody>
      </table>` : html`<p class="empty">No letters yet.</p>`}
    </section>
    <p class="muted">Only you, the Admin, can open this page.</p>`;
}

/** AP-LTR-2026-001: the company's code and the letter's own number. */
export const letterRef = (c, l) => `${companyCode(c.global.company)}-${l.number}`;

function detail(l, c) {
  const co = c.global.company || {};
  const staff = staffOf(c.company, l);
  const draft = l.status !== 'issued';
  const open = unfilled(l.subject, l.body, l.to);
  const sender = [l.signName, l.signTitle].filter(Boolean);
  return html`
    <div class="toolbar no-print">
      <button class="btn ghost" data-act="back">← Letters</button>
      <span class="muted">${l.number}${l.emails?.length ? `. Emailed to ${l.emails.at(-1).to} on ${fmtFull(l.emails.at(-1).at)}` : ''}</span>
      <span class="grow"></span>
      ${draft ? html`<button class="btn" data-act="issue" title="Locks the wording. A letter that has gone out should not change">Mark as issued</button>` : html`<span class="chip ok">Issued</span>`}
      <button class="btn" data-act="email">Email as PDF</button>
      <button class="btn" data-share title="Send this document as a PDF file on WhatsApp or Telegram">WhatsApp / Telegram</button>
      <button class="btn primary" data-act="print">Print</button>
      <button class="btn danger" data-act="removeLetter">Delete</button>
    </div>
    ${draft && open.length ? html`<p class="bad no-print">Still to complete before it goes out: ${open.join('  ')}</p>` : ''}
    ${draft ? html`<section class="card no-print"><div class="grid2">
      <label>Date <input type="date" data-chg="set" data-f="date" data-fk="lt-date" value="${l.date}"></label>
      <label>To <input data-chg="set" data-f="to" data-fk="lt-to" value="${l.to || ''}" placeholder="Name or organisation"></label>
      <label>Subject <input data-chg="set" data-f="subject" data-fk="lt-subject" value="${l.subject || ''}"></label>
      <label>Signed by <input data-chg="set" data-f="signName" data-fk="lt-sname" value="${l.signName || ''}"></label>
      <label>Title of the signer <input data-chg="set" data-f="signTitle" data-fk="lt-stitle" value="${l.signTitle || ''}"></label>
    </div>
    <label>Letter <textarea data-chg="set" data-f="body" data-fk="lt-body" rows="14">${l.body || ''}</textarea></label></section>` : ''}
    <section class="card sheet"><div class="paper dsr doc-paper letter-paper" data-foot="${footText(c, 'Letter', letterRef(c, l), { project: false })}">
      ${docHead(c, { title: 'Letter', ref: letterRef(c, l), status: draft ? 'Draft' : '', tone: 'warn', facts: [['Date', fmtFull(l.date)], ['Signed by', sender.join(', ')]] })}
      <div class="letter-body">
        ${l.to ? html`<p class="letter-to"><span>To</span><b class="pre">${l.to}</b></p>` : ''}
        ${l.subject ? html`<p class="letter-subj">Subject: ${l.subject}</p>` : ''}
        <p class="pre">${l.body || ''}</p>
        <p>Yours faithfully,</p>
      </div>
      ${signoff([{ label: `For ${co.name || 'the company'}`, name: sender.join(', ') || 'Authorised signatory' }, { stamp: true }])}
      ${staff ? html`<p class="muted no-print">About ${staff.name}, from the HR record.</p>` : ''}
    </div></section>`;
}

export const actions = {
  open(el) { selected = el.dataset.id; notice = ''; },
  back() { selected = null; notice = ''; },
  print() { print(); },
  issue(el, c) {
    const l = find(c.company);
    if (!l) return;
    const open = unfilled(l.subject, l.body, l.to);
    if (open.length && !confirm(`Part of the letter is unfinished (${open.slice(0, 3).join(', ')}). Mark it as issued anyway?`)) return;
    store.updateCompany(co => { find(co).status = 'issued'; });
  },
  email(el, c) {
    const l = find(c.company);
    if (!l) return;
    const staff = staffOf(c.company, l);
    const sender = c.global.company?.name || 'Amistad Prefab';
    const name = `${l.number}${l.subject ? `, ${l.subject}` : ''}`.replace(/[\\/:*?"<>|]/g, '-');
    openMail({
      to: emailIn(l.to) || emailIn(staff?.privateEmail) || emailIn(staff?.email),
      subject: `${l.subject || 'Letter'} (${l.number})`,
      message: `Dear ${l.to || 'Sir or Madam'},\n\nPlease find attached our letter ${l.number}${l.subject ? `, ${l.subject}` : ''}.\n\nKind regards,\n${store.signature}\n${sender}`,
      filename: name,
      getHtml: () => paperHtml(document.querySelector('.paper'), name),
      sheet: () => document.querySelector('.paper'),
      onSent({ to }) {
        notice = `Sent to ${to}.`;
        store.updateCompany(co => { const x = find(co); if (x) x.emails = [...(x.emails || []), { at: c.today, to }]; });
      },
    });
  },
  removeLetter(el, c) {
    const l = find(c.company);
    if (!l || !confirm(`Delete letter ${l.number}? A letter that was issued should be kept as a record.`)) return;
    store.updateCompany(co => { co.letters = co.letters.filter(x => x.id !== l.id); });
    selected = null;
  },
};

export const changes = {
  set(el) {
    const f = el.dataset.f;
    store.updateCompany(co => { const l = find(co); if (l && l.status !== 'issued') l[f] = f === 'body' ? el.value : el.value.trim(); });
  },
};

export const submits = {
  newLetter(fd, c) {
    const t = templateOf(fd.get('template'));
    const staff = c.company.staff.find(p => p.id === fd.get('staffId')) || null;
    if (t.staff && !staff) { notice = `A ${t.name.toLowerCase()} is about one employee: choose who.`; return false; }
    const date = c.today;
    const values = valuesFor({
      staff, project: c.project, company: c.global.company, today: date, to: String(fd.get('to') || '').trim(), crew: c.ws.team,
      assignedProject: store.projects.find(p => p.id === staff?.projectId)?.name || '',
    });
    const letter = {
      id: uid('lt'), number: nextNumber(store.company.letters, date), template: t.id, date, status: 'draft', ...stamp(),
      staffId: staff?.id || '', projectId: c.project.id, to: values.to,
      subject: fill(t.subject, values), body: fill(t.body, values),
      signName: store.profile.name || store.user?.name || '', signTitle: store.profile.title || '', emails: [],
    };
    store.updateCompany(co => co.letters.push(letter));
    selected = letter.id;
    notice = '';
  },
};
