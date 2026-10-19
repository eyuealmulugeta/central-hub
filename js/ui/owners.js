// Company owners: the people who own the company, kept apart from the employees. No pay, no agreement, no
// attendance: who they are, the share they hold, how to reach them, their passport and papers. The Admin's
// alone, like HR. An employee who is really an owner is moved here from their HR record.

import { store } from '../core/store.js';
import { blankOwner, shareSummary } from '../engine/owners.js';
import { DOCUMENT_KINDS } from '../engine/hr.js';
import { pictureFor, sizeNote, tell, PHOTO, PASSPORT } from '../core/image.js';
import { uid, fmtFull } from '../core/util.js';
import { html, options, field, chip } from './dom.js';
import { passportBlock, toggleZoom, resetZoom } from './docimage.js';
import { scanInto, scanButton } from './ocr.js';
import { nationalityChoices } from '../engine/positions.js';
import { chooseOptions, chosenValue } from './choose.js';

let selected = null;
let showFormer = false;
let notice = '';

const TONES = ['#17788a', '#b47d14', '#0a3440', '#8a4b17', '#3c6e47', '#6a4c93'];
const find = company => company.owners.find(o => o.id === selected);
/** Open one owner from outside this screen (search). */
export const focusOn = id => { selected = id; showFormer = true; };
const isLink = v => /^https?:\/\//i.test(v || '');
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const tone = id => TONES[[...String(id)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TONES.length];
const avatar = (o, cls = '') => (o.photo
  ? html`<img class="avatar ${cls}" src="${o.photo}" alt="">`
  : html`<span class="avatar ${cls}" style="background:${tone(o.id)}">${initials(o.name)}</span>`);

export function render(c) {
  const o = find(c.company);
  return o ? form(o, c) : wall(c);
}

function wall(c) {
  const all = c.company.owners;
  const shown = all.filter(o => showFormer || o.status !== 'former');
  const s = shareSummary(all);
  return html`
    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Owners</span><strong>${s.active}</strong><span class="muted">Currently holding shares</span></div>
      <div class="kpi"><span class="kpi-label">Shares recorded</span><strong class="${s.over ? 'bad' : ''}">${s.stated ? `${s.total}%` : '—'}</strong>
        <span class="muted">${!s.stated ? 'No share entered yet' : s.whole ? 'Adds up to the whole company' : s.over ? 'More than 100%: check the shares' : 'Less than 100%: someone is missing or a share is blank'}</span></div>
    </section>
    <div class="toolbar">
      <button class="btn primary" data-act="add">New owner</button>
      <label class="check"><input type="checkbox" data-chg="showFormer" ${showFormer ? 'checked' : ''}> Show former owners</label>
      <span class="grow"></span><span class="muted">${notice || `${shown.length} shown`}</span>
    </div>
    <section class="emp-wall">
      ${shown.length ? shown.map(o => html`
        <button type="button" class="emp-card ${o.status === 'former' ? 'left' : ''}" data-act="select" data-id="${o.id}">
          ${avatar(o)}
          <span class="emp-text">
            <b>${o.name || 'New owner'}</b>
            <span>${o.title || 'Owner'}${+o.sharePct ? ` · ${o.sharePct}%` : ''}</span>
            ${o.email ? html`<span class="muted">${o.email}</span>` : ''}${o.phone ? html`<span class="muted">${o.phone}</span>` : ''}
            <span class="emp-tags">${o.status === 'former' ? chip('Former') : ''}</span>
          </span>
        </button>`)
      : html`<p class="empty">${all.length ? 'No current owners.' : 'No owners recorded yet. Add the first with "New owner", or move an employee here from their HR record.'}</p>`}
    </section>
    <p class="muted">Owners are kept apart from employees: they are not in HR, payroll or attendance. Only you, the Admin, can open this page.</p>`;
}

function form(o, c) {
  const text = (label, f, fk, type = 'text', extra = '') => html`<label>${label} <input type="${type}" data-chg="set" data-f="${f}" data-fk="${fk}" value="${o[f] ?? ''}" ${extra}></label>`;
  return html`
    <div class="toolbar">
      <button class="btn ghost" data-act="back">← Owners</button>
      <span class="muted">${o.name || 'New owner'}</span><span class="grow"></span>
      <button class="btn" data-act="toggleFormer">${o.status === 'former' ? 'Mark as an owner again' : 'Mark as a former owner'}</button>
      <button class="btn danger" data-act="removeOwner">Delete</button>
    </div>
    <section class="card emp-form">
      <header class="emp-head">
        <div class="emp-id">
          <input class="emp-name" data-chg="set" data-f="name" data-fk="ow-name" value="${o.name || ''}" placeholder="Owner's name" aria-label="Full name">
          <input class="emp-job" data-chg="set" data-f="title" data-fk="ow-title" value="${o.title || ''}" placeholder="Role, for example General Manager" aria-label="Role">
          <span class="emp-tags">${o.status === 'former' ? chip('Former') : chip('Owner', 'ok')}${o.since ? html` <span class="muted">Owner since ${fmtFull(o.since)}</span>` : ''}</span>
        </div>
        <div class="emp-photo">
          ${avatar(o, 'xl')}
          <label class="btn small">${o.photo ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" data-chg="photo" hidden></label>
          ${o.photo ? html`<button class="btn ghost small" data-act="dropPhoto">Remove photo</button>` : ''}
        </div>
      </header>
      <div class="form emp-pane">
        <h3>Ownership</h3>
        <div class="grid2">
          <label>Share of the company, % <input type="number" min="0" max="100" step="any" data-chg="set" data-f="sharePct" data-fk="ow-share" value="${o.sharePct || ''}"></label>
          <label>Owner since <input type="date" data-chg="set" data-f="since" data-fk="ow-since" value="${o.since || ''}"></label>
        </div>
        <h3>Contact</h3>
        <div class="grid2">
          ${text('Phone', 'phone', 'ow-phone')}${text('Email', 'email', 'ow-email', 'email')}
        </div>
        ${text('Address', 'address', 'ow-addr')}
        <h3>Identity</h3>
        <div class="grid2">
          <label>Nationality <select data-chg="pick" data-f="nationality" data-what="nationality" data-fk="ow-nat">${chooseOptions(nationalityChoices({ used: c.company.owners.map(x => x.nationality), current: o.nationality }), o.nationality)}</select></label>${text('Identification No.', 'idNumber', 'ow-id')}
          ${text('Passport No.', 'passportNumber', 'ow-pass')}
          <label>Passport expires <input type="date" data-chg="set" data-f="passportExpiry" data-fk="ow-pexp" value="${o.passportExpiry || ''}"></label>
        </div>
        ${passportBlock(o.passportImage, o.name)}
        <h3>Papers and links</h3>
        ${o.documents?.length ? html`<table class="table compact">
          <thead><tr><th>Paper</th><th>Number</th><th>Runs out</th><th>Link</th><th></th></tr></thead>
          <tbody>${o.documents.map(d => html`<tr>
            <td>${d.kind}</td>
            <td><input data-chg="doc" data-id="${d.id}" data-f="number" data-fk="od-n-${d.id}" value="${d.number || ''}" aria-label="Number"></td>
            <td><input type="date" data-chg="doc" data-id="${d.id}" data-f="expiry" data-fk="od-e-${d.id}" value="${d.expiry || ''}" aria-label="Runs out"></td>
            <td class="doc-link"><input data-chg="doc" data-id="${d.id}" data-f="link" data-fk="od-l-${d.id}" value="${d.link || ''}" placeholder="Paste a Drive link" aria-label="Link">${isLink(d.link) ? html`<a href="${d.link}" target="_blank" rel="noopener">Open</a>` : ''}</td>
            <td class="r"><button class="btn ghost small" data-act="dropDoc" data-id="${d.id}">Remove</button></td></tr>`)}</tbody>
        </table>` : html`<p class="muted">Add the shareholder certificate, the trade licence, visas and other papers, with the date each runs out and a link to the scan.</p>`}
        <form data-form="doc" class="entry">
          <select name="kind" aria-label="Kind of paper">${options(['Share certificate', 'Trade licence', ...DOCUMENT_KINDS].map(k => [k, k]), 'Share certificate')}</select>
          <input name="number" placeholder="Number" aria-label="Number" class="wide">
          <input type="date" name="expiry" aria-label="Runs out" title="Date it runs out">
          <button class="btn">Add paper</button>
          <span class="muted">or</span> ${scanButton('paperScan')}
        </form>
        <label>Notes <textarea data-chg="set" data-f="notes" data-fk="ow-notes" rows="3">${o.notes || ''}</textarea></label>
      </div>
    </section>`;
}

export const actions = {
  select(el) { selected = el.dataset.id; notice = ''; resetZoom(); },
  back() { selected = null; resetZoom(); },
  add(el, c) {
    const o = blankOwner(() => uid('ow'), c.today);
    store.updateCompany(co => co.owners.push(o));
    selected = o.id;
  },
  toggleFormer() { store.updateCompany(co => { const o = find(co); if (o) o.status = o.status === 'former' ? 'active' : 'former'; }); },
  removeOwner(el, c) {
    const o = find(c.company);
    if (!o || !confirm(`Delete ${o.name || 'this owner'}? To keep the record of someone who sold their share, use "Mark as a former owner" instead.`)) return;
    store.updateCompany(co => { co.owners = co.owners.filter(x => x.id !== o.id); });
    selected = null;
  },
  dropDoc(el) { store.updateCompany(co => { const o = find(co); if (o) o.documents = o.documents.filter(d => d.id !== el.dataset.id); }); },
  dropPhoto() { store.updateCompany(co => { const o = find(co); if (o) o.photo = ''; }); },
  dropPassportImage() { store.updateCompany(co => { const o = find(co); if (o) o.passportImage = ''; }); },
  zoomPassport() { toggleZoom(); },
};

export const changes = {
  showFormer(el) { showFormer = el.checked; },
  /** A nationality chosen from the list (or typed once through Other...). */
  pick(el) {
    const value = chosenValue(el, el.dataset.what || 'value');
    if (value === null) { store.notify(); return; }
    const f = el.dataset.f;
    store.updateCompany(co => { const o = find(co); if (o) o[f] = value; });
  },
  set(el) {
    const f = el.dataset.f;
    const value = f === 'sharePct' ? Math.min(100, Math.max(0, field(el))) : el.value.trim();
    store.updateCompany(co => { const o = find(co); if (o) o[f] = value; });
  },
  doc(el) {
    store.updateCompany(co => { const d = find(co)?.documents.find(x => x.id === el.dataset.id); if (d) d[el.dataset.f] = el.value.trim(); });
  },
  /** Any picture is accepted: it is made small to fit before it is kept. */
  async photo(el) { await keepPicture(el, 'photo', PHOTO, 'Photo'); },
  async passportImage(el) {
    const file = el.files[0];
    const id = selected;
    await keepPicture(el, 'passportImage', PASSPORT, 'Passport image');
    if (file) await scanInto(file, co => co.owners.find(x => x.id === id), { expiryField: 'passportExpiry', kindHint: 'Passport' });
  },
  /** A picture of any paper: read and added to Papers, and the identity fields filled when empty. */
  async paperScan(el) {
    const file = el.files[0];
    const id = selected;
    el.value = '';
    if (file) await scanInto(file, co => co.owners.find(x => x.id === id), { expiryField: 'passportExpiry' });
  },
};

async function keepPicture(el, key, limit, what) {
  const file = el.files[0];
  const id = selected;
  el.value = '';
  if (!file) return;
  try {
    const r = await pictureFor(file, limit, 'photo');
    store.updateCompany(co => { const o = co.owners.find(x => x.id === id); if (o) o[key] = r.dataUrl; });
    tell(sizeNote(what, r) || `${what} added.`);
  } catch (err) { tell(err.message); }
}

export const submits = {
  doc(fd, c) {
    if (!find(c.company)) return false;
    store.updateCompany(co => find(co).documents.push({ id: uid('od'), kind: fd.get('kind'), number: fd.get('number').trim(), expiry: fd.get('expiry') || '', link: '' }));
  },
};
