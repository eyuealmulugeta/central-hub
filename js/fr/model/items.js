// Work done during the day, logged as it happens with +. Each item: where, what kind of work or which task,
// a short line, an amount, photos and whether it reached a milestone.

import { uid, num } from '../core/util.js';

export const UNITS = ['pcs', 'm', 'm²', 'm³', 'kg', 't', '%', 'set', 'lot'];
export const CAPTIONS = ['Progress', 'Before', 'After', 'Delivery', 'Safety', 'Problem'];

export const newItem = (time, last) => ({
  id: uid(), at: time, zone: last ? last.zone : '', type: '', taskId: '', task: '', text: '', qty: null, unit: 'pcs', photos: [], milestoneId: '', planId: '',
});

/** A work item started from one of today's planned activities: where and what are filled, the amount is today's. */
export const itemFromPlan = (time, plan, task) => ({
  ...newItem(time), planId: plan.id, zone: plan.zone, taskId: plan.taskId, task: plan.task, type: plan.type, text: plan.text,
  unit: task && task.unit ? task.unit : 'pcs',
});

/** Zones of a project: the office's list, then the ones the site added, then the ones already used today. */
export function zonesOf(setup, siteZones, items) {
  return [...new Set([...(setup && setup.zones || []), ...(siteZones || []), ...(items || []).map(i => i.zone)].map(z => String(z || '').trim()).filter(Boolean))];
}

/** "Zone C2 · Wall cladding · 9 pcs" */
export function itemLine(i) {
  const what = i.task || i.type;
  const amt = i.qty != null && i.qty !== '' ? `${i.qty} ${i.unit || ''}`.trim() : '';
  return [i.zone, what, amt].filter(Boolean).join(' · ');
}

export const itemReady = i => !!(i.text.trim() || i.task || i.type);

/**
 * What the old report and Central Hub read from work items:
 * hqEntries.work [{ taskId, qty | pct, location, note }], the progress lines, and milestones reached.
 */
export function workMeta(items) {
  const work = items.filter(i => i.taskId).map(i => {
    const e = { taskId: i.taskId, location: i.zone || '', note: i.text || '' };
    if (i.unit === '%') e.pct = num(i.qty) ?? 0; else e.qty = num(i.qty) ?? 0;
    return e;
  });
  const progress = items.filter(itemReady).map(i => `• ${[itemLine(i), i.text].filter(Boolean).join(': ')}`).join('\n');
  const milestones = [...new Set(items.map(i => i.milestoneId).filter(Boolean))];
  return {
    work, progress, milestones,
    items: items.map(({ id, at, zone, type, taskId, task, text, qty, unit, photos, milestoneId, planId }) => ({ id, at, zone, type, taskId, task, text, qty: num(qty), unit, photos: photos.length, milestoneId, planned: !!planId })),
  };
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
const UNIT_WORDS = [[/^(pcs|pieces?|nos|numbers?|units?|beams?|columns?|panels?|sheets?|bolts?|trusses?|purlins?)$/i, 'pcs'], [/^(m2|sqm|square)$/i, 'm²'], [/^(m3|cubic)$/i, 'm³'], [/^(m|metres?|meters?)$/i, 'm'], [/^(kg|kilos?|kilograms?)$/i, 'kg'], [/^(tons?|tonnes?|t)$/i, 't'], [/^(%|percent)$/i, '%']];

/**
 * Fills a work item from what was said, e.g. "Zone C2, welded 4 beams and 5 columns":
 * the zone and the work type or task when their names are heard, the numbers added up when they share a unit.
 * The text is kept as said; the engineer checks it before saving.
 */
export function parseSpeech(said, { zones = [], types = [], tasks = [] } = {}) {
  const text = String(said || '').trim().replace(/\s+/g, ' ');
  const low = text.toLowerCase();
  const out = { text };
  const find = list => list.filter(Boolean).sort((a, b) => b.length - a.length).find(x => low.includes(String(x).toLowerCase()));
  const zone = find(zones) || (/(zone|block|area|axis|grid)\s+([a-z]?\d+[a-z]?|[a-z])\b/i.exec(text) || [])[0];
  if (zone) out.zone = zone.replace(/^\w/, c => c.toUpperCase());
  const task = tasks.filter(t => t && t.name).sort((a, b) => b.name.length - a.name.length).find(t => low.includes(t.name.toLowerCase()));
  if (task) { out.taskId = task.id; out.task = task.name; if (task.unit) out.unit = task.unit; }
  const type = find(types);
  if (type) out.type = type;
  // numbers followed by a unit word, in figures or words
  const tokens = low.replace(/[,.;]/g, ' ').split(' ').filter(Boolean);
  let total = 0, unit = '';
  tokens.forEach((t, i) => {
    const n = /^\d+(\.\d+)?$/.test(t) ? Number(t) : WORDS[t];
    if (n == null || (zone && zone.toLowerCase().split(' ').includes(t))) return;
    const next = (tokens[i + 1] || '').replace(/[^a-z0-9%²³]/g, '');
    const u = (UNIT_WORDS.find(([re]) => re.test(next)) || [])[1] || (next === '%' ? '%' : '');
    if (!u) return;
    if (!unit) unit = u;
    if (u === unit) total += n;
  });
  if (total) { out.qty = total; if (!out.unit) out.unit = unit; }
  return out;
}
