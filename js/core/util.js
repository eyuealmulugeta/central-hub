// Shared helpers. Dates are ISO strings ('YYYY-MM-DD') at the edges and
// integer day numbers (days since 1970-01-01, UTC) inside the engines.

const pad = n => String(n).padStart(2, '0');

export const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 9);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sum = (list, fn = x => x) => list.reduce((s, x) => s + (fn(x) || 0), 0);

export const toDay = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
};
export const fromDay = n => new Date(n * 864e5).toISOString().slice(0, 10);
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ---- working-day calendar (wd = array of weekday numbers, 0 = Sunday; wd.off, when present, is a Set of day numbers nobody works) ----

export const DEFAULT_WEEK = [1, 2, 3, 4, 5, 6];
export const dow = n => (((n + 4) % 7) + 7) % 7; // day 0 was a Thursday
export const isWork = (d, wd) => wd.includes(dow(d)) && !wd.off?.has(d);
export const nextWork = (d, wd) => { while (!isWork(d, wd)) d++; return d; };
export const prevWork = (d, wd) => { while (!isWork(d, wd)) d--; return d; };

/** The working day n working days after d (n = 0 snaps d forward to a working day). */
export function addWork(d, n, wd) {
  d = nextWork(d, wd);
  for (; n > 0; n--) d = nextWork(d + 1, wd);
  return d;
}

export function subWork(d, n, wd) {
  d = prevWork(d, wd);
  for (; n > 0; n--) d = prevWork(d - 1, wd);
  return d;
}

/** Signed number of working days from a to b (a excluded, b included). */
export function workBetween(a, b, wd) {
  if (b < a) return -workBetween(b, a, wd);
  let n = 0;
  for (let d = a + 1; d <= b; d++) if (isWork(d, wd)) n++;
  return n;
}

// ---- formatting ----

export const fmtDate = iso => iso
  ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  : '—';
export const fmtDay = n => fmtDate(fromDay(n));
export const fmtFull = iso => iso
  ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : '—';

export function money(v, currency, digits = 0) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, currencyDisplay: 'code',
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(v || 0);
  } catch {
    return `${currency} ${num(v, digits)}`;
  }
}
export const num = (v, digits = 2) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: digits });

// ---- export ----

export const toCSV = rows => rows.map(r => r.map(c => {
  const s = String(c ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n');

export function downloadText(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
