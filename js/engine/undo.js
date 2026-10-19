// Undo for what a person just took away: records deleted, and text or list items cleared.
// Works on any workspace or company object, so every screen gets it without its own code.
// Adding a record is not undone here: in the cloud only the Admin deletes, so an undo of an
// addition could be refused. Pure functions; the store offers the Undo and the page shows it.

const isMap = v => v && typeof v === 'object' && !Array.isArray(v);

/** How many text fields were emptied or list items dropped inside one record. */
function clearedIn(before, after) {
  let n = 0;
  for (const key of Object.keys(before)) {
    if (key === '_o') continue;
    const was = before[key], now = after[key];
    if (typeof was === 'string' && was.trim() !== '' && (now === undefined || (typeof now === 'string' && now.trim() === ''))) n++;
    else if (Array.isArray(was) && was.length && Array.isArray(now) && now.length < was.length) n += was.length - now.length;
  }
  return n;
}

const nameOf = r => r.name || r.title || r.number || r.description || r.ref || r.text || (r.date ? `report of ${r.date}` : '') || r.id || 'an item';

/**
 * What changed for the worse between two states, over the given list and map sections.
 * Returns null when nothing was deleted or cleared, else { removed, edited, label }.
 */
export function lostBetween(before, after, sections) {
  const removed = [], edited = [];
  let cleared = 0;
  for (const section of sections) {
    const was = before?.[section], now = after?.[section];
    if (Array.isArray(was)) {
      const left = new Map((now || []).map(r => [r.id, r]));
      for (const [index, record] of was.entries()) {
        const next = left.get(record.id);
        if (!next) removed.push({ section, record, index });
        else {
          const n = clearedIn(record, next);
          if (n) { edited.push({ section, record }); cleared += n; }
        }
      }
    } else if (isMap(was)) {
      for (const key of Object.keys(was)) if (!isMap(now) || !(key in now)) removed.push({ section, key, value: was[key] });
    }
  }
  if (!removed.length && !edited.length) return null;
  const parts = [];
  if (removed.length) parts.push(removed.length === 1 ? `Deleted ${removed[0].record ? `"${String(nameOf(removed[0].record)).slice(0, 50)}"` : `"${removed[0].key}"`}` : `Deleted ${removed.length} items`);
  if (cleared) parts.push(`${removed.length ? 'cleared' : 'Cleared'} ${cleared} ${cleared === 1 ? 'entry' : 'entries'}`);
  return { removed, edited, label: parts.join(', ') };
}

/** Put back what `lostBetween` found, into `target` (the live workspace or company object). */
export function restore(target, lost) {
  for (const { section, record, key, value, index } of lost.removed) {
    if (record) {
      // back where it was in the list, not at the end
      if (!target[section].some(r => r.id === record.id)) target[section].splice(Math.min(index ?? target[section].length, target[section].length), 0, structuredClone(record));
    } else if (!(key in target[section])) {
      target[section][key] = structuredClone(value);
    }
  }
  for (const { section, record } of lost.edited) {
    const i = target[section].findIndex(r => r.id === record.id);
    if (i >= 0) target[section][i] = structuredClone(record);
    else target[section].push(structuredClone(record));
  }
}
