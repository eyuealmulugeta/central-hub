// Contacts: the address book. Email addresses and phone numbers are saved once (here, or automatically the first time an
// email is sent) and found by name afterwards. Each contact shows the projects whose documents were sent to them or
// copied to them, which is what fills in the To and Copy boxes of the next email on that project.

import { store } from '../core/store.js';
import { uid, todayISO } from '../core/util.js';
import { resolveOne, phoneDigits } from '../engine/contacts.js';
import { html } from './dom.js';

let search = '';
let notice = '';

const all = c => c.company.contacts || [];
const projectName = id => store.projects.find(p => p.id === id)?.name || '';
const chips = (c, ids, label) => (ids || []).map(projectName).filter(Boolean).map(n => html`<span class="chip">${label}: ${n}</span> `);

export function render(c) {
  const q = search.trim().toLowerCase();
  const list = [...all(c)]
    .filter(x => !q || [x.name, x.email, x.phone, x.company].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return html`
    <section class="card">
      <div class="toolbar"><h2>Contacts</h2><span class="muted">${all(c).length} saved</span><span class="grow"></span>
        <input class="search" type="search" data-chg="search" data-fk="ct-search" value="${search}" placeholder="Search name, email, phone" aria-label="Search contacts"></div>
      <form data-form="add" class="entry">
        <input name="name" placeholder="Name" required aria-label="Name" class="wide">
        <input name="email" placeholder="Email (just the name is enough: @gmail.com is added)" aria-label="Email" class="wide">
        <input name="phone" placeholder="Phone, for WhatsApp and Telegram" aria-label="Phone" class="wide">
        <input name="company" placeholder="Company" aria-label="Company" class="wide">
        <button class="btn primary">Save contact</button>
      </form>
      ${notice ? html`<p class="${/^✗/.test(notice) ? 'bad' : 'ok'}">${notice}</p>` : ''}
      ${list.length ? html`<table class="table compact">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Documents of these projects go to them</th><th></th></tr></thead>
        <tbody>${list.map(x => html`<tr>
          <td><input data-chg="field" data-id="${x.id}" data-f="name" data-fk="cn-${x.id}" value="${x.name || ''}" aria-label="Name"></td>
          <td><input data-chg="field" data-id="${x.id}" data-f="email" data-fk="ce-${x.id}" value="${x.email || ''}" aria-label="Email"></td>
          <td><input data-chg="field" data-id="${x.id}" data-f="phone" data-fk="cp-${x.id}" value="${x.phone || ''}" aria-label="Phone" title="${phoneDigits(x.phone) ? `WhatsApp number ${phoneDigits(x.phone)}` : 'Not a number WhatsApp can use yet'}"></td>
          <td><input data-chg="field" data-id="${x.id}" data-f="company" data-fk="cc-${x.id}" value="${x.company || ''}" aria-label="Company"></td>
          <td class="muted">${chips(c, x.to, 'To')}${chips(c, x.cc, 'Copy')}</td>
          <td class="r"><button class="btn ghost small" data-act="removeContact" data-id="${x.id}">Remove</button></td></tr>`)}</tbody>
      </table>` : html`<p class="empty">${all(c).length ? 'Nobody matches.' : 'No contacts yet. Save one above, or send an email: the people it goes to are saved for you.'}</p>`}
      <p class="muted">Typing only a name in the To or Copy box of an email finds the saved address; typing a plain word like "melaku" makes melaku@gmail.com. Phone numbers beginning with 0 are taken as Ethiopian (+251) unless written with + or 00.</p>
    </section>`;
}

export const actions = {
  removeContact(el, c) {
    const x = all(c).find(k => k.id === el.dataset.id);
    if (!x || !confirm(`Remove ${x.name || x.email} from the contacts?`)) return;
    store.updateCompany(co => { co.contacts = (co.contacts || []).filter(k => k.id !== x.id); });
  },
};

export const changes = {
  search(el) { search = el.value; },
  field(el) {
    const f = el.dataset.f;
    let value = el.value.trim();
    if (f === 'email') value = resolveOne(value, []);
    if (f === 'name' && !value) { store.notify(); return; }
    store.updateCompany(co => { const x = (co.contacts || []).find(k => k.id === el.dataset.id); if (x) x[f] = value; });
  },
};

export const submits = {
  add(fd, c) {
    const name = String(fd.get('name') || '').trim();
    const email = resolveOne(fd.get('email') || name, []);
    if (!name) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { notice = '✗ That is not an email address.'; return false; }
    if (all(c).some(x => String(x.email).toLowerCase() === email)) { notice = `✗ ${email} is already saved.`; return false; }
    store.updateCompany(co => { (co.contacts ||= []).push({ id: uid('ct'), name, email, phone: String(fd.get('phone') || '').trim(), company: String(fd.get('company') || '').trim(), to: [], cc: [], used: todayISO() }); });
    notice = `${name} saved.`;
  },
};
