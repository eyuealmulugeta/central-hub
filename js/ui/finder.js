// Locating text on the page that is open: every match is marked, the first is scrolled into view, and a small bar
// steps through them. Used after a search result is chosen (the page opens with the words marked) and for
// "Find on this page". The page is drawn again whenever its data changes, so the marks are put back after each drawing.

import { ranges, matches } from '../engine/find.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'MARK', 'NOSCRIPT', 'SVG']);
let query = '';
let hits = [];
let at = 0;
let bar = null;

export const activeFind = () => query;

function textNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !SKIP.has(n.parentElement?.tagName?.toUpperCase()) && !n.parentElement?.closest('[data-nofind]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function unmark(root) {
  for (const m of root.querySelectorAll('mark.find-hit')) { const p = m.parentNode; m.replaceWith(document.createTextNode(m.textContent)); p.normalize(); }
  for (const el of root.querySelectorAll('.find-hit-field')) el.classList.remove('find-hit-field', 'find-current');
  hits = [];
}

function barEl() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'find-bar';
  bar.className = 'find-bar';
  bar.setAttribute('data-nofind', '');
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span id="find-text"></span><button type="button" class="btn small" id="find-prev" aria-label="Previous match">↑</button><button type="button" class="btn small" id="find-next" aria-label="Next match">↓</button><button type="button" class="btn ghost small" id="find-x" aria-label="Stop finding">✕</button>';
  document.body.append(bar);
  bar.querySelector('#find-prev').addEventListener('click', () => step(-1));
  bar.querySelector('#find-next').addEventListener('click', () => step(1));
  bar.querySelector('#find-x').addEventListener('click', () => closeFind());
  return bar;
}

function show() {
  const b = barEl();
  b.hidden = false;
  b.querySelector('#find-text').textContent = hits.length ? `“${query}”: ${at + 1} of ${hits.length} on this page` : `“${query}” is not on this page`;
  b.querySelector('#find-prev').disabled = b.querySelector('#find-next').disabled = hits.length < 2;
}

function go(i) {
  if (!hits.length) { show(); return; }
  hits[at]?.classList.remove('find-current');
  at = (i + hits.length) % hits.length;
  const el = hits[at];
  el.classList.add('find-current');
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  show();
}
const step = by => go(at + by);

/** Mark `text` in everything under `root` and scroll to the first (or keep the match that was current). */
export function showFind(root, text, keep = false) {
  const previous = at;
  unmark(root);
  query = String(text || '').trim();
  if (!query) { closeFind(root); return 0; }
  for (const node of textNodes(root)) {
    const found = ranges(node.nodeValue, query);
    for (const [from, to] of found.reverse()) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      range.surroundContents(mark);
    }
  }
  for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), textarea')) {
    if (el.id !== 'find-input' && matches(`${el.value} ${el.placeholder || ''}`, query)) el.classList.add('find-hit-field');
  }
  hits = [...root.querySelectorAll('mark.find-hit, .find-hit-field')];
  go(keep ? Math.min(previous, Math.max(0, hits.length - 1)) : 0);
  return hits.length;
}

/** After the page was drawn again: put the marks back where they were. */
export function refind(root) { if (query) showFind(root, query, true); }

export function closeFind(root = document.getElementById('view') || document.body) {
  unmark(root);
  query = '';
  if (bar) bar.hidden = true;
}
