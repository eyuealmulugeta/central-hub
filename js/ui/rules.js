// v1.89.0 (owner, 23 Nov, Release C step 2): the access-rule helpers, out of prices.js (Settings), so Settings
// can load the first time it is opened while the Directory, HR and Reports still use these at once.
import { store } from '../core/store.js';
import { pagesOf, grantableFor } from '../core/access.js';
import { positionOf, pagesFrom, frRules, blank, mayDo } from '../engine/accessrules.js';
import { fieldReady, fieldUserDo } from '../sync/fieldreport.js';
import { tell } from '../core/image.js';

/** v0.29.0: are the access rules in use? Until the Admin starts them, the page ticks of before decide. */
export const rulesOn = () => !!store.global?.access?.started;
export const rulesNow = () => store.global?.access || blank();

/** The CH pages each person opens follow the rules: write the ones that changed. Returns how many people changed. */
export function syncPages(list = store.users, rules = store.global?.access) {
  if (!rules?.started || !store.cloud) return 0;
  let n = 0;
  for (const u of list) {
    if (u.role === 'owner') continue;
    const give = pagesFrom(rules, u), want = grantableFor(u).map(([k]) => k).filter(k => give.includes(k));
    const approver = u.role === 'office' && positionOf(u) === 'general_manager';   // issuing the client PDF: Admin and GM only
    if (u.pagesV !== 2 || want.join() !== pagesOf(u).join() || !!u.approver !== approver) { store.setUser(u.email, { pages: want, pagesV: 2, approver }); n++; }
  }
  return n;
}
/** May the signed-in person do this feature? The Admin always; anyone while the rules are not started (the ticks of before decide). */
export const iMay = feat => store.isAdmin || !rulesOn() || mayDo(rulesNow(), { role: store.role, email: store.user?.email, ranks: store.ranks }, feat);
let frTimer = 0;
/** The FR part of the rules goes to the script a moment after the last change (script 7.38.0). */
export function sendRules() {
  if (!rulesOn() || !store.cloud || !fieldReady()) return;
  clearTimeout(frTimer);
  frTimer = setTimeout(async () => {
    try { await fieldUserDo('accessRules', { rules: frRules(rulesNow(), store.users) }); }
    catch (e) { tell(`✗ Field Report did not take the access rules: ${e.message}`); }
  }, 1500);
}
