// The red numbers beside a menu entry or a tab: things that need attention. "Mark as read" hides what is there now;
// the number comes back, counting only the new ones, when something new needs attention. Kept in this browser.
// (Alerts, chat and meetings have their own opened-or-not memory; this one is for the counts that are only a
// count: open requests, setup steps left, late shipments, contract dates, staff papers, people waiting.)

const KEY = 'sf:badges-read';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = map => { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private window: the number just stays */ } };

/**
 * The number to show for `key` when `n` things need attention: only those beyond what was marked as read.
 * If the count falls below what was marked, the mark falls with it, so things that come back count again.
 */
export function shown(key, n) {
  const map = read();
  let marked = map[key] || 0;
  if (n < marked) { marked = n; map[key] = n; write(map); }
  return Math.max(0, n - marked);
}

/** Mark the `n` things that need attention now as read. */
export function dismiss(key, n) {
  const map = read();
  map[key] = Math.max(0, n || 0);
  write(map);
}
