// Staff directory, for everybody but the Admin (who has the employee records): the people working on the open
// project, by name, job position and project. Nothing private: no phone, email, pay or papers.

import { html } from './dom.js';

let search = '';

/** The active members of a project's team, as the directory shows them. Pure. */
export const directoryOf = (team, projectName) => team.filter(m => m.active !== false && String(m.name || '').trim())
  .map(m => ({ name: m.name.trim(), position: m.role || '', project: projectName }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function render(c) {
  const all = directoryOf(c.ws.team, c.project.name);
  const q = search.trim().toLowerCase();
  const shown = all.filter(r => !q || `${r.name} ${r.position}`.toLowerCase().includes(q));
  return html`<section class="card">
    <div class="toolbar"><h2>Staff directory</h2>
      <input class="search" type="search" data-chg="search" data-fk="dir-search" value="${search}" placeholder="Search a name or position" aria-label="Search the staff">
      <span class="grow"></span><span class="muted">${shown.length} of ${all.length}</span></div>
    <p class="muted">The people working on ${c.project.name}. Choose another project at the top to see its team.</p>
    ${shown.length ? html`<table class="table">
      <thead><tr><th>Name</th><th>Job position</th><th>Project</th></tr></thead>
      <tbody>${shown.map(r => html`<tr><td><b>${r.name}</b></td><td>${r.position}</td><td>${r.project}</td></tr>`)}</tbody>
    </table>` : html`<p class="empty">${all.length ? 'Nobody matches.' : 'Nobody is on this project yet.'}</p>`}
  </section>`;
}

export const changes = {
  search(el) { search = el.value; },
};
