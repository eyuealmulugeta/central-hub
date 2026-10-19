// Meetings booked by people outside the company, the way a booking page works:
// the company sets when it can meet, a visitor picks a free time. Shared by
// Central Hub and by the public page (book.html), so it imports nothing.
//
// Times are kept as UTC instants. The company's working hours are in its own
// clock, `offset` minutes ahead of UTC (Addis Ababa is +180, with no summer time).
//
// Records:
//   public/booking        what the booking page shows: meeting types and working hours. Anyone reads it.
//   slots/<id>            one taken step of time, id "YYYYMMDDTHHMMZ". Holds no names. It can only be
//                         created, never overwritten, which is what stops two people taking one time.
//   bookings/<id>         who booked and why. Only the office reads these.

export const DEFAULT_BOOKING = {
  on: true,
  company: 'Amistad Prefab',
  intro: 'Choose the kind of meeting, then a day and a time that suits you.',
  types: [
    { id: 'call', name: 'Introductory call', minutes: 30, where: 'Phone or video call' },
    { id: 'visit', name: 'Project meeting', minutes: 60, where: 'Amistad Prefab office, Addis Ababa' },
  ],
  days: [1, 2, 3, 4, 5],     // 0 = Sunday
  from: '09:00',
  to: '17:00',
  step: 30,                  // minutes between possible starting times
  noticeHours: 12,           // the soonest a meeting can be booked
  horizonDays: 30,           // how far ahead the page offers days
  offset: 180,               // minutes ahead of UTC
  zone: 'Addis Ababa time (GMT+3)',
};

export const withDefaults = b => ({ ...DEFAULT_BOOKING, ...(b || {}), types: b?.types?.length ? b.types : DEFAULT_BOOKING.types });

const pad = n => String(n).padStart(2, '0');
const minutesOf = hhmm => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** The UTC instant (ms) of a time on the company's clock. */
export function toInstant(dayISO, minutes, offset) {
  const [y, m, d] = dayISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + (minutes - offset) * 60000;
}
/** A UTC instant as { day: 'YYYY-MM-DD', time: 'HH:MM', dow } on the company's clock. */
export function onCompanyClock(ms, offset) {
  const d = new Date(ms + offset * 60000);
  return { day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, dow: d.getUTCDay() };
}
/** The id of the step of time that starts at this instant. */
export function slotId(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
}
/** Every step a meeting of `minutes` starting at `ms` occupies. */
export function stepsOf(ms, minutes, step) {
  const out = [];
  for (let t = ms; t < ms + minutes * 60000; t += step * 60000) out.push(t);
  return out;
}

/** The starting times (UTC ms) still free on one day of the company's calendar. */
export function freeTimes(settings, taken, dayISO, minutes, now) {
  const s = withDefaults(settings);
  const [y, m, d] = dayISO.split('-').map(Number);
  if (!s.days.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) return [];
  const soonest = now + s.noticeHours * 3600000;
  const out = [];
  for (let t = minutesOf(s.from); t + minutes <= minutesOf(s.to); t += s.step) {
    const start = toInstant(dayISO, t, s.offset);
    if (start < soonest) continue;
    if (stepsOf(start, minutes, s.step).every(x => !taken.has(slotId(x)))) out.push(start);
  }
  return out;
}

/** The days the page offers, each with its free times; days with none are left out. */
export function openDays(settings, taken, minutes, now) {
  const s = withDefaults(settings);
  const first = onCompanyClock(now, s.offset).day;
  const out = [];
  for (let i = 0; i <= s.horizonDays; i++) {
    const day = onCompanyClock(toInstant(first, 12 * 60, s.offset) + i * 86400000, s.offset).day;
    const times = freeTimes(s, taken, day, minutes, now);
    if (times.length) out.push({ day, times });
  }
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Wednesday 14 October 2026" for a day of the company's calendar. */
export function dayLabel(dayISO) {
  const [y, m, d] = dayISO.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}
/** "Wednesday 14 October 2026, 09:30" on the company's clock. */
export function whenLabel(ms, offset) {
  const c = onCompanyClock(ms, offset);
  return `${dayLabel(c.day)}, ${c.time}`;
}

const stamp = ms => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
/** A link that opens Google Calendar with the meeting filled in, ready to save. */
export function calendarLink({ title, start, minutes, where, details }) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(start)}/${stamp(start + minutes * 60000)}`, location: where || '', details: details || '' });
  return `https://calendar.google.com/calendar/render?${q}`;
}
/** The meeting as a calendar file, for Outlook, Apple Calendar and others. */
export function calendarFile({ id, title, start, minutes, where, details }) {
  const text = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amistad Prefab//Central Hub//EN', 'BEGIN:VEVENT',
    `UID:${id}@amistad-central-hub`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + minutes * 60000)}`,
    `SUMMARY:${text(title)}`, `LOCATION:${text(where)}`, `DESCRIPTION:${text(details)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
