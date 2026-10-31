// The passport image place, shared by the employee record and the company owner record. The picture is a photo
// or scan of the passport page; it is made small automatically (core/image.js) and is seen by the Admin only.
// Click the picture to enlarge it, click again to shrink it.

import { html } from './dom.js';

let zoomed = false;
export const toggleZoom = () => { zoomed = !zoomed; };
export const resetZoom = () => { zoomed = false; };

/** v0.33.0: the Fayda ID (Ethiopian national ID), front and back. Its number, FIN, birth, sex and address are read when added. */
export function idBlock(front, back, name) {
  const side = (img, label, chg, drop) => html`<div class="id-side"><span class="muted">${label}</span>${img
    ? html`<button type="button" class="doc-img-btn ${zoomed ? 'zoom' : ''}" data-act="zoomPassport" title="${zoomed ? 'Click to shrink' : 'Click to enlarge'}"><img class="doc-img" src="${img}" alt="Fayda ID of ${name || 'this person'}, ${label.toLowerCase()}"></button>`
    : html`<div class="doc-img-empty">No picture yet</div>`}
    <div class="actions left"><label class="btn small">${img ? 'Change' : 'Add'}<input type="file" accept="image/*" data-chg="${chg}" hidden></label>${img ? html`<button class="btn ghost small" type="button" data-act="${drop}">Remove</button>` : ''}</div></div>`;
  return html`<div class="doc-image">
    <b>Fayda ID</b>
    <div class="id-sides">${side(front, 'Front', 'idImage', 'dropIdImage')}${side(back, 'Back', 'idImageBack', 'dropIdImageBack')}</div>
    <span class="muted">Pictures of the national ID card. They are made smaller automatically; the Fayda number (FAN), FIN, date of birth, sex, phone and address are read and filled in where empty. Shown on the attendance sheet. Only you, the Admin, can see them.</span>
  </div>`;
}

export function passportBlock(image, name) {
  return html`<div class="doc-image">
    <b>Passport image</b>
    ${image
      ? html`<button type="button" class="doc-img-btn ${zoomed ? 'zoom' : ''}" data-act="zoomPassport" title="${zoomed ? 'Click to shrink' : 'Click to enlarge'}"><img class="doc-img" src="${image}" alt="Passport of ${name || 'this person'}"></button>`
      : html`<div class="doc-img-empty">No passport image yet</div>`}
    <div class="actions left">
      <label class="btn small">${image ? 'Change passport image' : 'Add passport image'}<input type="file" accept="image/*" data-chg="passportImage" hidden></label>
      ${image ? html`<button class="btn ghost small" type="button" data-act="dropPassportImage">Remove</button>` : ''}
    </div>
    <span class="muted">A photo or scan of the passport page. It is made smaller automatically, and its details (name, number, nationality, birth, expiry) are read and filled in where empty. Only you, the Admin, can see it.</span>
  </div>`;
}
