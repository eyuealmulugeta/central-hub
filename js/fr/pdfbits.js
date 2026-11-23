// 3.18.0 (owner, 23 Nov, Release C, audit FR-1): the small PDF helpers the screens use, apart from pdf.js, so the
// PDF maker itself loads only when a PDF is made (pdf.js re-exports these).

/** 3.12.0: the approval's date and time on the site's clock (19 Nov 2026, 14:05); a plain date stays as it is. */
export function approvedWhen(at) {
  const s = String(at || '');
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d)) return s;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Addis_Ababa', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** "08:00" -> "08:00 AM" */
export const ampm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = +m[1]; return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };

/** Which weather picture (img/weather/<name>.png) a condition uses. */
export const weatherFile = c => ({ Clear: 'clear', Sunny: 'sunny', 'Partly Cloudy': 'partly-cloudy', 'Cloudy / Overcast': 'cloudy', 'Foggy / Hazy': 'foggy', 'Light Rain': 'light-rain', 'Heavy Rain': 'heavy-rain', Windy: 'windy' })[c] || '';

/** 2.11.0: what the reporter reads about the photo pages (from doc.photoFit). */
export const fitLine = f => (!f || f.now == null ? '' : f.now
  ? `To end the report with full photo pages, insert either ${f.now} or ${f.next} more pictures.`
  : `The photo pages are full. Insert ${f.next} more pictures for one more full page.`);

/** "Zone C2 · Progress: roof sheets" (2.11.0: the time is kept apart, so the client copy can leave it out) */
export const photoCaption = (p, items = []) => {
  const it = items.find(i => i.id === p.itemId);
  const what = p.caption || (it ? `${p.captionKind}: ${it.task || it.type || it.text || 'work'}` : p.captionKind);
  return [p.zone, what].filter(Boolean).join(' · ');
};
