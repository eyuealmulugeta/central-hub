// v1.6.0 (owner, 7 Nov, FR R8): Reports > Weather. The site's map position (Field Report then fills in the day's weather),
// the 3-day forecast, the public holidays of the project's country (the Admin adds them to the days off), and per month the
// weather days to claim, with Excel. See engine/weather.js.

import { store } from '../core/store.js';
import { html, chip, options } from './dom.js';
import { toCSV, downloadText, todayISO, fmtDate } from '../core/util.js';
import { HOLIDAYS, COUNTRY_NAME, holidaysFor, addHolidays, parseLatLng, forecastUrl, forecastOf, monthRows, csvRows } from '../engine/weather.js';

let year = 0;
let note = '';
const fc = { key: '', days: null, busy: false };   // the forecast, fetched once per position and day

function forecast(site) {
  const key = `${site.lat},${site.lng},${todayISO()}`;
  if (fc.key === key || fc.busy || typeof fetch !== 'function') return;
  fc.busy = true; fc.key = key;
  fetch(forecastUrl(site)).then(r => r.json()).then(j => { fc.days = forecastOf(j); }).catch(() => { fc.days = []; }).finally(() => { fc.busy = false; store.notify(); });
}

export function render(c) {
  const p = c.project || store.project || {}, ws = c.ws || store.ws, today = c.today || todayISO();
  year ||= +today.slice(0, 4);
  const site = p.site && p.site.lat != null ? p.site : null;
  if (site) forecast(site);
  const rows = monthRows(p, ws.reports || [], year), wd = rows.reduce((s, m) => s + m.weather.length, 0);
  const country = /^ET/i.test(p.fieldCc || 'ETH') ? 'ET' : String(p.fieldCc || '').toUpperCase();   // only Ethiopia has a list so far
  const years = Object.keys(HOLIDAYS[country] || {}), list = holidaysFor(country, year), missing = list.filter(h => !(p.nonWorking || []).includes(h.date));
  return html`<section class="card wide">
    <div class="toolbar"><h2>Weather and holidays</h2><span class="muted">Weather days are listed for the PE to claim; they do not extend the time on their own.</span><span class="grow"></span>
      <select data-chg="wxYear" aria-label="Year">${options([...new Set([year - 1, year, year + 1, ...years.map(Number)])].sort().map(y => [y, String(y)]), year)}</select>
      <button type="button" class="btn" data-act="wxCsv">Excel</button></div>
    <div class="grid2">
      <div class="box pad"><b>Site position</b>
        <p class="muted small">${site ? html`${site.lat}, ${site.lng} · <a href="https://maps.google.com/?q=${site.lat},${site.lng}" target="_blank" rel="noopener">Open the map</a>` : 'Not set. Field Report fills in the weather only when it is set.'}</p>
        <form data-form="wxSite" class="actions left"><input name="pos" placeholder="9.0108, 38.7613 or a Google Maps link" aria-label="Site position" style="min-width:16rem">
          <button class="btn">Save</button><button type="button" class="btn" data-act="wxHere" title="On site: use this phone's or laptop's position">Use my location</button></form>
        ${note ? html`<p class="muted small">${note}</p>` : ''}</div>
      <div class="box pad"><b>Next 3 days</b>
        ${!site ? html`<p class="muted small">Set the site position first.</p>` : fc.days == null ? html`<p class="muted small">Getting the forecast…</p>` : fc.days.length
          ? html`<div class="actions left">${fc.days.map(d => html`${chip(`${fmtDate(d.date)}: ${d.word}, ${d.tmax}°${d.rain ? `, ${d.rain} mm` : ''}`, d.heavy ? 'bad' : '')} `)}</div>${fc.days.some(d => d.heavy) ? html`<p class="small bad">Heavy rain expected: plan covered work and protect materials.</p>` : ''}`
          : html`<p class="muted small">No forecast now (no internet?).</p>`}</div>
    </div>
    <div class="box pad"><b>Public holidays ${year}, ${COUNTRY_NAME[country] || country}</b>
      ${list.length ? html`<p class="small">${list.map(h => `${fmtDate(h.date)} ${h.name}`).join(' · ')}</p>
        ${missing.length ? (store.isAdmin ? html`<button type="button" class="btn primary" data-act="wxHolidays" data-y="${year}" data-c="${country}">Add ${missing.length} holiday${missing.length === 1 ? '' : 's'} to the days off</button> <span class="muted small">The schedule then skips them (the finish date may move). Check the Muslim holidays: they follow the moon.</span>` : chip(`${missing.length} not in the days off yet: the Admin adds them`, 'warn')) : chip('All in the days off', 'ok')}`
        : html`<p class="muted small">No list for ${year} yet: add the days under This project, Days off.</p>`}</div>
    <div class="actions left">${chip(`${wd} weather day${wd === 1 ? '' : 's'} in ${year}`, wd ? 'warn' : '')}</div>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>Month</th><th>Weather days (to claim)</th><th>Holidays and days off</th><th>Other no-work days</th></tr></thead>
      <tbody>${rows.filter(m => m.weather.length || m.holidays.length || m.other.length).map(m => html`<tr><td class="nowrap"><b>${m.month}</b></td>
        <td>${m.weather.length ? html`<b>${m.weather.length}</b>: ${m.weather.map(x => `${fmtDate(x.date)}${x.note ? ` (${x.note})` : ''}`).join(', ')}` : ''}</td>
        <td class="small">${m.holidays.map(x => `${fmtDate(x.date)} ${x.name}`).join(', ')}</td><td class="small">${m.other.map(x => `${fmtDate(x.date)} ${x.reason}`).join(', ')}</td></tr>`)}</tbody></table></div>
    <p class="muted small">A weather day is a day Field Report sent "No work today" with Rain (or a reason about the weather).</p>
  </section>`;
}

