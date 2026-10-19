// How a workspace maps onto cloud documents. Every record is its own document
// (projects/<id>/<section>/<recordId>), so two people editing different records,
// or someone syncing after hours offline, never overwrite each other's work.

import { emptyWorkspace, emptyCompany } from './schema.js';

const SHAPE = emptyWorkspace();
export const SECTIONS = Object.keys(SHAPE);
/** Sections of the company-wide records. All of them are lists. */
export const COMPANY_SECTIONS = Object.keys(emptyCompany());
/** List sections hold records with an id; the others are key -> value maps. */
export const isList = section => !(section in SHAPE) || Array.isArray(SHAPE[section]);

// Document ids cannot contain "/", and trade names such as "Welder / fitter" do.
const docId = key => encodeURIComponent(key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function toDocs(section, value) {
  const docs = new Map();
  if (isList(section)) for (const rec of value || []) docs.set(rec.id, rec);
  else for (const [k, v] of Object.entries(value || {})) docs.set(docId(k), { k, v });
  return docs;
}

/** Writes that turn `before` into `after`: [{ section, id, data }], data null = delete. */
export function diffWorkspace(before, after, sections = SECTIONS) {
  const ops = [];
  for (const section of sections) {
    const was = toDocs(section, before[section]);
    const now = toDocs(section, after[section]);
    for (const [id, data] of now) if (!same(was.get(id), data)) ops.push({ section, id, data: JSON.parse(JSON.stringify(data)) });
    for (const id of was.keys()) if (!now.has(id)) ops.push({ section, id, data: null });
  }
  return ops;
}

/** Rebuild a section from its documents. */
export function sectionFromDocs(section, docs) {
  return isList(section)
    ? [...docs].sort((a, b) => (a._o || 0) - (b._o || 0))
    : Object.fromEntries(docs.map(d => [d.k, d.v]));
}

/** Documents have no order, so each new record gets an increasing `_o` to keep lists in creation order. */
export function stamp(ws, sections = SECTIONS) {
  const base = Date.now() * 1000;
  let n = 0;
  for (const section of sections) {
    if (!isList(section)) continue;
    for (const rec of ws[section] || []) if (rec._o == null) rec._o = base + n++;
  }
}
