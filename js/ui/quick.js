// v0.35.0: Quick (Today > + Quick): the pages a person uses most, saved on this computer and shown as icons.
// "+ Add" lists every page this person may open, to add or take away. main.js hands over the titles, the menu
// and the page check (configure), so this page shows only what the menu shows.

import { html, icon } from './dom.js';
import { prefs } from '../core/prefs.js';
import { MENU_ORDER, orderOf } from '../core/nav.js';
import { HOME_ORDER, BOX_LABELS, boxOrder } from '../engine/exechome.js';

const KEY = 'sf:quick';
export const QUICK_DEFAULT = ['reports', 'attendance', 'schedule', 'ledger', 'hr', 'discuss'];
let cfg = { titles: {}, hubs: () => [], allowed: () => true };
let editing = false;
let arranging = false;   // v0.92.0: the Arrange card is open
/** Opens Quick with Arrange showing (the Arrange button on Today). */
export const openArrange = () => { arranging = true; };

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

// v0.92.0 (owner, 5 Nov, R2): each person puts the menu and the Today boxes in their own order. Kept with their
// settings (core/prefs.js), so it follows them to every computer and phone.
const menuIds = () => cfg.hubs().filter(h => !h.team).map(h => h.id);
const homeIds = () => boxOrder(orderOf(prefs.get(HOME_ORDER)));
/** One step up (-1) or down (+1); the list as it is when the item is already at that end. Pure. */
export function moved(ids, id, d) {
  const i = ids.indexOf(id), j = i + d, out = [...ids];
  if (i < 0 || j < 0 || j >= ids.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
function arrangeCard() {
  const labels = Object.fromEntries(cfg.hubs().map(h => [h.id, h.label]));
  const list = (kind, ids, name) => html`<ol class="arr-list">${ids.map((id, i) => html`<li><span class="arr-no">${i + 1}</span><span class="arr-name">${name(id)}</span>
      <button type="button" class="btn small ghost" data-act="arrMove" data-k="${kind}" data-id="${id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${name(id)} up">↑</button>
      <button type="button" class="btn small ghost" data-act="arrMove" data-k="${kind}" data-id="${id}" data-d="1" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="Move ${name(id)} down">↓</button></li>`)}</ol>`;
  return html`<section class="card arrange"><div class="toolbar"><h2>Arrange</h2><span class="muted">Put the menu and the Today boxes in the order you like. Saved for you, on every device.</span><span class="grow"></span>
      <button class="btn ghost small" type="button" data-act="arrReset">Usual order</button><button class="btn primary small" type="button" data-act="arrangeOpen">Done</button></div>
    <div class="arr-cols"><div><h4 class="q-sec">Menu (left side)</h4>${list('menu', menuIds(), id => labels[id] || id)}<p class="muted small">Discuss, Meetings and Settings stay at the foot.</p></div>
      <div><h4 class="q-sec">Today boxes</h4>${list('home', homeIds(), id => BOX_LABELS[id])}<p class="muted small">The first two share the wide row, the next three the row of small boxes. A box with nothing to show is left out.</p></div></div></section>`;
}

export function render() {
  if (arranging) return arrangeCard();
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
  return html`<section class="card"><div class="toolbar"><h2>Quick</h2><span class="muted">Your most used pages, one click away.</span><span class="grow"></span><button class="btn ghost small" type="button" data-act="arrangeOpen">Arrange menu and Today</button></div>
    <div class="q-grid">${mine.map(x => html`<a class="q-tile" href="#${x.page}">${icon(x.icon, 30)}<span>${x.title}</span><small>${x.section}</small></a>`)}
      <button type="button" class="q-tile add" data-act="quickEdit" aria-label="Add or take away pages"><span class="q-plus">+</span><span>Add</span></button></div></section>`;
}

export const actions = {
  quickEdit() { editing = !editing; },
  arrangeOpen() { arranging = !arranging; editing = false; },
  arrMove(el) {
    const menu = el.dataset.k === 'menu';
    prefs.set(menu ? MENU_ORDER : HOME_ORDER, moved(menu ? menuIds() : homeIds(), el.dataset.id, +el.dataset.d).join(','));
  },
  arrReset() { prefs.set(MENU_ORDER, ''); prefs.set(HOME_ORDER, ''); },
  quickPin(el) {
    const p = el.dataset.page, now = quickList().filter(x => quickPages().some(q => q.page === x));
    save(now.includes(p) ? now.filter(x => x !== p) : [...now, p]);
  },
};
