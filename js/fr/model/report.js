// One day's report: its nine steps in three parts of the day, each step's status and the line shown under it.

import { totals } from './crew.js';
import { plural, hoursBetween } from '../core/util.js';
import { carryEquipment, dayStatus } from './day.js';
import { endStatus } from './end.js';

/** 2.27.0: the step a screen belongs to (a work item is Work done, a delivery Materials...). */
const STEP_OF = { att: 'crew', item: 'work', photo: 'photos', delivery: 'materials', delay: 'safety', request: 'end', sign: 'send', me: 'send' };
/**
 * 2.35.0 (3 Nov): with the data route Both, every report sent in the last 7 days needs its database copy. A sent
 * report without `dbAt` (the database's answer) is sent there again once the phone is signed in. Keys, oldest first.
 */
export const DB_DAYS = 7;
export const dbWaiting = (drafts, now = Date.now()) => Object.keys(drafts || {})
  .filter(k => { const r = drafts[k] || {}; return r.sentAt && !r.dbAt && !r.nowork && now - r.sentAt < DB_DAYS * 864e5; })
  .sort((a, b) => drafts[a].sentAt - drafts[b].sentAt);

export const stepOfScreen = h => STEP_OF[h] || (STEPS.some(s => s.id === h) ? h : '');
/** 2.27.0: "Eyob · 02:51": who last changed a step and when (Addis time). */
export const stampLine = st => (st && st.at > 1e12 ? [st.by, new Date(st.at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Addis_Ababa', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ') : '');

export const PHASES = [
  { id: 'morning', title: 'Morning' },
  { id: 'day', title: 'During the day', note: 'log as it happens' },
  { id: 'end', title: 'End of day', note: 'from 17:00' },
];

export const STEPS = [
  { id: 'start', phase: 'morning', title: 'Start of day' },
  { id: 'crew', phase: 'morning', title: 'Attendance and crew' },
  { id: 'work', phase: 'day', title: 'Work done' },
  { id: 'equipment', phase: 'day', title: 'Equipment' },
  { id: 'materials', phase: 'day', title: 'Materials received' },
  { id: 'safety', phase: 'day', title: 'Safety and delays' },
  { id: 'photos', phase: 'day', title: 'Photos' },
  { id: 'end', phase: 'day', title: 'Requests and tomorrow' },   // 2.18.0: During the day (owner, 1 Nov)
  { id: 'send', phase: 'end', title: 'Review and send' },
];

/** 2.7.0: the owner's 8 weather terms, each with a picture tapped instead of read. */
export const WEATHER = ['Clear', 'Sunny', 'Partly Cloudy', 'Cloudy / Overcast', 'Foggy / Hazy', 'Light Rain', 'Heavy Rain', 'Windy'];
export const WEATHER_PIC = { Clear: '🌤️', Sunny: '☀️', 'Partly Cloudy': '⛅', 'Cloudy / Overcast': '☁️', 'Foggy / Hazy': '🌫️', 'Light Rain': '🌦️', 'Heavy Rain': '🌧️', Windy: '💨' };
const OLD_WEATHER = { Cloudy: 'Cloudy / Overcast', Rain: 'Light Rain', Hot: 'Sunny' };
/** An older weather word moved to the nearest of the 8 terms. */
export const weatherTerm = v => (WEATHER.includes(v) ? v : OLD_WEATHER[v] || '');
/** 2.7.0: the safety gear checked on the crew each morning. */
export const PPE = ['Helmet', 'Vest', 'Boots', 'Gloves', 'Glasses', 'Harness'];
export const GROUND = ['Dry', 'Wet', 'Muddy'];

/**
 * A fresh report for a project and date. The start of day is carried from the last report
 * (hours, location, weather), so the morning is usually one tap.
 */
export function newReport(project, date, no, prev) {
  const ps = prev && prev.start || {};
  // yesterday's "next day" plan is today's activities by default (owner, 25 Oct)
  const planned = (prev && prev.plan || []).filter(x => x && (x.text || x.task || x.type))
    .map((x, i) => ({ id: `p${i + 1}`, zone: x.zone || '', taskId: x.taskId || '', task: x.task || '', type: x.type || '', text: x.text || '' }));
  const start = ps.start || project.defStart || '08:00', end = ps.end || project.defEnd || '17:00';
  return {
    v: 1,
    proj: project.code,
    date,
    no,
    created: Date.now(),
    updated: Date.now(),
    start: {
      start,
      end,
      cond: weatherTerm(ps.cond),
      tempC: ps.tempC ?? '',
      wind: '',
      ground: ps.ground || 'Dry',
      ppe: [],   // 2.7.0: ticked again every morning
      location: ps.location || project.siteName || project.location || project.address || '',
      carried: !!prev,
      done: false,
    },
    crew: { rows: [], extra: [], done: false, sentAt: 0 },
    planned,
    items: [], received: [], delays: [], photos: [], requests: [], plan: [], notes: '', instructions: '',
    // yesterday's machines are usually still on site (slice 3)
    equipment: carryEquipment(prev, hoursBetween(start, end) || 8),
    safety: { done: false, incident: false, kind: '', note: '', toolbox: false },
    attention: [],   // 2.7.0: a serious issue for the client: the report's red box and Central Hub's Needs attention
    done: {},
  };
}

/** { state: 'ok' | 'half' | 'no', count, line } for one step. */
export function stepStatus(r, id) {
  if (!r || !r.start) return { state: 'no', line: '' };
  switch (id) {
    case 'start': {
      const s = r.start;
      const w = [s.cond, s.tempC !== '' && s.tempC != null ? `${s.tempC} °C` : ''].filter(Boolean).join(' ');
      const line = [`${s.start}–${s.end}`, w, s.ground].filter(Boolean).join(' · ');
      return { state: s.done ? 'ok' : 'no', line: s.done ? line : 'Hours, weather, location' };
    }
    case 'crew': {
      const t = totals(r.crew, r.start.start, r.start.end);
      // 2.39.0 (owner): red until someone is marked, not when the list only opened
      if (!r.crew.done) return { state: r.crew.rows.some(x => x.markAt) ? 'half' : 'no', line: 'Who is here today' };
      return { state: 'ok', line: `${t.present} present · ${t.manHours} man-hours` };
    }
    case 'work': {
      const left = openPlanned(r).length;
      const plan = (r.planned || []).length ? ` · ${left ? `${left} of ${r.planned.length} planned to log` : 'all planned logged'}` : '';
      return r.items.length ? { state: r.done.work ? 'ok' : 'half', count: r.items.length, line: plural(r.items.length, 'item') + plan }
        : { state: 'no', line: left ? `${plural(left, 'activity', 'activities')} planned yesterday` : 'Log with + as it happens' };
    }
    case 'equipment': case 'materials': case 'safety': case 'photos':
      return dayStatus(r, id);
    case 'end':
      return endStatus(r);
    case 'send':
      if (r.sentAt) return { state: r.updated > r.sentAt + 1000 ? 'half' : 'ok', line: r.updated > r.sentAt + 1000 ? 'Changed since sent · send again' : `Sent · version ${r.sent && r.sent.version || 1}` };
      if (r.queuedAt) return { state: 'half', line: 'Waiting for a connection' };
      return { state: 'no', line: 'Check, sign and send' };
    default:
      return { state: r.done[id] ? 'ok' : 'no', line: '' };
  }
}

/** Planned activities not yet logged as work done today. */
export const openPlanned = r => (r.planned || []).filter(p => !r.items.some(i => i.planId === p.id));

/** How many of the nine steps are ticked. */
export const doneCount = r => STEPS.filter(s => stepStatus(r, s.id).state === 'ok').length;

/** The key a draft is saved under on the phone. */
export const draftKey = (proj, date) => `${proj}|${date}`;
