// 2.18.0: a report's rating out of 5 from four parts (owner, 1 Nov): photo times, data strength,
// engagement in the morning, during the day and at the end of day, and grammar.

const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const round = x => Math.round(Math.max(0, Math.min(5, x)) * 10) / 10;

/** The part of the day an hour falls in: morning before 11:00, during the day to 16:00, then end of day. */
export const partOf = hhmm => { const m = mins(hhmm); return m == null ? '' : m < 660 ? 'm' : m < 960 ? 'd' : 'e'; };

/** Photos taken inside the working hours (30 min early, 1 h late allowed) and not all in one hour. */
export function photoScore(r) {
  const ps = r.photos || [];
  if (!ps.length) return { v: 0, why: 'No photos' };
  const a = (mins(r.start && r.start.start) ?? 480) - 30, b = (mins(r.start && r.start.end) ?? 1020) + 60;
  const times = ps.map(p => mins(p.at)).filter(x => x != null);
  const inside = times.filter(x => x >= a && x <= b).length;
  let v = 5 * inside / ps.length;
  const bunched = times.length >= 3 && Math.max(...times) - Math.min(...times) < 120;   // 2.19.3: within 2 hours
  if (bunched) v /= 2;
  return { v: round(v), why: inside < ps.length ? `${ps.length - inside} taken outside working hours` : bunched ? 'All taken within two hours' : 'Taken through the day' };
}

/** How full the report is: the eight data steps done, and work lines with real detail. */
export function dataScore(r) {
  const d = r.done || {};
  const steps = [r.start && r.start.done, (r.crew && r.crew.rows || []).length, d.work, d.equipment, d.materials, d.safety || (r.safety && r.safety.done), (r.photos || []).length >= 3, d.end];
  const items = r.items || [];
  const detail = items.length ? items.filter(i => String(i.text || '').trim().length >= 15).length / items.length : 0;
  const v = 4 * steps.filter(Boolean).length / steps.length + detail;
  return { v: round(v), why: `${steps.filter(Boolean).length} of 8 parts filled${items.length ? `, ${Math.round(detail * 100)}% of work lines detailed` : ', no work lines'}` };
}

/** 2.19.3: the half hours (0-47) in which the report was worked on: kept slots, edit times, first times per part, photo times. */
const addis = ms => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Africa/Addis_Ababa', hour: '2-digit', minute: '2-digit' });
export const slotOf = hhmm => { const m = mins(hhmm); return m == null ? null : Math.floor(m / 30); };
export function slotsOf(r) {
  const out = new Set((r.slots || []).map(Number).filter(x => x >= 0 && x < 48));
  for (const e of r.edits || []) if (e && e.at > 1e12) out.add(slotOf(addis(e.at)));
  for (const v of Object.values(r.seen || {})) if (v > 1e12) out.add(slotOf(addis(v)));
  for (const p of r.photos || []) { const s = slotOf(p.at); if (s != null) out.add(s); }
  out.delete(null);
  return [...out].sort((a, b) => a - b);
}

/** 2.27.0: morning before 11:00, midday to 14:00, afternoon after. */
export const thirdOf = hhmm => { const m = mins(hhmm); return m == null ? '' : m < 660 ? 'morning' : m < 840 ? 'midday' : 'afternoon'; };
/** The time in Addis of a moment (ms). */
export const addisTime = ms => addis(ms);

/**
 * 2.27.0 Engagement (owner, 2 Nov): four checks, each worth a quarter: photos spread over morning, midday and afternoon;
 * most parts filled in (6 of 8); attendance marked on time (within an hour of the start); the report sent before 18:00.
 * A report not sent yet counts as on time while it is before 18:00. Each check says what it found.
 */
