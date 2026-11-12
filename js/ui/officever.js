// v0.55.0 (Phase C, 20b part 2): the office corrects a Field Report report on the approval page. What it changed
// becomes an office version: the record in projects/<id>/fieldReports/<date> gets the next version number with who,
// when and the list of changes, and the record it replaces is kept in projects/<id>/fieldVersions/<date>_v<n>, never
// deleted. The PDF keeps the site's text (owner, 2 Nov): weather and photo changes go into it; crew and progress
// corrections change Central Hub's figures and are only listed. Photos added from the gallery (Central Hub only) go
// to the report's Drive folder and are flagged "From gallery" on the report page and in the PDF.

import { html } from './dom.js';
import { photoList } from './photos.js';
import { pictureFor, PASSPORT } from '../core/image.js';
import { fieldPhotoPut, reviewFieldReport } from '../sync/fieldreport.js';
import { WEATHER } from '../fr/model/report.js';
import { store } from '../core/store.js';

export const GALLERY = 'From gallery';
/** Field Report's weather words: an office correction of a site report uses the same list, so its PDF picture fits. */
export const FR_WEATHER = WEATHER;

const drafts = new Map();   // report id -> { cap: { photoId: text }, gone: [photoId], added: [{ id, data, cap }] }
export const draftOf = id => { if (!drafts.has(id)) drafts.set(id, { cap: {}, gone: [], added: [] }); return drafts.get(id); };
export const dropDraft = id => drafts.delete(id);
const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const capOf = p => p.caption || '';
const tradeCount = list => new Map((list || []).map(m => [m.trade, Number(m.count) || 0]));

/** What the office changed, in words: for the version, its list and the site's notification. */
export function changeList(cur, { weather, manpower = [], entries = [], reported = {}, taskName = id => id, draft = { cap: {}, gone: [], added: [] } }) {
  const out = [];
  if (weather && weather !== (cur.weather || '')) out.push(`Weather: ${cur.weather || 'none'} to ${weather}`);
  const was = tradeCount(cur.manpower), now = tradeCount(manpower);
  for (const t of new Set([...was.keys(), ...now.keys()])) if ((was.get(t) || 0) !== (now.get(t) || 0)) out.push(`Crew, ${t}: ${was.get(t) || 0} to ${now.get(t) || 0}`);
  for (const e of entries) {
    const site = reported[e.taskId]?.pct;
    if (e.progress != null && site != null && Number(site) !== e.progress) out.push(`Progress, ${taskName(e.taskId)}: ${site} % to ${e.progress} %`);
  }
  const photos = photoList(cur);
  for (const p of photos) {
    if (draft.gone.includes(p.id)) out.push(`Photo removed: ${capOf(p) || p.id}`);
    else if (draft.cap[p.id] != null && draft.cap[p.id] !== capOf(p)) out.push(`Photo caption: ${capOf(p) || 'none'} to ${draft.cap[p.id] || 'none'}`);
  }
  if (draft.added.length) out.push(`${draft.added.length} photo${draft.added.length === 1 ? '' : 's'} added from the gallery`);
  return out;
}

/** The caption a gallery photo carries in the PDF and on the report page. */
export const galleryCap = cap => [cap, GALLERY].filter(Boolean).join(' · ');

/** The report page's photo list after the office's edits (Field Report's photoFiles). */
export const photosAfter = (list = [], draft) => [
  ...list.filter(p => !draft.gone.includes(p.id)).map(p => (draft.cap[p.id] != null ? { ...p, caption: draft.cap[p.id] } : p)),
  ...draft.added.map(p => ({ id: p.id, caption: p.cap || '', gallery: true })),
];

/** The whole report (Field Report 2.23.0's `full`) with the office's weather and photo changes. Crew and progress stay. */
export function officeFull(full, { weather, draft, at }) {
  const r = structuredClone(full.r);
  if (weather && FR_WEATHER.includes(weather)) r.start = { ...(r.start || {}), cond: weather };
  r.photos = [
    ...(r.photos || []).filter(p => !draft.gone.includes(p.id)).map(p => (draft.cap[p.id] != null ? { ...p, caption: draft.cap[p.id] } : p)),
    ...draft.added.map(p => ({ id: p.id, at, caption: p.cap || '', gallery: true })),   // v1.55.0: the flag only; the PDF labels the office copy
  ];
  return { ...full, r };
}

/** The versions to list under the PDF: every one the office recorded, except the one shown now. */
export const olderVersions = r => (r.versions || []).filter(v => v.v !== r.field?.office?.v).sort((a, b) => b.v - a.v);

/**
 * Save the office version: gallery photos to Drive, the record replaced kept, the new one written, and the site told
 * (script 7.42.0, decision 'office'). Returns { v, entry } for the report kept here.
 */
