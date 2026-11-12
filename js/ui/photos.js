// v0.23.1: the site photos of a Field Report report, kept in Drive by Field Report 2.1.0 (report file field photoFiles,
// script 7.31.0). They are read through the server (fieldAction photoGet, office people only), once per session, and
// filled in after the page is drawn. In the local demo a drawn sample stands in for each photo.

import { clientIds, CLIENT_PHOTOS } from '../fr/model/pdfplan.js';   // v1.59.0
import { html } from './dom.js';
import { fieldPhoto, fieldVideo, fieldReady } from '../sync/fieldreport.js';
import { store } from '../core/store.js';

const cache = new Map();   // "size|proj|report|id" -> Promise<object URL, or '' when it could not be read>
// v1.25.0 (owner, 8 Nov: photos load quickly): each picture is kept in this browser (Cache Storage), so a day, a
// project or a page seen before shows at once and is not downloaded again
const SHELF = 'site-photos-v1';
const shelfKey = k => `/__photo/${k.split('|').map(encodeURIComponent).join('/')}`;
async function fromShelf(k) {
  try { const r = await (await caches.open(SHELF)).match(shelfKey(k)); return r ? URL.createObjectURL(await r.blob()) : ''; } catch { return ''; }
}
async function toShelf(k, blob) { try { await (await caches.open(SHELF)).put(shelfKey(k), new Response(blob, { headers: { 'content-type': blob.type || 'image/jpeg' } })); } catch { /* private window: shown, not kept */ } }
const b64Blob = d => fetch(`data:image/jpeg;base64,${d}`).then(r => r.blob());
/** One picture: size 'tile' (small, for the tiles) or '' (the screen copy). */
export function photoAt(key, size = '') {
  const k = `${size}|${key}`;
  if (!cache.has(k)) {
    const [proj, report, id] = key.split('|');
    cache.set(k, (async () => {
      const kept = typeof caches !== 'undefined' ? await fromShelf(k) : '';
      if (kept) return kept;
      const d = await fieldPhoto(proj, report, id, false, size), b = await b64Blob(d);
      if (typeof caches !== 'undefined') toShelf(k, b);
      return URL.createObjectURL(b);
    })().catch(() => { cache.delete(k); return ''; }));
  }
  return cache.get(k);
}

/**
 * v1.26.0 (owner, 8 Nov): a site video played in the page (muted on the tiles, with sound on the full screen). Kept in
 * this browser like the photos. '' when it cannot be played here (too big, or not readable): Drive's player then.
 */
const vcache = new Map();
let vqueue = Promise.resolve();   // one video download at a time, so the photos are not held up
export function videoAt(proj, id) {
  const k = `video|${proj}|${id}`;
  if (!vcache.has(k)) {
    vcache.set(k, (async () => {
      const kept = typeof caches !== 'undefined' ? await fromShelf(k) : '';
      if (kept) return kept;
      const job = vqueue.then(() => fieldVideo(proj, id));
      vqueue = job.catch(() => {});
      const out = await job;
      if (!out.data) return '';
      const b = await fetch(`data:${out.type || 'video/mp4'};base64,${out.data}`).then(r => r.blob());
      if (typeof caches !== 'undefined') toShelf(k, b);
      return URL.createObjectURL(b);
    })().catch(() => { vcache.delete(k); return ''; }));
  }
  return vcache.get(k);
}

/** The photos Field Report kept in Drive for this report (older reports have none). */
export const photoList = r => (r?.field?.photoFiles || []).filter(p => p && p.id);

const label = p => [p.time, p.zone, p.task, p.caption, p.gallery ? 'From gallery' : ''].filter(Boolean).join(' · ');   // v0.55.0: a photo the office added

/** The photos, perPage to a block (a printed page); each picture is filled in by fillPhotos(). '' when there are none. */
export function photoGrid(r, c, { perPage = 0, cls = '', pick = false } = {}) {
  const list = photoList(r), proj = c.project?.fieldCode || '', pdf = r?.field?.pdf || '';
  if (!list.length || !proj || !pdf) return '';
  // v1.59.0 (owner, 12 Nov): with more than 12 photos, the 12 for the client are marked; the PE or GM changes them until approval
  const many = list.length > CLIENT_PHOTOS, forClient = many ? clientIds(list, Array.isArray(r.field?.clientPick) ? r.field.clientPick : null) : [];
  const tag = p => !many ? '' : pick ? html`<button type="button" class="btn small ${forClient.includes(p.id) ? 'primary' : ''}" data-act="clientPick" data-id="${r.id}" data-v="${p.id}">${forClient.includes(p.id) ? '✓ For client' : '+ For client'}</button>`
    : forClient.includes(p.id) ? html`<span class="chip ok">For client</span>` : '';
  const fig = p => html`<figure class="ph"><img src="data:," alt="${p.caption || 'Site photo'}" data-fphoto="${proj}|${pdf}|${p.id}"><figcaption>${label(p)} ${tag(p)}</figcaption></figure>`;
  const pages = [];
  for (let i = 0; i < list.length; i += perPage || list.length) pages.push(list.slice(i, i + (perPage || list.length)));
  return html`${pages.map(pg => html`<div class="ph-grid ${cls}">${pg.map(fig)}</div>`)}`;
}

/** A drawn sample for the local demo (no Drive there). */
const sample = n => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dfe6ee"/><path d="M0 300 L140 150 L220 230 L290 170 L400 300Z" fill="#9fb3c8"/><text x="200" y="60" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#41536a">Sample photo ${n}</text></svg>`)}`;

/** Fills in every photo on the page (after each draw). */
export function fillPhotos(root) {
  root.querySelectorAll('img[data-fphoto]').forEach((img, i) => {
    if (img.getAttribute('src') !== 'data:,') return;
    const k = img.dataset.fphoto, size = img.dataset.fsize || '';   // v1.25.0: data-fsize="tile" = the small picture
    if (!store.cloud && !fieldReady()) { img.src = sample(i + 1); return; }
    photoAt(k, size).then(u => { if (u) img.src = u; else img.closest('figure')?.classList.add('ph-missing'); });
  });
  // v1.26.0: site videos play in the page; a tile stays on its cover picture when the video cannot be read here
  root.querySelectorAll('video[data-fvideo]').forEach(v => {
    if (v.dataset.filled || !store.cloud) return;
    v.dataset.filled = '1';
    const [proj, id] = v.dataset.fvideo.split('|');
    videoAt(proj, id).then(u => {
      if (!u) { v.dispatchEvent(new CustomEvent('novideo', { bubbles: true })); return; }
      v.src = u;
      v.play?.().catch(() => {});
    });
  });
}
