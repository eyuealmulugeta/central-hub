// Year, month and week of a date, to filter lists of dated records (the daily reports). Weeks are ISO weeks:
// Monday to Sunday, week 1 holding the year's first Thursday. Pure functions; dates are YYYY-MM-DD.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = m => MONTHS[m - 1] || '';

/** { year, month, week, weekYear } of a YYYY-MM-DD date. weekYear is the year the ISO week belongs to. */
export function periodOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);            // the Thursday of this week decides its year
  const weekYear = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(weekYear, 0, 1)) / 86400000 + 1) / 7);
  return { year: y, month: m, week, weekYear };
}

/** Does a date fall in the chosen period? Each of year, month and week is a number, or 0 for any. */
export function inPeriod(iso, { year = 0, month = 0, week = 0 } = {}) {
  const p = periodOf(iso);
  return (!year || p.year === year) && (!month || p.month === month) && (!week || p.week === week);
}

/** The years, months and weeks that `dates` hold, within the year and month already chosen, newest first. */
export function periodChoices(dates, { year = 0, month = 0 } = {}) {
  const all = dates.map(periodOf);
  const desc = (a, b) => b - a;
  const years = [...new Set(all.map(p => p.year))].sort(desc);
  const months = [...new Set(all.filter(p => !year || p.year === year).map(p => p.month))].sort(desc);
  const weeks = [...new Set(all.filter(p => (!year || p.year === year) && (!month || p.month === month)).map(p => p.week))].sort(desc);
  return { years, months, weeks };
}
