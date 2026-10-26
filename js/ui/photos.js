// v0.23.1: the site photos of a Field Report report, kept in Drive by Field Report 2.1.0 (report file field photoFiles,
// script 7.31.0). They are read through the server (fieldAction photoGet, office people only), once per session, and
// filled in after the page is drawn. In the local demo a drawn sample stands in for each photo.

import { html } from './dom.js';
import { fieldPhoto, fieldReady } from '../sync/fieldreport.js';
import { store } from '../core/store.js';

const cache = new Map();   // "proj|report|id" -> Promise<data URL, or '' when it could not be read>

/** The photos Field Report kept in Drive for this report (older reports have none). */
export const photoList = r => (r?.field?.photoFiles || []).filter(p => p && p.id);

const label = p => [p.time, p.zone, p.task, p.caption].filter(Boolean).join(' · ');

/** The photos, perPage to a block (a printed page); each picture is filled in by fillPhotos(). '' when there are none. */
export function photoGrid(r, c, { perPage = 0, cls = '' } = {}) {
  const list = photoList(r), proj = c.project?.fieldCode || '', pdf = r?.field?.pdf || '';
  if (!list.length || !proj || !pdf) return '';
  const fig = p => html`<figure class="ph"><img src="data:," alt="${p.caption || 'Site photo'}" data-fphoto="${proj}|${pdf}|${p.id}"><figcaption>${label(p)}</figcaption></figure>`;
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
    const k = img.dataset.fphoto;
    if (!cache.has(k)) {
      const [proj, report, id] = k.split('|');
      cache.set(k, !store.cloud && !fieldReady() ? Promise.resolve(sample(i + 1))
        : fieldPhoto(proj, report, id).then(d => `data:image/jpeg;base64,${d}`).catch(() => ''));
    }
    cache.get(k).then(u => { if (u) img.src = u; else img.closest('figure')?.classList.add('ph-missing'); });
  });
}
