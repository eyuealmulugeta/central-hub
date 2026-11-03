// v0.73.0 (owner, 3 Nov): site documents carry the responsible site person's own signature, the one they drew in
// Field Report. The server keeps each person's latest one in projects/<id>/fieldSigs/<email> = { email, name,
// position, sig, at } (functions/fieldnow.js, from a signed report); the store follows them as ws.fieldSigs.
// Pure functions. A document with no signature found keeps an empty box for a pen.

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const sigs = ws => (ws.fieldSigs || []).filter(s => typeof s.sig === 'string' && s.sig.startsWith('data:image/'));

/** The signature of the person with this name (the name on the report). */
export function sigByName(ws, name) {
  const n = norm(name);
  return (n && sigs(ws).find(s => norm(s.name) === n)) || null;
}

/** The project's Site engineer: the team member with that role, else the newest signature given as a site engineer. */
export function siteEngineerSig(ws) {
  const m = (ws.team || []).find(x => x.active !== false && /site engineer/i.test(x.role || ''));
  return (m && sigByName(ws, m.name)) || sigs(ws).filter(s => /site engineer/i.test(s.position || '')).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
}

/** Who sent most of the site reports from `from` to `to` (the newest of them on a tie), and their signature. */
export function reporterSig(ws, from, to) {
  const count = new Map();
  for (const r of (ws.reports || []).filter(x => x.source === 'field' && x.by && x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date))) {
    count.set(r.by, (count.get(r.by) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [by, k] of count) if (k >= n) { best = by; n = k; }
  return best ? { name: best, sig: sigByName(ws, best)?.sig || '' } : null;
}
