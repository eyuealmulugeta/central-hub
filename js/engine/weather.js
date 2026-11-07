// v1.6.0 (owner, 7 Nov, FR R8): weather and holidays by project location. The site's map position (project.site
// { lat, lng }) gives Field Report the day's weather and both apps a 3-day forecast (Open-Meteo, free, no key). A weather
// day is a day the site reported "no work" because of the weather (owner: that is enough, no rain threshold); weather days
// are listed for the PM to claim, they never extend the time on their own (owner). Public holidays come from a yearly list
// per country; the Admin adds them to the project's days off (the schedule moves, so it is the Admin's decision). Pure.

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/**
 * Ethiopian public holidays. The fixed ones follow the Ethiopian calendar (a day later in the Gregorian year before a
 * Gregorian leap year); Good Friday and Fasika follow the Orthodox Easter; the Muslim holidays follow the moon and may move
 * by a day: the office checks them each year and corrects them on the project.
 */
export const HOLIDAYS = {
  ET: {
    2026: [['2026-01-07', 'Genna (Christmas)'], ['2026-01-19', 'Timket (Epiphany)'], ['2026-03-02', 'Adwa Victory Day'], ['2026-03-20', 'Eid al-Fitr'],
      ['2026-04-10', 'Good Friday'], ['2026-04-12', 'Fasika (Easter)'], ['2026-05-01', 'Labour Day'], ['2026-05-05', "Patriots' Victory Day"],
      ['2026-05-27', 'Eid al-Adha'], ['2026-05-28', 'Derg Downfall Day'], ['2026-08-26', 'Mawlid'], ['2026-09-11', 'Enkutatash (New Year)'], ['2026-09-27', 'Meskel']],
    2027: [['2027-01-07', 'Genna (Christmas)'], ['2027-01-19', 'Timket (Epiphany)'], ['2027-03-02', 'Adwa Victory Day'], ['2027-03-10', 'Eid al-Fitr'],
      ['2027-04-30', 'Good Friday'], ['2027-05-01', 'Labour Day'], ['2027-05-02', 'Fasika (Easter)'], ['2027-05-05', "Patriots' Victory Day"],
      ['2027-05-17', 'Eid al-Adha'], ['2027-05-28', 'Derg Downfall Day'], ['2027-08-15', 'Mawlid'], ['2027-09-12', 'Enkutatash (New Year)'], ['2027-09-28', 'Meskel']],
    2028: [['2028-01-07', 'Genna (Christmas)'], ['2028-01-20', 'Timket (Epiphany)'], ['2028-02-27', 'Eid al-Fitr'], ['2028-03-02', 'Adwa Victory Day'],
      ['2028-04-14', 'Good Friday'], ['2028-04-16', 'Fasika (Easter)'], ['2028-05-01', 'Labour Day'], ['2028-05-05', "Patriots' Victory Day"],
      ['2028-05-05', 'Eid al-Adha'], ['2028-05-28', 'Derg Downfall Day'], ['2028-08-04', 'Mawlid'], ['2028-09-11', 'Enkutatash (New Year)'], ['2028-09-27', 'Meskel']],
  },
};
export const COUNTRY_NAME = { ET: 'Ethiopia' };

/** The list for a country and year: [{ date, name }] (the same day twice keeps both names). */
export function holidaysFor(country, year) {
  const by = {};
  for (const [d, n] of HOLIDAYS[country]?.[year] || []) by[d] = by[d] ? `${by[d]}, ${n}` : n;
  return Object.entries(by).map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Add holidays to the project's days off and names: { nonWorking, names, added }. */
export function addHolidays(project, list) {
  const nonWorking = new Set((project.nonWorking || []).filter(isDate)), names = { ...(project.holidayNames || {}) }, added = [];
  for (const h of list) { if (!nonWorking.has(h.date)) added.push(h.date); nonWorking.add(h.date); names[h.date] = h.name; }
  return { nonWorking: [...nonWorking].sort(), names, added };
}

/** "9.0108, 38.7613", or a Google Maps link (…@9.01,38.76,… or …q=9.01,38.76): { lat, lng } or null. */
export function parseLatLng(text) {
  const s = String(text || '');
  const m = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || s.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
}

/** The WMO weather code in Field Report's 8 terms (same as Field Report 2.7.0). */
export const wmoWord = (code, wind = 0) => (wind >= 30 ? 'Windy' : (code >= 63 && code <= 67) || code >= 81 ? 'Heavy Rain' : code >= 51 ? 'Light Rain' : code >= 45 ? 'Foggy / Hazy' : code === 3 ? 'Cloudy / Overcast' : code >= 1 ? 'Partly Cloudy' : 'Sunny');
export const forecastUrl = ({ lat, lng }) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,precipitation_sum,temperature_2m_max,wind_speed_10m_max&forecast_days=3&timezone=auto`;
/** Open-Meteo's daily answer as 3 days: { date, word, rain (mm), tmax, heavy }. Heavy = heavy rain or 10 mm and more. */
export function forecastOf(json) {
  const d = json?.daily || {};
  return (d.time || []).map((date, i) => {
    const word = wmoWord(+d.weather_code?.[i] || 0, +d.wind_speed_10m_max?.[i] || 0), rain = Math.round((+d.precipitation_sum?.[i] || 0) * 10) / 10;
    return { date, word, rain, tmax: Math.round(+d.temperature_2m_max?.[i] || 0), heavy: word === 'Heavy Rain' || rain >= 10 };
  });
}

/** A "no work" report because of the weather. */
export const WEATHER_RE = /rain|weather|wind|storm|flood|mud/i;
export const isWeatherDay = r => !!r?.field?.nowork && WEATHER_RE.test(`${r.field.reason || ''} ${r.field.note || ''}`);

/** Per month of a year: weather days (to claim), holidays and the other no-work days. */
export function monthRows(project, reports = [], year) {
  const y = String(year), names = project?.holidayNames || {};
  const rows = Array.from({ length: 12 }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, weather: [], holidays: [], other: [] }));
  const at = d => rows[+d.slice(5, 7) - 1];
  for (const r of reports) {
    if (!r?.field?.nowork || !isDate(r.date) || !r.date.startsWith(y)) continue;
    at(r.date)[isWeatherDay(r) ? 'weather' : 'other'].push({ date: r.date, reason: r.field.reason || '', note: r.field.note || '' });
  }
  for (const d of (project?.nonWorking || []).filter(x => isDate(x) && x.startsWith(y))) at(d).holidays.push({ date: d, name: names[d] || 'Day off' });
  for (const m of rows) for (const k of ['weather', 'holidays', 'other']) m[k].sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

/** The weather days of a period, for the PM's claim. */
export const weatherDays = (reports = [], from = '', to = '9999') => reports.filter(r => isWeatherDay(r) && r.date >= from && r.date <= to)
  .map(r => ({ date: r.date, reason: r.field.reason || '', note: r.field.note || '' })).sort((a, b) => a.date.localeCompare(b.date));

export function csvRows(rows) {
  const out = [['Month', 'Weather days (to claim)', 'Dates', 'Holidays and days off', 'Other no-work days']];
  for (const m of rows) out.push([m.month, m.weather.length, m.weather.map(x => `${x.date} ${x.reason}${x.note ? ` (${x.note})` : ''}`).join('; '), m.holidays.map(x => `${x.date} ${x.name}`).join('; '), m.other.map(x => `${x.date} ${x.reason}`).join('; ')]);
  return out;
}
