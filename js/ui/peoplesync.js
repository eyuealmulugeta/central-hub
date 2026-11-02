// v0.57.0 (owner, 2 Nov): the Manpower Directory is the one source of each person's details. The Admin's Central Hub
// keeps the rest in step by itself: positions kept in an old spelling take the listed words ("Site manager" is
// Project Engineer), each sign-in's title and ranks follow the person's positions (Access rules showed old ones), and
// a team member typed by name who is the one person of that name in the directory is linked to them (before, the same
// name showed as "in" on one page and "not in the directory" on another).

import { store } from '../core/store.js';
import { titleFixes, userSyncPatches, sameNameLinks } from '../engine/manpower.js';
import { syncPages, sendRules } from './prices.js';

let busy = false;
const sent = new Map();   // email -> the patch sent, so one is not sent again before the sign-in list catches up
export function syncPeople() {
  if (busy || !store.isAdmin || store.readOnly || store.loading || !store.isPrimary) return;
  busy = true;
  try {
    const fixes = titleFixes(store.company?.staff);
    if (fixes.length) {
      store.updateCompany(co => {
        for (const f of fixes) { const p = (co.staff || []).find(x => x.id === f.id); if (p) { p.title = f.title; if (p.titles) p.titles = f.titles; } }
      });
    }
    const users = userSyncPatches(store.users, store.company?.staff).filter(({ email, patch }) => sent.get(email) !== JSON.stringify(patch));
    users.forEach(({ email, patch }) => sent.set(email, JSON.stringify(patch)));
    for (const { email, patch } of users) store.setUser(email, patch);
    if (users.length) {
      try { syncPages(users.map(({ email, patch }) => ({ ...store.users.find(u => u.email === email), ...patch }))); sendRules(); } catch { /* sent again next time */ }
    }
    const team = store.project?.id ? store.ws?.team : null;
    const links = team ? sameNameLinks(team, store.company?.staff) : [];
    if (links.length) store.update(ws => { for (const l of links) { const m = ws.team.find(x => x.id === l.id); if (m) m.personId = l.personId; } });
  } finally { busy = false; }
}
