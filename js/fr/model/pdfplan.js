// 2.11.0 (release 2, the report PDF): what goes where, as plain data, so the layout rules are tested in node.
// The top boxes and their red states, the manpower rows by tier and the equipment order.

import { totals } from './crew.js';

const sum = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** The four boxes at the top, in order: { key, title, value, label, red } (Attention has its own red box under them). */
export function topBoxes(r) {
  const s = r.safety || {}, st = r.start || {};
  const t = totals(r.crew, st.start, st.end);
  const near = !!(s.incident && s.kind === 'Near miss');
  const incident = !!(s.incident && s.kind !== 'Near miss');
  const yes = v => (v ? 'Yes' : 'No');
  return [
    { key: 'manpower', title: 'Manpower', value: String(t.present), label: 'Present', red: false },
    { key: 'equipment', title: 'Equipment', value: String(sum(r.equipment || [], e => e.qty)), label: 'On site', red: false },
    { key: 'near', title: 'Near miss', value: yes(near), label: near ? 'Reported' : 'None', red: near },
    { key: 'incident', title: 'Incident', value: yes(incident), label: incident ? s.kind || 'Reported' : 'None', red: incident },
  ];
}

/** The tier of a trade or position (Shared prompt: T1 management to T5 security); labourers last within T4. */
export function tierOf(trade) {
  const t = String(trade || '').toLowerCase();
  if (/general manager|\bgm\b|ceo|owner|board/.test(t)) return 1;
  if (/project (engineer|manager|coordinator)|accountant|\bhr\b/.test(t)) return 2;
  if (/engineer|architect|draft|\bqs\b|quantity|procurement|logistic|foreman|supervis|hse/.test(t)) return 3;
  if (/security|guard/.test(t)) return 5;
  return /labou?r/.test(t) ? 4.5 : 4;
}

/** Manpower rows (trade, qty, man-hours) by tier, top to bottom; the same tier keeps the larger crew first. */
export function manpowerRows(r) {
  const st = r.start || {};
  return totals(r.crew, st.start, st.end).byTrade.slice().sort((a, b) => tierOf(a.trade) - tierOf(b.trade) || b.qty - a.qty);
}

const EQ_ORDER = { Active: 0, Idle: 1, Breakdown: 2 };
/** Equipment: active first, then idle, then down. */
export const equipmentRows = r => (r.equipment || []).slice().sort((a, b) => (EQ_ORDER[a.status] ?? 1) - (EQ_ORDER[b.status] ?? 1));

/** Which body sections have something to show (an empty one is left out of the PDF). */
export function sectionsOf(r, { progress = [], plan = [], requests = [] } = {}) {
  const s = r.safety || {};
  return {
    progress: progress.length > 0,
    plan: plan.length > 0,
    delays: (r.delays || []).length > 0,
    materials: (r.received || []).length > 0,
    requests: requests.length > 0,
    manpower: manpowerRows(r).length > 0,
    equipment: (r.equipment || []).length > 0,
    safety: !!s.toolbox || !!s.incident,
    notes: !!String(r.notes || '').trim(),
    instructions: !!String(r.instructions || '').trim(),
  };
}
