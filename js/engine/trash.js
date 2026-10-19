// The recycle bin for deleted field reports. A deleted report waits here for 30 days with the
// follow-ups it opened, and can be restored or deleted for good. Nothing leaves the bin by itself
// except after the 30 days. Pure functions; the screen is ui/reports.js.

export const RETENTION_DAYS = 30;
const DAY = 86_400_000;

/** The bin entry for a report about to be deleted: a copy of it and of the follow-ups it opened. */
export function toTrash(report, ws, who, now = new Date().toISOString()) {
  return {
    id: `tr_${report.id}`, kind: 'report', deletedAt: now, by: who.by || '', byName: who.byName || '',
    record: structuredClone(report),
    // field reports open follow-ups named <report id>_<n>
    items: (ws.items || []).filter(i => String(i.id).startsWith(`${report.id}_`)).map(i => structuredClone(i)),
  };
}

export const expiresAt = rec => new Date(Date.parse(rec.deletedAt) + RETENTION_DAYS * DAY).toISOString();
export const isExpired = (rec, now = new Date().toISOString()) => Date.parse(now) >= Date.parse(rec.deletedAt) + RETENTION_DAYS * DAY;

/** Whole days left before it is removed for good, never below 0. */
export const daysLeft = (rec, now = new Date().toISOString()) => Math.max(0, Math.ceil((Date.parse(rec.deletedAt) + RETENTION_DAYS * DAY - Date.parse(now)) / DAY));

/** Entries really in the bin: not one whose report is already back in the list (an Undo), nor one past 30 days. Newest first. */
export const inBin = (ws, now = new Date().toISOString()) => (ws.trash || []).filter(t => t.record && !isExpired(t, now) && !ws.reports.some(r => r.id === t.record.id))
  .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));

/** Ids of the reports in the bin, so an import from Field Report does not bring them back meanwhile. */
export const trashedIds = ws => new Set((ws.trash || []).map(t => t.record?.id).filter(Boolean));

/** Put a report back from the bin. Returns { ok, message }. */
export function restore(ws, id) {
  const rec = (ws.trash || []).find(t => t.id === id);
  if (!rec) return { ok: false, message: 'That item is no longer in the bin.' };
  if (ws.reports.some(r => r.id === rec.record.id)) return { ok: false, message: 'That report is already back in the list.' };
  ws.reports.push(structuredClone(rec.record));
  for (const item of rec.items || []) if (!ws.items.some(i => i.id === item.id)) ws.items.push(structuredClone(item));
  ws.trash = ws.trash.filter(t => t.id !== id);
  return { ok: true, message: 'Restored.' };
}

/** Remove what is past 30 days, and entries whose report came back by Undo. Returns how many went. */
export function purge(ws, now = new Date().toISOString()) {
  const before = (ws.trash || []).length;
  ws.trash = (ws.trash || []).filter(t => !isExpired(t, now) && !(t.record && ws.reports.some(r => r.id === t.record.id)));
  return before - ws.trash.length;
}
