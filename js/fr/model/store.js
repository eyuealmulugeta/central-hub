// 2.61.0 (owner, 7 Nov, R5): the site store. The Storekeeper (or the person the PM delegates) records what comes in
// and what goes out; the PM approves every movement (owner: "every time material is given or taken"); a weekly count
// compares what is there with the books, its differences approved by the PE or GM. Issuing needs the receiver's
// signature on the phone. Kept in Central Hub's database: projects/<id>/storeMoves/<id> (the keeper: .../keeper).

export const KINDS = [
  ['receive', 'Receive', 'Goods arrived on site'],
  ['issue', 'Issue', 'Material given out'],
  ['return', 'Return', 'Unused material brought back'],
  ['transfer', 'Transfer out', 'Sent to another project'],
  ['count', 'Stock count', 'Weekly count of what is there'],
];
export const kindWord = k => (KINDS.find(([v]) => v === k) || [])[1] || k || '';
export const SIGN = { receive: 1, return: 1, issue: -1, transfer: -1 };
export const MOVE_WORD = { waiting: 'Waiting for PM', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
export const MOVE_TONE = { waiting: 'warn', approved: 'ok', rejected: 'bad', cancelled: '' };
export const UNITS = ['pcs', 'bag', 'kg', 'ton', 'm', 'm²', 'm³', 'L', 'roll', 'sheet', 'box', 'set', 'lot'];
export const COUNT_DAYS = 7;

/** The item's key: its name and unit, so "Cement bag" and "cement  Bag" are one item. */
export const itemKey = (name, unit) => `${String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${String(unit || '').trim().toLowerCase()}`;

/** Field Report roles: engineer (SE), coordinator (PE / PM), exec (GM), admin, viewer. The keeper may be any account. */
export const mayApprove = role => ['coordinator', 'exec', 'admin'].includes(role);
export const mayRecord = (role, email, keeper) => ['engineer', 'coordinator', 'exec', 'admin'].includes(role) || (!!email && String(email).toLowerCase() === String(keeper && keeper.keeper || '').toLowerCase());
export const maySetKeeper = role => ['coordinator', 'exec', 'admin'].includes(role);

const num = v => Math.round(Number(v) * 1000) / 1000;

/** Why this movement cannot be saved, or ''. f = { kind, item, unit, qty, date, supplier, to, zone, toProject, sig, photo, lines } */
export function moveProblem(f, { book = {}, projects = [], code = '' } = {}) {
  if (!KINDS.some(([v]) => v === f.kind)) return 'Choose what you are recording.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''))) return 'Choose the day.';
  if (f.kind === 'count') {
    const lines = (f.lines || []).filter(l => l.counted !== '' && l.counted != null);
    if (!lines.length) return 'Enter what you counted for at least one item.';
    if (lines.some(l => !(Number(l.counted) >= 0))) return 'A count cannot be below 0.';
    return '';
  }
  if (!String(f.item || '').trim()) return 'Enter the item.';
  if (!String(f.unit || '').trim()) return 'Choose the unit.';
  const q = Number(f.qty);
  if (!(q > 0)) return 'Enter the quantity.';
  if (q > 1e7) return 'The quantity looks too big. Check it.';
  if (f.kind === 'receive' && !String(f.supplier || '').trim()) return 'Enter the supplier (or "Transfer from …").';
  if (f.kind === 'receive' && !f.photo) return 'Take a photo of the delivery note.';
  if (f.kind === 'issue' && !String(f.to || '').trim()) return 'Enter who receives it.';
  if (f.kind === 'issue' && !f.sig) return 'The receiver signs on the phone.';
  if (f.kind === 'return' && !String(f.to || '').trim()) return 'Enter who brings it back.';
  if (f.kind === 'transfer' && (!f.toProject || f.toProject === code || !projects.some(p => p.code === f.toProject))) return 'Choose the project it goes to.';
  if (SIGN[f.kind] < 0) {
    const have = (book[itemKey(f.item, f.unit)] || { qty: 0 }).qty;
    if (q > have + 1e-9) return `Only ${have} ${f.unit} in the store (approved).`;
  }
  return '';
}

/** The record written to Central Hub. */
export function moveRecord(f, { email, byName, at, pid, id, book = {}, projects = [] }) {
  const base = { id, projectId: pid, site: true, kind: f.kind, date: f.date, status: 'waiting', by: email, byName: byName || email, at,
    note: String(f.note || '').trim().slice(0, 300), log: [{ at, by: email, byName: byName || email, status: 'waiting', note: 'Recorded on site' }] };
  if (f.kind === 'count') {
    const lines = (f.lines || []).filter(l => l.counted !== '' && l.counted != null).map(l => {
      const b = (book[l.key] || { qty: 0 }).qty;
      return { key: l.key, item: l.item, unit: l.unit, book: num(b), counted: num(l.counted), diff: num(Number(l.counted) - b) };
    });
    return { ...base, lines, qty: 0, item: `${lines.length} items counted`, unit: '' };
  }
  const item = String(f.item).trim().replace(/\s+/g, ' '), unit = String(f.unit).trim();
  const to = projects.find(p => p.code === f.toProject);
  return {
    ...base, key: itemKey(item, unit), item, unit, qty: num(f.qty),
    supplier: f.kind === 'receive' ? String(f.supplier || '').trim().slice(0, 120) : '',
    reqId: f.kind === 'receive' ? String(f.reqId || '') : '',
    to: ['issue', 'return'].includes(f.kind) ? String(f.to || '').trim().slice(0, 120) : '',
    zone: f.kind === 'issue' ? String(f.zone || '').trim().slice(0, 120) : '',
    toProject: f.kind === 'transfer' ? f.toProject : '', toProjectName: to ? to.name || to.code : '',
    sig: f.kind === 'issue' ? f.sig || '' : '', photo: f.kind === 'receive' ? f.photo || '' : '',
  };
}

const ord = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at).localeCompare(String(b.at));
const moves = list => (list || []).filter(m => m && m.id !== 'keeper' && m.kind);

