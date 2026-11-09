// v0.44.0 (Phase E3a): Compare. The reports of a project as the script sent them (imported every 2 minutes) beside
// the reports the phones wrote to the database themselves (Data route "Both"). Counted from the database's first
// report, so the days before the switch are not listed as differences.

const noOf = x => String(Number(x) || '');

/**
 * script: the project's reports records (source 'field'); db: its fieldReports records.
 * v0.89.0: start = the day route Both was switched on. Only days from then are compared on both sides, so an old
 * report a phone copied later (re-sent from its memory) no longer pulls the start back, and a project whose phones
 * never copied anything shows its missing days. Without start, the database's first report as before.
 */
export function compareReports(script = [], db = [], start = '', startAt = '') {
  const on = r => r.date && (!start || r.date >= start);
  // v1.14.1 (owner, 8 Nov): a report the script received before the route was switched on (that day, earlier) had no
  // database copy to make: Kinshasa's 01/11, sent at 12:17 with Both on at 14:08, is not a difference
  const before = r => !!startAt && !!(r.field?.receivedAt || r.field?.pressedAt) && String(r.field.receivedAt || r.field.pressedAt) < startAt;
  const s = new Map(script.filter(r => r.source === 'field' && on(r) && !before(r) && !r.field?.nowork).map(r => [r.date, noOf(r.field?.no)]));
  const d = new Map(db.filter(on).map(r => [r.date, noOf(r.no)]));
  const from = start || [...d.keys()].sort()[0] || '';
  const since = [...s.keys()].filter(k => from && k >= from);
  const last = m => [...m.keys()].sort().pop() || '';
  return {
    from,
    script: { n: since.length, last: last(s) },
    db: { n: d.size, last: last(d) },
    onlyScript: since.filter(k => !d.has(k)).sort(),
    onlyDb: [...d.keys()].filter(k => !s.has(k)).sort(),
    byServer: db.filter(r => on(r) && r.fromScript).map(r => r.date).sort(),   // v1.33.0: the phone did not send these
    numbers: [...d.keys()].filter(k => s.has(k) && s.get(k) && d.get(k) && s.get(k) !== d.get(k)).sort().map(k => ({ date: k, script: s.get(k), db: d.get(k) })),
  };
}

/** True when nothing differs. */
export const clean = c => !c.onlyScript.length && !c.onlyDb.length && !c.numbers.length;
