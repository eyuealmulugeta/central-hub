// A quiet fault log. When something breaks, the page keeps working, the fault is written to a
// small log on this device, and the log is sent to the Admin the next time the device is online
// and signed in. Nothing here shows an error to the person, and nothing here holds personal data
// beyond the signed-in email on the upload.

const KEY = 'sf:faults';
const MAX = 50;                       // faults kept on a device
const trim = (v, n) => String(v ?? '').slice(0, n);

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* storage full or blocked: the log is best effort */ } };

const idOf = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Add a fault to the log. The same message from the same place is counted, not repeated. */
export function record(error, where = '') {
  const message = trim(error?.message || error, 300);
  if (!message) return null;
  const list = read();
  const same = list.find(f => f.message === message && f.where === where);
  if (same) {
    same.count = (same.count || 1) + 1;
    same.at = new Date().toISOString();
    write(list);
    return same;
  }
  const fault = {
    id: idOf(), at: new Date().toISOString(), where: trim(where, 60), message, stack: trim(error?.stack, 800), count: 1,
    page: trim(typeof location === 'undefined' ? '' : location.hash, 80), agent: trim(typeof navigator === 'undefined' ? '' : navigator.userAgent, 120),
  };
  list.push(fault);
  write(list);
  return fault;
}

export const waiting = () => read();

/** Send the waiting faults, oldest first, while the device is online. Resolves with how many went. */
export async function flush(api, email) {
  if (!api || !email || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
  let sent = 0;
  for (const fault of read()) {
    try {
      await api.set(`diagnostics/${fault.id}`, { ...fault, by: email });
    } catch {
      break;   // not allowed yet (rules not published) or the connection dropped: keep the rest for next time
    }
    write(read().filter(f => f.id !== fault.id));
    sent++;
  }
  return sent;
}

/** Catch what nobody handled, anywhere on the page. */
export function install() {
  addEventListener('error', e => record(e.error || e.message, 'page'));
  addEventListener('unhandledrejection', e => record(e.reason, 'promise'));
}
