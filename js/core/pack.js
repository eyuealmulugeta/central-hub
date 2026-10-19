// Data packs: a file of records prepared outside Central Hub (for example
// converted from an Excel workbook by tools/*.py) and merged into the open
// project. Importing the same pack again replaces its own records instead of
// duplicating them, because every record in a pack has a fixed id.

import { emptyWorkspace, emptyCompany } from './schema.js';
import { sum } from './util.js';

const WS_SHAPE = emptyWorkspace();
const CO_SHAPE = emptyCompany();

/** Throws with a message a person can act on when the file is not a usable pack. */
export function checkPack(pack) {
  if (pack?.app === 'siteflow') throw new Error('This is a full backup, not a data pack. Load it with Backup, Import JSON.');
  if (pack?.app !== 'central-hub-pack') throw new Error('This file is not a Central Hub data pack.');
  for (const [section, value] of Object.entries(pack.workspace || {})) {
    if (!(section in WS_SHAPE)) throw new Error(`The pack has a section Central Hub does not know: ${section}.`);
    if (Array.isArray(WS_SHAPE[section]) && value.some(r => !r.id)) throw new Error(`A record under ${section} has no id.`);
  }
  for (const section of Object.keys(pack.company || {})) {
    if (!(section in CO_SHAPE)) throw new Error(`The pack has a company section Central Hub does not know: ${section}.`);
  }
  return pack;
}

/** What a pack holds, in the words of the preview. */
export function packSummary(pack) {
  const w = pack.workspace || {};
  const invoices = (w.docs || []).filter(d => d.type === 'invoice');
  const ledger = w.ledger || [];
  const reports = w.reports || [];
  const dates = reports.map(r => r.date).sort();
  return {
    title: pack.title || 'Data pack', source: pack.source || '', made: pack.made || '',
    reports: reports.length, from: dates[0] || '', to: dates.at(-1) || '',
    personDays: sum(reports, r => sum(r.manpower || [], m => m.count)),
    invoices: invoices.length, invoiced: sum(invoices.filter(d => d.status !== 'draft'), d => d.subtotal), drafts: sum(invoices.filter(d => d.status === 'draft'), d => d.subtotal),
    payments: ledger.filter(e => e.type === 'income').length, received: sum(ledger.filter(e => e.type === 'income'), e => e.amount),
    costs: ledger.filter(e => e.type === 'expense').length, spent: sum(ledger.filter(e => e.type === 'expense'), e => e.amount),
    tasks: (w.tasks || []).length, team: (w.team || []).length,
    rates: Object.keys(w.billRates || {}).length,
    staff: (pack.company?.staff || []).length, shipments: (pack.company?.shipments || []).length, contracts: (pack.company?.contracts || []).length,
    // every ledger line of a pack is in one currency, the one the project is switched to
    currency: pack.project?.currency || ledger[0]?.currency || '',
    notes: pack.notes || [],
  };
}

function merge(target, shape, incoming, skip = []) {
  let added = 0, replaced = 0;
  for (const [section, value] of Object.entries(incoming || {})) {
    if (skip.includes(section)) continue;
    if (Array.isArray(shape[section])) {
      for (const rec of value) {
        const i = target[section].findIndex(r => r.id === rec.id);
        // the order stamp of a record already saved is kept, so lists do not reshuffle
        if (i < 0) { target[section].push(structuredClone(rec)); added++; } else { target[section][i] = { ...structuredClone(rec), ...(target[section][i]._o != null ? { _o: target[section][i]._o } : {}) }; replaced++; }
      }
    } else {
      for (const [k, v] of Object.entries(value)) { if (k in target[section]) replaced++; else added++; target[section][k] = v; }
    }
  }
  return { added, replaced };
}

/** Merge the pack's project records into a workspace. */
export const applyToWorkspace = (ws, pack) => merge(ws, WS_SHAPE, pack.workspace);

/** Merge the pack's company records. `skip` names sections this person may not write (HR for anyone but the Owner). */
export function applyToCompany(company, pack, projectId, skip = []) {
  const incoming = structuredClone(pack.company || {});
  // company records in a pack belong to the project it is imported into
  for (const list of Object.values(incoming)) for (const rec of list) if (!rec.projectId) rec.projectId = projectId;
  return merge(company, CO_SHAPE, incoming, skip);
}

/** Project settings the pack sets; nested settings are merged, not replaced. */
export function applyToProject(project, pack) {
  for (const [k, v] of Object.entries(pack.project || {})) {
    project[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...project[k], ...v } : v;
  }
}
