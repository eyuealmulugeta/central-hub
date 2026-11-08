// v0.33.0: Crew forms (People). A General Manager, Project Engineer or Site Engineer (anyone holding a rank) and the
// Admin make links; a person fills in their own form from it (crew.html), reading their Fayda ID or passport. The Admin
// reviews each form and accepts it as an employee (Employee data), on the link's project; the crew pool shows the crew
// by nationality. Forms and links: company/main/crewforms and crewlinks (see engine/crewform.js and firestore.rules).

import { store } from '../core/store.js';
import { html, options, chip } from './dom.js';
import { linkTrades } from '../engine/positions.js';
import { uid } from '../core/util.js';
import { stamp } from '../core/division.js';
import { tell } from '../core/image.js';
import { assign } from '../engine/people.js';
import { makeLink, linkUrl, linkState, staffFromForm, sameStaff, crewPool, reopenLink } from '../engine/crewform.js';

/** v0.46.0: open this page on Forms to review (from the Manpower Directory). */
export const openReview = () => { tab = 'review'; };
import { sendMail, mailReady, mailtoLink } from '../sync/mail.js';

let tab = 'links';
let draft = { kind: 'one', name: '', email: '', projectId: undefined };   // '' = No project yet (v0.59.1)
let made = [];          // the links made on this computer this session (people who are not the Admin do not load the list)
let poolNat = '', poolFree = false, open = '', editing = '';
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const base = () => (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? `${location.origin}/` : 'https://hub.amistadprefab.com/');
const urlOf = l => `${linkUrl(l.id, base())}${store.cloud ? '' : '&local'}`;

export function render(c) {
  const admin = store.isAdmin;
  const forms = (c.company.crewforms || []).filter(f => f.status === 'new');
  const tabs = [['links', 'Links'], ...(admin ? [['review', 'Forms to review', forms.length], ['pool', 'Crew pool']] : [])];
  if (!tabs.some(([k]) => k === tab)) tab = 'links';
  return html`<section class="card">
    <div class="toolbar"><h2>Crew forms</h2><span class="muted">A link lets a person fill in their own details from their Fayda ID or passport; the Admin accepts the form as an employee.</span></div>
    <div class="tabs" role="tablist">${tabs.map(([k, t, n]) => html`<button type="button" role="tab" class="tab ${tab === k ? 'on' : ''}" data-act="cfTab" data-t="${k}" aria-selected="${tab === k}">${t}${n ? html` <span class="chip high">${n}</span>` : ''}</button>`)}</div>
    ${tab === 'review' ? review(c, forms) : tab === 'pool' ? pool(c) : links(c)}
  </section>`;
}

