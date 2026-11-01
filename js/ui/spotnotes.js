// Spotlight notes written in Central Hub (v0.49.0, Phase B5c; engine/spotlight.js). The list with its filters sits on
// the Spotlight page above Field Report's notes; the person note is written from Evaluation, the project update from
// the Overview. Handlers are spread into the maps of those pages.

import { store } from '../core/store.js';
import { uid, fmtDate } from '../core/util.js';
import { html, options } from './dom.js';
import { pictureFor, PHOTO, tell } from '../core/image.js';
import { SPOT_CATS, SPOT_TOPICS, catLabel, topicLabel, checkSpot, editable, spotFilter } from '../engine/spotlight.js';

const f = { kind: '', person: '', project: '', tone: '', from: '', to: '' };
let editing = null;   // id of the note being changed (24 hours)
const me = () => ({ email: (store.user?.email || '').toLowerCase(), name: store.profile?.name || store.user?.name || 'Admin' });

/** The notes of Central Hub, filtered, with Field Report's (already in the same shape) after them. */
export function hubNotes(c, fieldNotes = []) {
  const all = [...(c.company.spotlight || []), ...fieldNotes];
  const pick = k => [...new Set(all.map(n => n[k]).filter(Boolean))].sort();
  const rows = spotFilter(all, f);
  const pos = rows.filter(n => n.tone === 'positive').length, neg = rows.filter(n => n.tone === 'negative').length;
  const card = n => html`<article class="spot-card ${n.kind === 'project' ? '' : n.tone === 'positive' ? 'pos' : 'neg'}">
      <header><div><b>${n.byName || n.by}</b><span class="muted">${fmtDate(n.date)} ${String(n.at || '').slice(11, 16)}${n.from ? ` · ${n.from}` : ''}</span></div>
        <span class="spot-tone">${n.kind === 'project' ? 'Project update' : n.tone === 'positive' ? 'Positive' : 'Negative'}</span></header>
      <div class="spot-tags"><span>${n.kind === 'project' ? topicLabel(n.topic) : catLabel(n.category)}</span><span>${n.kind === 'project' ? n.projectName : n.subjectName}</span></div>
      ${editing === n.id ? html`<form data-form="spotEdit" class="entry"><textarea name="note" rows="3" class="wide">${n.note}</textarea><button class="btn small primary">Save</button></form>` : html`<p class="spot-note">${n.note}</p>`}
      ${n.photo ? html`<div class="spot-media"><img src="${n.photo}" alt="Photo with the note"></div>` : ''}
      <div class="actions left">
        ${!n.from && n.by === me().email && editable(n) && editing !== n.id ? html`<button type="button" class="btn ghost small" data-act="spotEditOn" data-id="${n.id}">Change (24 h)</button>` : ''}
        ${!n.from && n.kind === 'project' && !n.seenAt && store.isAdmin ? html`<button type="button" class="btn small" data-act="spotSeen" data-id="${n.id}">Seen</button>` : ''}
        ${!n.from && store.isAdmin ? html`<button type="button" class="btn ghost small" data-act="spotDrop" data-id="${n.id}">Delete</button>` : ''}</div></article>`;
  return html`<section class="card spot-page"><div class="card-head"><h2>Spotlight</h2><span class="muted">Notes about people (seen by the writer, HR and the Admin only) and project updates. Never in the daily report.</span></div>
    <div class="spot-kpis"><div><b>${rows.length}</b><span>Notes</span></div><div class="pos"><b>${pos}</b><span>Positive</span></div><div class="neg"><b>${neg}</b><span>Negative</span></div><div><b>${rows.filter(n => n.kind === 'project').length}</b><span>Project updates</span></div></div>
    <div class="toolbar">
      <select data-chg="spotF" data-f="kind" aria-label="Kind">${options([['', 'Both kinds'], ['person', 'About a person'], ['project', 'Project updates']], f.kind)}</select>
      <select data-chg="spotF" data-f="person" aria-label="Person">${options([['', 'Everyone'], ...pick('subjectName').map(x => [x, x])], f.person)}</select>
      <select data-chg="spotF" data-f="project" aria-label="Project">${options([['', 'Every project'], ...pick('projectName').map(x => [x, x])], f.project)}</select>
      <select data-chg="spotF" data-f="tone" aria-label="Positive or negative">${options([['', 'Positive and negative'], ['positive', 'Positive'], ['negative', 'Negative']], f.tone)}</select>
      <label>From <input type="date" data-chg="spotF" data-f="from" value="${f.from}"></label><label>To <input type="date" data-chg="spotF" data-f="to" value="${f.to}"></label>
    </div>
    ${rows.length ? html`<div class="spot-grid">${rows.map(card)}</div>` : html`<p class="empty">No note here.</p>`}</section>`;
}

