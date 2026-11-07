// v0.97.0 (owner, 6-7 Nov, R3): penalties given on site in Field Report (projects/<id>/penalties/<id>).
// The Site Engineer gives one (reason + amount, ETB); the Project Engineer or the GM approves or rejects it, in Field
// Report or here. An approved one is taken off the person's pay (Payments for the crew, Payroll for monthly staff)
// and shows on the Attendance sheet on its day.

export const REASONS = { misconduct: 'Misconduct', late: 'Late start', early: 'Early finish' };
export const reasonWord = k => REASONS[k] || k || '';
export const PEN_WORD = { waiting: 'Waiting for PE or GM', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Is this penalty about this person ({ id: team id, name })? */
export const isOf = (p, person) => (p.personId && person.id ? String(p.personId) === String(person.id) : same(p.name, person.name));

/** The approved penalties of a person between two days (both included). */
export const approvedOf = (list, person, from, to) => (list || []).filter(p => p.status === 'approved' && p.date >= from && p.date <= to && isOf(p, person));

/** { total, n } of the approved penalties of a person in a period. */
export function penaltyOf(list, person, from, to) {
  const l = approvedOf(list, person, from, to);
  return { total: Math.round(l.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100, n: l.length };
}

/** Payroll: the penalties of a staff record, through the project team members linked to it (or of the same name). */
export function staffPenalty(list, team, staff, from, to) {
  const ids = (team || []).filter(m => (m.personId && m.personId === staff.id) || same(m.name, staff.name)).map(m => ({ id: m.id, name: m.name }));
  const people = ids.length ? ids : [{ id: '', name: staff.name }];
  const seen = new Set(), out = { total: 0, n: 0 };
  for (const who of people) for (const p of approvedOf(list, who, from, to)) if (!seen.has(p.id)) { seen.add(p.id); out.total += Number(p.amount) || 0; out.n++; }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}

/** Waiting ones first, then the newest. */
export const sorted = list => [...(list || [])].filter(p => p.status !== 'cancelled')
  .sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || String(b.date).localeCompare(String(a.date)));

/** A decision made in Central Hub, with who and when (the same fields Field Report writes). */
export function decided(p, status, { email, name, at }) {
  return { ...p, status, decidedBy: email, decidedByName: name || email, decidedAt: at, log: [...(p.log || []), { at, by: email, byName: name || email, status, note: 'In Central Hub' }] };
}
