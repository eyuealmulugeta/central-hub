// The search box (Ctrl+K): type any words, a number, a date or part of a code, in any format, and find the page, record
// or text that has them. The words of the page itself are searched too; choosing a result opens its page with the words marked.

import { matches, snippet } from '../engine/find.js';

const $ = id => document.getElementById(id);
const MAX_SHOWN = 14;
let items = [];
let shown = [];
let at = 0;
let wired = false;
let options = {};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = s => String(s || '').toLowerCase();

/** What matches, best first: the name starts with the words, the name has them, the kind or hint has them, only the rest of the text has them. */
function search(text) {
  const query = text.trim();
  if (!query) return items.filter(x => x.kind !== 'On the page').slice(0, MAX_SHOWN);
  const first = lower(query).split(/\s+/)[0];
  const scored = [];
  for (const item of items) {
    const head = `${item.label} ${item.kind} ${item.hint || ''}`;
    const inHead = matches(head, query);
    const inBody = !inHead && item.body && matches(item.body, query);
    if (!inHead && !inBody) continue;
    const label = lower(item.label);
    scored.push({ item, inBody, rank: inBody ? (item.kind === 'On the page' ? 4 : 3) : label.startsWith(first) ? 0 : matches(item.label, query) ? 1 : 2 });
  }
  scored.sort((a, b) => a.rank - b.rank);
  const out = scored.slice(0, MAX_SHOWN).map(x => (x.inBody ? { ...x.item, hint: snippet(x.item.body, query, 100) } : x.item));
  return [...(options.extra?.(query) || []), ...out];
}

function draw() {
  shown = search($('palette-input').value);
  at = Math.min(at, Math.max(0, shown.length - 1));
  $('palette-list').innerHTML = shown.length
    ? shown.map((x, i) => `<li role="option" data-i="${i}" class="${i === at ? 'on' : ''}" aria-selected="${i === at}"><span class="chip">${esc(x.kind)}</span><b>${esc(x.label)}</b><span class="muted">${esc(x.hint || '')}</span></li>`).join('')
    : '<li class="none">Nothing matches. Try a name, a number, a date or a page, in any format.</li>';
}

function run(i) {
  const item = shown[i];
  if (!item) return;
  const text = $('palette-input').value.trim();
  $('dlg-palette').close();
  options.onChoose?.(text, item);
  item.run();
}

function wire() {
  if (wired) return;
  wired = true;
  $('palette-input').addEventListener('input', () => { at = 0; draw(); });
  $('palette-input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { at = Math.min(shown.length - 1, at + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { at = Math.max(0, at - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { run(at); e.preventDefault(); }
  });
  $('palette-list').addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) run(+li.dataset.i);
  });
  // a click on the dimmed area around the box closes it
  $('dlg-palette').addEventListener('click', e => { if (e.target === $('dlg-palette')) $('dlg-palette').close(); });
}

/**
 * @param list [{ kind, label, hint, body, run }] built fresh each time, so it reflects what is on screen now
 * @param opts.onChoose  (text, item) called before the chosen item runs
 * @param opts.extra     (text) => items put first for what is typed ("Find ... on this page")
 * @param opts.later     (push, cancelled) => adds more items after the box is open; stops when cancelled() is true
 */
export function openPalette(list, opts = {}) {
  wire();
  items = list;
  options = opts;
  at = 0;
  $('palette-input').value = '';
  draw();
  if (!$('dlg-palette').open) $('dlg-palette').showModal();
  $('palette-input').focus();
  // the rest (the words of each page) arrives a page at a time and is searchable as it does
  const mine = items;
  opts.later?.(more => { if (mine === items) { items.push(...more); if ($('dlg-palette').open) draw(); } }, () => !$('dlg-palette').open || mine !== items);
}
