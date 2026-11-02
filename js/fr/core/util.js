// Small helpers shared by the model and the screens. No DOM here, so the tests can import them.

export const pad = n => String(n).padStart(3, '0');

/** A number from a field, or null when it is empty or not a number. */
export const num = v => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const sum = (list, fn = x => x) => (list || []).reduce((a, x) => a + (Number(fn(x)) || 0), 0);

/** Short stable hash of a string (FNV-1a), as the old app used for report fingerprints. */
export const fnv = str => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Today's date (YYYY-MM-DD) in a time zone, Addis Ababa unless the project says otherwise. */
export function todayIn(tz = 'Africa/Addis_Ababa', now = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const g = k => p.find(x => x.type === k).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return now.toISOString().slice(0, 10); }
}

export function timeIn(tz = 'Africa/Addis_Ababa', now = new Date()) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now); }
  catch { return now.toTimeString().slice(0, 5); }
}

export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const weekday = iso => new Date(iso + 'T00:00:00Z').getUTCDay();   // 0 Sunday

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Tue 20 Oct" */
export const dayLabel = iso => { const d = new Date(iso + 'T00:00:00Z'); return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const dayLetter = iso => DAY[weekday(iso)][0];

/** Hours between two "HH:MM" times, 0 when either is missing. */
export function hoursBetween(a, b) {
  const m = s => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return x ? +x[1] * 60 + +x[2] : null; };
  const s = m(a), e = m(b);
  return s == null || e == null || e <= s ? 0 : Math.round((e - s) / 6) / 10;
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
