// v0.56.0 (owner, 2 Nov): on a phone, a finger slid left or right opens the next or the previous tab of the bottom bar.
// The same file is in Field Report (js/core/swipe.js). The tab is opened by clicking its own button or link, so each
// app keeps its own way of moving. Places that take a sideways finger (tables that scroll, the signature pad, fields,
// sheets) are left alone.

/** The tab to open: the index after a slide of dx pixels (left = next), or -1 when there is none. */
export function stepOf(count, i, dx, min = 70) {
  if (i < 0 || Math.abs(dx) < min) return -1;
  const j = i + (dx < 0 ? 1 : -1);
  return j >= 0 && j < count ? j : -1;
}

/** Is the slide mostly sideways, quick enough and long enough? */
export const sideways = (dx, dy, ms) => Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 2 && ms < 800;

const KEEP = 'input, textarea, select, canvas, iframe, [contenteditable], [data-noswipe], .sheet, .dim, dialog, .modal, .gantt';
const scrollsSideways = el => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
};

/**
 * Listen on `root`. `tabs()` gives the bottom bar's tab elements in order (the one shown carries the class "on");
 * only while the bar is on screen (a phone) does a slide move.
 */
export function onSwipe(root, tabs) {
  let start = null;
  root.addEventListener('touchstart', e => {
    const t = e.touches[0];
    start = e.touches.length === 1 && !e.target.closest(KEEP) && !scrollsSideways(e.target) ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  root.addEventListener('touchend', e => {
    if (!start) return;
    const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y, ms = Date.now() - start.at;
    start = null;
    if (!sideways(dx, dy, ms)) return;
    const list = [...tabs()].filter(x => x.offsetParent !== null);
    const j = stepOf(list.length, list.findIndex(x => x.classList.contains('on')), dx);
    if (j >= 0) list[j].click();
  }, { passive: true });
}