function links(c) {
  const projects = store.projects.filter(p => !p.binned);
  const pid = draft.projectId ?? (c.project?.id || '');
  const list = store.isAdmin ? [...(c.company.crewlinks || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30) : made;
  return html`<div class="grid2">
      <label>Kind <select data-chg="cfSet" data-f="kind">${options([['one', 'One person (by email or message)'], ['crew', 'Crew link: as many people as come, 3 days']], draft.kind)}</select></label>
      <label>Project <select data-chg="cfSet" data-f="projectId">${options([['', 'No project yet'], ...projects.map(p => [p.id, p.name])], pid)}</select></label>
      ${draft.kind === 'one' ? html`<label>Name <input data-chg="cfSet" data-f="name" value="${draft.name}" placeholder="Who fills it in"></label>
      <label>Email (optional) <input type="email" data-chg="cfSet" data-f="email" value="${draft.email}" placeholder="name@example.com"></label>` : ''}
    </div>
    <div class="actions left"><button class="btn primary" type="button" data-act="cfMake">Make the link</button></div>
    <p class="muted">A one-person link takes one form and runs out after 7 days; a crew link takes as many forms as come for 3 days. Send it by email, WhatsApp or Telegram. People fill it in on their phone without signing in.</p>
    ${list.length ? html`<h4>Links</h4><ul class="list">${list.map(l => linkRow(l))}</ul>` : ''}`;
}

function linkRow(l) {
  const why = linkState(l);
  return html`<li class="cf-link"><div><b>${l.kind === 'site' ? 'Site form (Field Report)' : l.kind === 'crew' ? 'Crew link' : l.name || 'One person'}</b> <span class="muted">${l.projectName || 'no project'} · by ${l.byName || l.by || ''} · ${when(l.at)} · until ${when(l.untilMs)}</span>
      ${why ? chip(l.status === 'open' ? 'Run out' : 'Closed', 'warn') : chip('Open', 'ok')}<br><code class="cf-url">${urlOf(l)}</code></div>
    ${why ? '' : html`<div class="actions left"><button class="btn small" type="button" data-act="cfCopy" data-id="${l.id}">Copy</button>
      <button class="btn small" type="button" data-act="cfShare" data-id="${l.id}" title="WhatsApp, Telegram or another app">Share</button>
      ${l.email ? html`<button class="btn small" type="button" data-act="cfMail" data-id="${l.id}">Email to ${l.email}</button>` : ''}
      ${store.isAdmin ? html`<button class="btn small ghost" type="button" data-act="cfClose" data-id="${l.id}">Close</button>` : ''}</div>`}</li>`;
}

const img = (src, alt, cls = '') => (src ? html`<a href="${src}" target="_blank" rel="noopener"><img class="cf-img ${cls}" src="${src}" alt="${alt}"></a>` : '');
function review(c, forms) {
  if (!forms.length) return html`<p class="empty">No form is waiting.</p>`;
  const linkOf = f => (c.company.crewlinks || []).find(l => l.id === f.link);
  return html`<ul class="list">${forms.map(f => {
    const l = linkOf(f), same = sameStaff(c.company.staff || [], f);
    const ed = editing === f.id;
    const facts = (ed ? EDIT_FIELDS(f) : EDIT_FIELDS(f).filter(([, k]) => f[k])).map(([t, k, type]) => [t, ed ? html`<input type="${type || 'text'}" data-chg="cfEdit" data-id="${f.id}" data-f="${k}" value="${f[k] || ''}">` : f[k]]);
    return html`<li class="cf-form"><div class="cf-pics">${img(f.photo, 'Photo', 'face')}${img(f.idFront, f.doc === 'id' ? 'ID, front' : 'Fayda ID, front')}${img(f.idBack, f.doc === 'id' ? 'ID, back' : 'Fayda ID, back')}${img(f.passportImage, 'Passport')}</div>
      <div>${ed ? html`<label>Name <input data-chg="cfEdit" data-id="${f.id}" data-f="name" value="${f.name}"></label>` : html`<b>${f.name}</b>`} <span class="muted">${f.doc === 'passport' ? 'Passport' : f.doc === 'id' ? 'ID card' : 'Fayda ID'}${f.nationality ? ` · ${f.nationality}` : ''} · sent ${when(f.at)} · ${l ? `${l.kind === 'site' ? 'site form' : l.kind === 'crew' ? 'crew link' : 'link'} of ${l.byName || l.by}${l.projectName ? `, for ${l.projectName}` : ''}` : 'link not found'}</span>
        ${same ? html`<p class="callout warn small"><b>!</b> <span>${same.name} is already in Employee data: Accept fills in only what that record lacks.</span></p>` : ''}
        <table class="table compact"><tbody>${facts.map(([k, v]) => html`<tr><th>${k}</th><td>${v}</td></tr>`)}</tbody></table>
        <div class="actions left"><button class="btn small primary" type="button" data-act="cfAccept" data-id="${f.id}">Accept${l?.projectName ? ` and put on ${l.projectName}` : ''}</button>
          ${l?.projectName ? html`<button class="btn small" type="button" data-act="cfAccept" data-id="${f.id}" data-pool="1" title="Into Employee data and the crew pool, on no project">Add to pool</button>` : ''}
          <button class="btn small" type="button" data-act="cfEditOn" data-id="${f.id}">${ed ? 'Done editing' : 'Edit'}</button>
          ${l ? html`<button class="btn small" type="button" data-act="cfChanges" data-id="${f.id}" title="The link opens again for 7 days with your note; the person sends the form again">Ask for changes</button>` : ''}
          <button class="btn small ghost" type="button" data-act="cfReject" data-id="${f.id}">Reject</button></div></div></li>`;
  })}</ul>`;
}

/** v0.34.0: the details the Admin may correct before accepting: [label, field, input type]. */
const EDIT_FIELDS = f => [['Trade', 'trade'], ['Phone', 'phone', 'tel'], ['Gender', 'gender'], ['Date of birth', 'birthday', 'date'], ['Nationality', 'nationality'],
  ...(f.doc === 'passport' ? [['Passport No.', 'passportNumber'], ['Expiry', 'passportExpiry', 'date']] : f.doc === 'id' ? [['ID No.', 'idNumber'], ['Expiry', 'idExpiry', 'date']] : [['Fayda No. (FAN)', 'idNumber'], ['FIN', 'fin'], ['Expiry', 'idExpiry', 'date']]),   // v1.15.0: another country's ID card
  ['Address', 'address'], ['Emergency contact', 'emergency'], ['Emergency phone', 'emergencyPhone', 'tel'], ['Certificate', 'certificate']];

function pool(c) {
  const groups = crewPool(c.company.staff || [], store.projects);
  const shown = groups.filter(g => !poolNat || g.nationality === poolNat)
    .map(g => ({ ...g, people: g.people.filter(p => !poolFree || p.free) })).filter(g => g.people.length);
  return html`<div class="actions left">
      <label>Nationality <select data-chg="cfPool" data-f="nat">${options([['', `All (${groups.reduce((n, g) => n + g.people.length, 0)})`], ...groups.map(g => [g.nationality, `${g.nationality} (${g.people.length})`])], poolNat)}</select></label>
      <label class="inline"><input type="checkbox" data-chg="cfPool" data-f="free" ${poolFree ? 'checked' : ''}> Only those on no project</label></div>
    <p class="muted">The crew in Employee data, by nationality. Put a person on a project under Settings, This project, Allocated Crew.</p>
    ${shown.length ? shown.map(g => html`<h4>${g.nationality} <span class="muted">${g.people.length} · ${g.free} on no project</span></h4>
      <table class="table compact"><thead><tr><th></th><th>Name</th><th>Trade</th><th>On</th></tr></thead>
      <tbody>${g.people.map(p => html`<tr><td>${p.photo ? html`<img class="cf-face" src="${p.photo}" alt="">` : ''}</td><td><b>${p.name}</b></td><td>${p.trade}</td><td>${p.free ? chip('Free', 'ok') : p.on.join(', ')}</td></tr>`)}</tbody></table>`)
      : html`<p class="empty">Nobody here yet.</p>`}`;
}

const findLink = (c, id) => (c.company.crewlinks || []).find(l => l.id === id) || made.find(l => l.id === id);
const message = l => `Hello${l.name ? ` ${l.name}` : ''},\n\nPlease fill in your details for Amistad Prefab with this link. Choose your country, then take pictures of your ID (the Fayda ID for Ethiopians, otherwise your country's ID card or passport) and of yourself; the numbers are read from the ID.\n\n${urlOf(l)}\n\nThe link works until ${new Date(l.untilMs).toLocaleDateString([], { day: 'numeric', month: 'long' })}.\n\n${store.signature || 'Amistad Prefab'}`;

export const changes = {
  cfSet(el) { draft[el.dataset.f] = el.value; store.notify(); },
  cfPool(el) { if (el.dataset.f === 'nat') poolNat = el.value; else poolFree = el.checked; store.notify(); },
  cfEdit(el) { store.updateCompany(co => { const f = (co.crewforms || []).find(x => x.id === el.dataset.id); if (f) f[el.dataset.f] = el.value.trim().slice(0, 300); }); },
};

export const actions = {
  cfTab(el) { tab = el.dataset.t; },
  cfEditOn(el) { editing = editing === el.dataset.id ? '' : el.dataset.id; },
  async cfMake(el, c) {
    const pid = draft.projectId ?? (c.project?.id || '');
    const project = store.projects.find(p => p.id === pid);
    if (draft.kind === 'one' && !draft.name.trim()) return tell('Write the name of the person the link is for.');
    if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) return tell('That email address does not look right.');
    const l = makeLink({ ...draft, trades: linkTrades(), projectId: project?.id || '', projectName: project?.name || '', by: store.user?.email || 'local', byName: store.signature || store.user?.name || '' });
    try {
      if (store.isAdmin || !store.cloud) store.updateCompany(co => { (co.crewlinks ||= []).push(l); });
      else await store.cloudPut(`company/main/crewlinks/${l.id}`, l);
      made = [l, ...made];
      draft = { kind: draft.kind, name: '', email: '', projectId: draft.projectId };
      tell(`✓ Link made${l.email ? '. Email it with the button.' : '. Copy or share it.'}`);
    } catch (err) { tell(`✗ The link was not made: ${err.message}`); }
    store.notify();
  },
  async cfCopy(el, c) {
    const l = findLink(c, el.dataset.id);
    try { await navigator.clipboard.writeText(urlOf(l)); tell('✓ Link copied.'); } catch { tell('Select the link and copy it.'); }
  },
  async cfShare(el, c) {
    const l = findLink(c, el.dataset.id);
    if (navigator.share) { try { await navigator.share({ title: 'Crew form · Amistad Prefab', text: message(l) }); } catch { /* closed */ } return; }
    open = `https://wa.me/?text=${encodeURIComponent(message(l))}`;
    window.open(open, '_blank', 'noopener');
  },
  async cfMail(el, c) {
    const l = findLink(c, el.dataset.id);
    const mail = { to: l.email, subject: 'Your crew form · Amistad Prefab', message: message(l) };
    if (!mailReady()) { location.href = mailtoLink(mail); return; }
    try { await sendMail(mail); tell(`✓ Emailed to ${l.email}.`); } catch (err) { tell(`✗ Not emailed: ${err.message}`); }
  },
  cfClose(el) {
    if (!confirm('Close this link? Nobody can send a form with it after that.')) return;
    store.updateCompany(co => { const l = (co.crewlinks || []).find(x => x.id === el.dataset.id); if (l) l.status = 'closed'; });
  },
  /** v0.46.0: the person is asked to send the form again, with a note; this form is set aside. */
  cfChanges(el, c) {
    const f = (c.company.crewforms || []).find(x => x.id === el.dataset.id);
    const l = f && (c.company.crewlinks || []).find(x => x.id === f.link);
    if (!f || !l) return;
    const note = (typeof prompt === 'function' ? prompt(`What should ${f.name} change? This note is shown on their form.`) : '') || '';
    if (!note.trim()) return;
    store.updateCompany(co => {
      co.crewlinks = (co.crewlinks || []).map(x => (x.id === l.id ? reopenLink(x, note) : x));
      co.crewforms = (co.crewforms || []).filter(x => x.id !== f.id);
    });
    tell(`✓ The link of ${f.name} is open again for 7 days with your note. Send it to them again.`);
  },
  cfReject(el, c) {
    const f = (c.company.crewforms || []).find(x => x.id === el.dataset.id);
    if (!f || !confirm(`Reject the form of ${f.name}? It is deleted.`)) return;
    store.updateCompany(co => { co.crewforms = (co.crewforms || []).filter(x => x.id !== f.id); });
    tell(`Rejected: ${f.name}.`);
  },
  async cfAccept(el, c) {
    const f = (c.company.crewforms || []).find(x => x.id === el.dataset.id);
    if (!f) return;
    const l = (c.company.crewlinks || []).find(x => x.id === f.link) || null;
    const project = l?.projectId && !el.dataset.pool ? store.projects.find(p => p.id === l.projectId && !p.binned) : null;   // Add to pool: on no project
    let person = null, a = null;
    store.updateCompany(co => {
      const old = sameStaff(co.staff, f);
      person = staffFromForm(f, { link: l, today: c.today, newId: uid, stampOf: stamp, existing: old });
      if (project) {
        a = { ...((person.assignments || []).find(y => y.projectId === project.id) || { projectId: project.id, role: person.title || '', dayRate: 0 }), active: true };
        person.assignments = [...(person.assignments || []).filter(y => y.projectId !== project.id), a];
      }
      if (old) Object.assign(old, person); else co.staff.push(person);
      co.crewforms = (co.crewforms || []).filter(x => x.id !== f.id);   // the pictures now live on the employee record
    });
    if (editing === f.id) editing = '';
    if (!project) return tell(`✓ ${person.name} is in Employee data${el.dataset.pool ? ' and the crew pool' : ''}.`);
    try {
      const ws = await store.updateOther(project.id, w => { assign(w, person, a); });
      const ok = await (await import('./reports.js')).sendListsFor(project, ws);
      tell(`✓ ${person.name} is in Employee data and on ${project.name}${ok === true ? '; Field Report has the new crew.' : '.'}`);
    } catch (err) { tell(`${person.name} is in Employee data, but was not put on ${project.name}: ${err.message}`); }
  },
};
