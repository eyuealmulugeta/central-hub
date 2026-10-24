// Home: the apps this person may open, as a grid of tiles (built in main.js, launcherApps), each with the red
// number of what needs attention there. The company figures and the project list are not shown here: they are
// on the Overview and Finance pages.

import { html, icon } from './dom.js';

export function render(c) {
  const counts = c.counts || {};
  return html`<nav class="launcher" aria-label="Apps">${(c.apps || []).map(a => {
    const n = a.pages.reduce((s, t) => s + (counts[t] || 0), 0);
    return html`<a class="app" href="#${a.page}"><span class="app-ic tone-${a.tone}">${icon(a.icon, 40)}${n ? html`<em>${n}</em>` : ''}</span><span class="app-name">${a.title}</span></a>`;
  })}</nav>`;
}

export const actions = {};