export function engageChecks(r, nowMs = Date.now()) {
  const thirds = [...new Set((r.photos || []).map(p => thirdOf(p.at)).filter(Boolean))];
  const d = r.done || {};
  const filled = [r.start && r.start.done, (r.crew && r.crew.rows || []).length, d.work, d.equipment, d.materials, d.safety || (r.safety && r.safety.done), (r.photos || []).length >= 3, d.end].filter(Boolean).length;
  const crewAt = r.stamps && r.stamps.crew && r.stamps.crew.first;
  const startM = mins(r.start && r.start.start) ?? 480;
  const crewM = crewAt ? mins(addis(crewAt)) : null;
  const sentM = mins(addis(r.sentAt || nowMs));
  return [
    { k: 'photos', label: 'Photos spread over morning, midday and afternoon', v: thirds.length / 3, why: thirds.length ? thirds.join(', ') : 'No photos' },
    { k: 'filled', label: 'Most sections filled in', v: filled >= 6 ? 1 : filled / 6, why: `${filled} of 8` },
    { k: 'att', label: 'Attendance marked on time', v: crewM == null ? 0 : crewM <= startM + 60 ? 1 : 0, why: crewM == null ? 'Not marked' : `at ${addis(crewAt)}` },
    { k: 'sent', label: 'Report sent before 18:00', v: sentM != null && sentM < 1080 ? 1 : 0, why: r.sentAt ? `at ${addis(r.sentAt)}` : sentM < 1080 ? 'Not sent yet' : 'Not sent by 18:00' },
  ];
}

/** Engagement: the owner's four checks (engageChecks), out of 5. (Before 2.27.0: the half hours worked in.) */
export function engageScore(r, nowMs = Date.now()) {
  const cs = engageChecks(r, nowMs);
  return { v: round(5 * cs.reduce((n, x) => n + x.v, 0) / cs.length), checks: cs, why: `${cs.filter(x => x.v >= 1).length} of 4 checks met` };
}

/** Free text written in the report. */
export function textsOf(r) {
  const out = [r.notes, r.instructions, r.safety && r.safety.note];
  for (const k of ['items', 'delays', 'requests', 'plan', 'received']) for (const x of r[k] || []) out.push(x && (x.text || x.note || x.desc));
  return out.map(x => String(x || '').trim()).filter(x => x.length >= 3);
}

/** Simple grammar checks: a capital first letter, no ALL CAPS, no word written twice, no double spaces or space before a stop. */
export function grammarScore(r) {
  const t = textsOf(r);
  if (!t.length) return { v: 0, why: 'No written text' };
  const bad = t.filter(s => !/^[A-Z0-9"'(]/.test(s) || (/[a-z]/i.test(s) && s.length > 8 && s === s.toUpperCase()) || /\b(\w+)\s+\1\b/i.test(s) || / {2,}/.test(s) || /\s[,.;:!?]/.test(s));
  return { v: round(5 * (1 - bad.length / t.length)), why: bad.length ? `${bad.length} of ${t.length} texts to correct` : 'Clean' };
}

/** The rating: the four parts and their average. */
export function rateReport(r, nowMs = Date.now()) {
  const parts = { photos: photoScore(r), data: dataScore(r), engage: engageScore(r, nowMs), grammar: grammarScore(r) };
  // 2.19.3: engagement half the rating; the rating is never more than 1.5 above it
  const w = 0.5 * parts.engage.v + 0.2 * parts.photos.v + 0.15 * parts.data.v + 0.15 * parts.grammar.v;
  const v = round(Math.min(w, parts.engage.v + 1.5));
  return { v, parts };
}

export const RATE_WORD = { photos: 'Photo times', data: 'Data strength', engage: 'Engagement', grammar: 'Grammar' };
/** "Rating 4.2/5 · Photo times 5 · Data strength 4 · Engagement 3.3 · Grammar 5" */
export const rateLine = x => `Rating ${x.v}/5 · ${Object.entries(x.parts).map(([k, p]) => `${RATE_WORD[k]} ${p.v}`).join(' · ')}`;

/** 2.27.0: the engagement checks as lines, "✓ Report sent before 18:00 · at 17:12", shown whenever a report is sent or opened. */
export const checkLines = x => ((x.parts.engage || {}).checks || []).map(c => `${c.v >= 1 ? '✓' : c.v > 0 ? '◐' : '✗'} ${c.label} · ${c.why}`);
