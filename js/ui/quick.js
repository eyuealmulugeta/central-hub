// v0.35.0: Quick (Today > + Quick): the pages a person uses most, saved on this computer and shown as icons.
// "+ Add" lists every page this person may open, to add or take away. main.js hands over the titles, the menu
// and the page check (configure), so this page shows only what the menu shows.

import { html, icon } from './dom.js';

const KEY = 'sf:quick';
export const QUICK_DEFAULT = ['reports', 'attendance', 'schedule', 'ledger', 'hr', 'discuss'];
let cfg = { titles: {}, hubs: () => [], allowed: () => true };
let editing = false;

export const configure = c => { cfg = { ...cfg, ...c }; };

export function quickList() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v)) return v; } catch { /* private window */ }
  return QUICK_DEFAULT;
}
const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* not kept */ } };

/** Every page of the menu this person may open, with its section's icon: [{ page, title, icon, section }]. */
export function quickPages() {
  return cfg.hubs().filter(h => h.id !== 'home').flatMap(h => h.tabs.filter(t => cfg.allowed(t) && cfg.titles[t])
    .map(t => ({ page: t, title: cfg.titles[t], icon: h.icon, section: h.label })));
}

export function render() {
  const all = quickPages(), mine = quickList().map(p => all.find(x => x.page === p)).filter(Boolean);
  if (editing) {
    const sections = [...new Set(all.map(x => x.section))];
    return html`<section class="card"><div class="toolbar"><h2>Add to Quick</h2><span class="muted">Tap a page to add (+) or take it away (✓). Saved on this computer.</span><span class="grow"></span>
        <button class="btn primary" type="button" data-act="quickEdit">Done</button></div>
      ${sections.map(s => html`<h4 class="q-sec">${s}</h4><div class="q-pick">${all.filter(x => x.section === s).map(x => {
        const on = mine.some(m => m.page === x.page);
        return html`<button type="button" class="q-opt ${on ? 'on' : ''}" data-act="quickPin" data-page="${x.page}" aria-pressed="${on}">${icon(x.icon, 18)}<span>${x.title}</span><b>${on ? '✓' : '+'}</b></button>`;
      })}</div>`)}</section>`;
  }
  return html`<section class="card"><div class="toolbar"><h2>Quick</h2><span class="muted">Your most used pages, one click away.</span></div>
    <div class="q-grid">${mine.map(x => html`<a class="q-tile" href="#${x.page}">${icon(x.icon, 30)}<span>${x.title}</span><small>${x.section}</small></a>`)}
      <button type="button" class="q-tile add" data-act="quickEdit" aria-label="Add or take away pages"><span class="q-plus">+</span><span>Add</span></button></div></section>`;
}

export const actions = {
  quickEdit() { editing = !editing; },
  quickPin(el) {
    const p = el.dataset.page, now = quickList().filter(x => quickPages().some(q => q.page === x));
    save(now.includes(p) ? now.filter(x => x !== p) : [...now, p]);
  },
};