/** The note about a person, from Evaluation (the person is one the writer may rate). */
export const personForm = (m, project) => html`<section class="card">
    <div class="toolbar"><h2>Spotlight note about ${m.name}</h2><button class="btn ghost small" data-act="close">Close</button></div>
    <form data-form="spotPerson" class="star-form" data-id="${m.id}">
      <div class="grid2">
        <label>Project <input value="${project.name}" disabled></label>
        <label>Positive or negative <select name="tone" required>${options([['', 'Choose…'], ['positive', 'Positive'], ['negative', 'Negative']], '')}</select></label>
        <label>Category <select name="category" required>${options([['', 'Choose…'], ...SPOT_CATS], '')}</select></label>
        <label>Photo (optional) <input type="file" name="photo" accept="image/*" capture="environment"></label>
      </div>
      <label>Note <textarea name="note" rows="3" required placeholder="What happened"></textarea></label>
      <p class="muted">The date is today. ${m.name} never sees this note; it is evidence in their evaluation.</p>
      <div class="actions left"><button class="btn primary">Save the note</button></div>
    </form></section>`;

/** The project update or alert, from the Overview (anyone on the project). */
export const projectForm = () => html`<details class="setup"><summary>+ Send a project update or alert to HR and the Admin</summary>
    <form data-form="spotProject" class="entry">
      <select name="topic" required aria-label="Topic">${options([['', 'Topic…'], ...SPOT_TOPICS], '')}</select>
      <input name="note" class="wide" required placeholder="What should HR and the Admin know?" aria-label="Update">
      <input type="file" name="photo" accept="image/*" capture="environment" aria-label="Camera photo (optional)">
      <button class="btn primary">Send</button>
    </form></details>`;

function save(rec, file) {
  const problems = checkSpot(rec);
  if (problems.length) { tell(problems.join(' ')); return false; }
  const push = photo => store.updateCompany(co => { (co.spotlight ||= []).push(photo ? { ...rec, photo } : rec); });
  if (file && file.size) pictureFor(file, PHOTO).then(r => push(r.dataUrl), e => { tell(`Saved without the photo: ${e.message || e}`); push(''); });
  else push('');
  tell('✓ Spotlight note saved.');
}
const base = (c, kind) => ({ id: uid('sp'), kind, projectId: c.project.id, projectName: c.project.name, by: me().email, byName: me().name, at: new Date().toISOString(), date: c.today });

export const submits = {
  spotProject(fd, c) {
    if (save({ ...base(c, 'project'), topic: String(fd.get('topic') || ''), note: String(fd.get('note') || '').trim() }, fd.get('photo')) === false) return false;
  },
  spotEdit(fd) {
    const note = String(fd.get('note') || '').trim();
    if (note) store.updateCompany(co => { const n = (co.spotlight || []).find(x => x.id === editing); if (n && editable(n)) { n.note = note; n.editedAt = new Date().toISOString(); } });
    editing = null;
  },
};
/** The person note: `m` is the team member chosen on the Evaluation page, with `level` and `emailOf` from there. */
export function savePerson(fd, c, m, level, email) {
  return save({ ...base(c, 'person'), subjectId: m.id, subjectPersonId: m.personId || '', subjectName: m.name, subjectEmail: email, level,
    tone: String(fd.get('tone') || ''), category: String(fd.get('category') || ''), note: String(fd.get('note') || '').trim() }, fd.get('photo'));
}

export const actions = {
  spotEditOn(el) { editing = el.dataset.id; },
  spotSeen(el) { store.updateCompany(co => { const n = (co.spotlight || []).find(x => x.id === el.dataset.id); if (n) n.seenAt = new Date().toISOString(); }); },
  spotDrop(el) { if (confirm('Delete this Spotlight note? It cannot be brought back.')) store.updateCompany(co => { co.spotlight = (co.spotlight || []).filter(x => x.id !== el.dataset.id); }); },
};
export const changes = { spotF(el) { f[el.dataset.f] = el.value; } };