/**
 * The book: { key: { item, unit, qty, waiting, last } } from the approved movements in order; an approved count sets
 * the quantity to what was counted. `waiting` is what the movements still waiting would change.
 */
export function bookOf(list) {
  const out = {};
  const at = (key, item, unit) => (out[key] ||= { key, item, unit, qty: 0, waiting: 0, last: '' });
  for (const m of moves(list).sort(ord)) {
    if (m.status !== 'approved' && m.status !== 'waiting') continue;
    if (m.kind === 'count') {
      if (m.status === 'approved') for (const l of m.lines || []) { const e = at(l.key, l.item, l.unit); e.qty = num(l.counted); e.last = m.date; }
      continue;
    }
    const e = at(m.key || itemKey(m.item, m.unit), m.item, m.unit), d = (SIGN[m.kind] || 0) * Number(m.qty || 0);
    if (m.status === 'approved') { e.qty = num(e.qty + d); e.last = m.date; } else e.waiting = num(e.waiting + d);
  }
  return out;
}

/** The items for the pick list: the store's own and the materials of the project's requests, A to Z. */
export function itemsOf(list, requests = []) {
  const m = new Map();
  for (const x of moves(list)) if (x.item && x.unit) m.set(itemKey(x.item, x.unit), { item: x.item, unit: x.unit });
  for (const q of requests || []) for (const l of q.lines || q.items || []) {
    const item = l.item || l.name || l.description, unit = l.unit || '';
    if (item && unit && !m.has(itemKey(item, unit))) m.set(itemKey(item, unit), { item, unit });
  }
  return [...m.values()].sort((a, b) => a.item.localeCompare(b.item));
}

/** Items at or under their minimum: [{ key, item, unit, qty, min }]. mins = { key: number } (set by the PM). */
export const lowOf = (book, mins = {}) => Object.values(book).filter(e => Number(mins[e.key]) > 0 && e.qty <= Number(mins[e.key])).map(e => ({ ...e, min: Number(mins[e.key]) }));

/** The last count's day, and whether one is due (none approved or waiting in the last 7 days). */
export function countDue(list, today) {
  const c = moves(list).filter(m => m.kind === 'count' && (m.status === 'approved' || m.status === 'waiting')).map(m => m.date).sort().pop() || '';
  const days = c ? Math.round((Date.parse(today) - Date.parse(c)) / 864e5) : Infinity;
  return { last: c, due: days >= COUNT_DAYS };
}

/** Newest first; the ones waiting on top. */
export const sortMoves = list => moves(list).sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || -ord(a, b));

/** One item's history (stock card), oldest first, with the balance after each approved movement. */
export function cardOf(list, key) {
  let bal = 0;
  return moves(list).filter(m => m.key === key || (m.kind === 'count' && (m.lines || []).some(l => l.key === key))).sort(ord).map(m => {
    if (m.status === 'approved') {
      if (m.kind === 'count') bal = num((m.lines.find(l => l.key === key) || {}).counted || 0);
      else bal = num(bal + (SIGN[m.kind] || 0) * Number(m.qty || 0));
    }
    const l = m.kind === 'count' ? m.lines.find(x => x.key === key) : null;
    return { id: m.id, date: m.date, kind: m.kind, status: m.status, qty: l ? l.counted : m.qty, diff: l ? l.diff : null, who: m.to || m.supplier || m.toProjectName || '', by: m.byName, bal };
  });
}

/** A one-line description for the activity record and the confirm box. */
export const moveLine = m => (m.kind === 'count' ? `Stock count, ${(m.lines || []).length} items` : `${kindWord(m.kind)} ${m.qty} ${m.unit} ${m.item}${m.to ? ` · ${m.to}` : ''}${m.toProjectName ? ` · to ${m.toProjectName}` : ''}`);
