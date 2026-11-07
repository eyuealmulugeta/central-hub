// v0.99.0 (owner, 7 Nov, Phase G1): the activity record's bus. The print, PDF, share, email and download helpers call
// act(...) and know nothing else; main.js sets the sink, which adds the page and hands the entry to the store
// (activity/<id>, engine/activity.js). Nothing here may throw into the helper that called it.

let sink = null;
export const setSink = fn => { sink = fn; };
/** e: { action: generate|print|share|email|download|save, channel, doc, no, to } */
export function act(e) {
  try { if (sink) sink(e || {}); } catch { /* the record never stops the work */ }
}