const saveSite = pos => {
  store.updateProject(p => { p.site = { ...pos, at: new Date().toISOString(), by: (store.user?.email || '').toLowerCase() }; });
  store.logActivity?.({ action: 'save', channel: 'Weather', doc: `Site position ${pos.lat}, ${pos.lng}` });
  fc.key = ''; note = 'Saved. Field Report gets it with the next project update.';
};

export const actions = {
  wxHere() {
    if (!navigator.geolocation) { note = 'This browser cannot give a position.'; return; }
    note = 'Finding the position…';
    navigator.geolocation.getCurrentPosition(g => { saveSite({ lat: +g.coords.latitude.toFixed(6), lng: +g.coords.longitude.toFixed(6) }); store.notify(); },
      () => { note = 'No position (allow location for this site, or paste it).'; store.notify(); }, { enableHighAccuracy: true, timeout: 10000 });
  },
  wxHolidays(el) {
    if (!store.isAdmin) return;
    const list = holidaysFor(el.dataset.c, +el.dataset.y);
    if (!confirm(`Add ${list.length} public holidays of ${el.dataset.y} to this project's days off? The schedule skips them, so the finish date may move.`)) return;
    let added = [];
    store.updateProject(p => { const r = addHolidays(p, list); p.nonWorking = r.nonWorking; p.holidayNames = r.names; added = r.added; });
    store.logActivity?.({ action: 'save', channel: 'Weather', doc: `Public holidays ${el.dataset.y} added (${added.length})` });
  },
  wxCsv(el, c) { downloadText(`Weather days ${store.project?.name || ''} ${year}.csv`, toCSV(csvRows(monthRows(store.project || {}, (c?.ws || store.ws).reports || [], year)))); },
};
export const changes = { wxYear(el) { year = +el.value; } };
export const submits = {
  wxSite(fd) {
    const pos = parseLatLng(fd.get('pos'));
    if (!pos) { note = 'Not a position. Paste "9.0108, 38.7613" or a Google Maps link.'; return false; }
    saveSite(pos);
  },
};
