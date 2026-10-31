// v0.28.0: the crew list the site sends from Field Report (script 7.37.0): names, trades and daily wages by trade.
// Approving puts each person on that project's team only, with their daily wage. A wage that is not the daily wage
// of the trade is kept but flagged (wageReview) until the Admin clears it on Payments. A person can be moved from one
// project to another: off the first team (kept in its records), on the second with the same day rate. Pure functions.

import { setDayRate, dayRateOf } from './people.js';

export const wageDiffers = r => +r.wage > 0 && +r.tradeWage > 0 && +r.wage !== +r.tradeWage;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Puts the approved people on a project's team (a name already there is switched back on). Returns the members. */
export function approveCrew(ws, reqs, newId, at) {
  ws.laborRates ||= {};
  const made = [];
  for (const r of reqs) {
    const name = String(r.name || '').trim();
    if (!name) continue;
    if (r.trade && +r.tradeWage > 0 && !(+ws.laborRates[r.trade] > 0)) ws.laborRates[r.trade] = +r.tradeWage;
    let m = ws.team.find(x => same(x.name, name));
    if (m) { m.active = true; if (!m.role) m.role = r.trade || ''; }
    else { m = { id: newId(), name, role: r.trade || '', contact: '', level: 'crew', active: true }; ws.team.push(m); }
    m.fromSite = { by: r.by || '', at: r.at || at };
    const wage = +r.wage > 0 ? +r.wage : +r.tradeWage || 0;
    if (wage) setDayRate(ws, m.id, wage);
    if (wageDiffers(r)) m.wageReview = { wage: +r.wage, tradeWage: +r.tradeWage, at }; else delete m.wageReview;
    made.push(m);
  }
  return made;
}

/** Moves a team member from one project's workspace to another's. Returns the member on the new team. */
export function transferMember(from, to, memberId, newId, at, fromName = '') {
  const m = from.team.find(x => x.id === memberId);
  if (!m) return null;
  const rate = dayRateOf(from, m.id);
  m.active = false;
  let n = to.team.find(x => (m.personId ? x.personId === m.personId : !x.personId && same(x.name, m.name)));
  if (n) n.active = true;
  else { n = { ...m, id: m.personId ? m.id : newId(), active: true }; to.team.push(n); }
  n.movedFrom = { project: fromName, at };
  if (rate) setDayRate(to, n.id, rate);
  return n;
}