export async function saveOfficeVersion({ pid, code, cur, changes, draft, weather, who }) {
  const name = cur.field.pdf, at = new Date().toISOString();
  for (const p of draft.added) await fieldPhotoPut(code, name, p.id, p.data);
  const path = `projects/${pid}/fieldReports/${cur.date}`, rec = await store.getDoc(path).catch(() => null);
  const office = { by: who.name, email: who.email, at, changes };
  let v = 0, before = null;
  if (rec) {
    before = { v: rec.version || 1, by: rec.office?.by || rec.byName || cur.by || 'Site', at: rec.office?.at || rec.at || '', office: !!rec.office };
    v = before.v + 1;
    await store.setDoc(`projects/${pid}/fieldVersions/${cur.date}_v${before.v}`, { ...rec, id: `${cur.date}_v${before.v}`, keptAt: at });
    await store.setDoc(path, { ...rec, version: v, office, ...(rec.full?.r ? { full: officeFull(rec.full, { weather, draft, at }) } : {}) });
  }
  await reviewFieldReport({ name, decision: 'office', text: changes.join('; ').slice(0, 400) });
  return { v, before, office: { ...office, v } };
}

/** The photos of the report under review, each with its caption to change and Remove, and Add from gallery. */
export function photoEditor(cur) {
  const d = draftOf(cur.id), list = photoList(cur);
  const row = p => html`<li class="row"><span class="row-main"><span>${p.time || ''} ${p.zone || ''} ${p.task || ''}</span>
    <input data-chg="phCap" data-id="${cur.id}" data-p="${p.id}" value="${d.cap[p.id] ?? capOf(p)}" placeholder="Caption" aria-label="Caption" ${d.gone.includes(p.id) ? 'disabled' : ''}></span>
    <label class="check"><input type="checkbox" data-chg="phDrop" data-id="${cur.id}" data-p="${p.id}" ${d.gone.includes(p.id) ? 'checked' : ''}> Remove</label></li>`;
  const added = p => html`<li class="row"><img class="ph-thumb" src="${p.data}" alt=""><span class="row-main">
    <input data-chg="phAddCap" data-id="${cur.id}" data-p="${p.id}" value="${p.cap}" placeholder="Caption" aria-label="Caption"><span class="chip info">${GALLERY}</span></span>
    <button type="button" class="btn ghost small" data-act="phUnadd" data-id="${cur.id}" data-p="${p.id}">Take out</button></li>`;
  return html`<h3>Photos</h3><p class="muted">Change a caption, remove a photo or add photos from the gallery. They go into the report's PDF as a new office version; a gallery photo is marked "${GALLERY}".</p>
    ${list.length || d.added.length ? html`<ul class="list">${list.map(row)}${d.added.map(added)}</ul>` : ''}
    <label class="btn small">Add from gallery <input type="file" accept="image/*" multiple hidden data-chg="phAdd" data-id="${cur.id}"></label>`;
}

/** The changes of the photo editor (spread into the page's `changes`). */
export const photoChanges = {
  phCap(el) { draftOf(el.dataset.id).cap[el.dataset.p] = el.value.trim(); },
  phDrop(el) { const d = draftOf(el.dataset.id); d.gone = d.gone.filter(x => x !== el.dataset.p).concat(el.checked ? [el.dataset.p] : []); },
  phAddCap(el) { const p = draftOf(el.dataset.id).added.find(x => x.id === el.dataset.p); if (p) p.cap = el.value.trim(); },
  async phAdd(el) {
    const d = draftOf(el.dataset.id);
    for (const f of el.files || []) {
      const pic = await pictureFor(f, PASSPORT).catch(() => null);
      if (pic && /^data:image\/jpeg/.test(pic.dataUrl)) d.added.push({ id: newId(), data: pic.dataUrl, cap: '' });
      else if (pic) d.added.push({ id: newId(), data: await asJpeg(pic.dataUrl), cap: '' });
    }
    el.value = '';
    store.notify();
  },
};
export const photoActions = {
  phUnadd(el) { const d = draftOf(el.dataset.id); d.added = d.added.filter(x => x.id !== el.dataset.p); },
};

/** A PNG kept small by pictureFor, drawn again as JPEG (Field Report's Drive keeps JPEG only). */
const asJpeg = src => new Promise(ok => {
  const i = new Image();
  i.onload = () => { const cv = document.createElement('canvas'); cv.width = i.naturalWidth; cv.height = i.naturalHeight; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(i, 0, 0); ok(cv.toDataURL('image/jpeg', 0.85)); };
  i.onerror = () => ok(src);
  i.src = src;
});
