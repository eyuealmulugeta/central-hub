// The passport image place, shared by the employee record and the company owner record. The picture is a photo
// or scan of the passport page; it is made small automatically (core/image.js) and is seen by the Admin only.
// Click the picture to enlarge it, click again to shrink it.

import { html } from './dom.js';

let zoomed = false;
export const toggleZoom = () => { zoomed = !zoomed; };
export const resetZoom = () => { zoomed = false; };

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
