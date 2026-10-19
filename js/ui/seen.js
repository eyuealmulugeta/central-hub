// Which alerts on Home this person has already opened. Kept in this browser,
// per project: the red number beside Home counts the ones not opened yet.

const storeKey = projectId => `sf:seen:${projectId}`;

function read(projectId) {
  try { return new Set(JSON.parse(localStorage.getItem(storeKey(projectId))) || []); } catch { return new Set(); }
}

export const flagKey = f => `${f.kind}|${f.title}`;
export const itemKey = i => `item|${i.id}`;

/** Keys of everything that counts towards the red number. */
export function alertKeys(flags) {
  return [...flags.auto.filter(f => f.sev !== 'info').map(flagKey),
    ...flags.items.filter(i => i.overdue || i.reminderDue).map(itemKey)];
}

/** A lookup of the alerts not opened yet: `unseen.has(key)`, `unseen.size`. */
export function unseenAlerts(projectId, flags) {
  const seen = read(projectId);
  return new Set(alertKeys(flags).filter(k => !seen.has(k)));
}

/** How many of a project's alerts (by key) have not been opened yet. For projects that are not the open one. */
export function unseenCount(projectId, keys) {
  const seen = read(projectId);
  return new Set((keys || []).filter(k => !seen.has(k))).size;
}

/** What is kept on a project so the sidebar can show its progress and alerts without loading it. */
/**
 * The percentage shown beside a project. It is work progress when the project has a schedule.
 * A project with no schedule yet shows how much of the contract value has been invoiced, and says so.
 */
export function headline(d) {
  if (d.sched.rows.length) return { progress: d.sched.progress, basis: 'work' };
  const value = d.project.contractValue;
  if (value > 0 && d.bill.invoiced > 0) return { progress: Math.min(100, d.bill.invoiced / value * 100), basis: 'billed' };
  return { progress: 0, basis: 'none' };
}
/** A project's money in whole units of its own currency, for the company Home page. */
export const moneyOf = d => ({
  invoiced: Math.round(d.bill.invoiced), received: Math.round(d.led.income), spent: Math.round(d.led.spent),
  owed: Math.round(d.bill.outstanding), currency: d.project.currency,
});
export const summaryOf = d => {
  const h = headline(d);
  return { progress: Math.round(h.progress), basis: h.basis, slip: d.sched.slip, alerts: alertKeys(d.flags), money: moneyOf(d) };
};

/** Mark a set of alerts (by key) as opened, for any project: "Mark as read". */
export function markKeysSeen(projectId, keys) {
  try { localStorage.setItem(storeKey(projectId), JSON.stringify([...new Set(keys || [])])); } catch { /* private window: the number just stays */ }
}

/** Mark one alert as opened. Alerts that no longer exist are forgotten, so one that comes back counts again. */
export function markSeen(projectId, flags, key) {
  const live = new Set(alertKeys(flags));
  const seen = [...read(projectId)].filter(k => live.has(k));
  if (live.has(key) && !seen.includes(key)) seen.push(key);
  try { localStorage.setItem(storeKey(projectId), JSON.stringify(seen)); } catch { /* private window: the number just stays */ }
}
