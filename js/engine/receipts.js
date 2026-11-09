// Discuss: Sent / Delivered / Seen (owner, 9 Nov: "show delivered, seen, sent tags in both FR and CH").
// Each person keeps one small record per conversation: company/main/chatSeen/<channel>~<email> for a channel,
// company/main/dmSeen/<a>|<b>~<email> for a one-to-one chat (members = the two). got = the newest message time their
// Central Hub or Field Report has received in it (Delivered), seen = the newest one they had open on screen (Seen).
// The times are the messages' own, so a phone's clock never matters. Same file in Central Hub and Field Report.

const low = s => String(s || '').trim().toLowerCase();
/** The conversation of a message: the channel, or the two emails joined. */
export const chatKey = m => (Array.isArray(m?.members) ? m.members.map(low).sort().join('|') : String(m?.channel || ''));
export const receiptId = (chat, who) => `${chat}~${low(who)}`;

/** The records to write so that `field` ('got' or 'seen') reaches the newest message of each conversation (or only `only`). */
export function receiptWrites({ list = [], mine = [], me, name = '', field = 'got', only = '' }) {
  const e = low(me), have = new Map(mine.filter(r => r.who === e).map(r => [r.chat, r]));
  const last = new Map(), pair = new Map();
  for (const m of list) {
    const k = chatKey(m), at = String(m.at || '');
    if (!k || !at || (only && k !== only)) continue;
    if (m.members && !m.members.map(low).includes(e)) continue;
    if (at > (last.get(k) || '')) last.set(k, at);
    if (m.members) pair.set(k, m.members.map(low).sort());
  }
  const out = [];
  for (const [k, at] of last) {
    const r = have.get(k) || {};
    if (String(r[field] || '') >= at) continue;
    const got = String(r.got || '') > at ? String(r.got) : at;   // seen is also delivered
    const data = { chat: k, who: e, name: String(name || ''), got: field === 'got' ? at : got, seen: field === 'seen' ? at : String(r.seen || '') };
    if (pair.has(k)) data.members = pair.get(k);
    out.push({ sec: pair.has(k) ? 'dmSeen' : 'chatSeen', id: receiptId(k, e), data });
  }
  return out;
}

/** The tag under one's own message: { k: 'sent' | 'delivered' | 'seen', text, names }. */
export function tagOf(m, receipts = [], me) {
  const e = low(me), k = chatKey(m), at = String(m.at || '');
  const rs = receipts.filter(r => r.chat === k && r.who !== e);
  const seen = rs.filter(r => String(r.seen || '') >= at), got = rs.filter(r => String(r.got || '') >= at || String(r.seen || '') >= at);
  const names = list => list.map(r => r.name || r.who).join(', ');
  if (m.members) return seen.length ? { k: 'seen', text: 'Seen', names: '' } : got.length ? { k: 'delivered', text: 'Delivered', names: '' } : { k: 'sent', text: 'Sent', names: '' };
  if (seen.length) return { k: 'seen', text: `Seen by ${seen.length}`, names: names(seen) };
  if (got.length) return { k: 'delivered', text: `Delivered to ${got.length}`, names: names(got) };
  return { k: 'sent', text: 'Sent', names: '' };
}
/** The tick mark of a tag. */
export const tick = t => (t.k === 'sent' ? '✓' : '✓✓');

/** Put a written record in the local list at once, so it is not written twice before the database answers. */
export function keep(list, w) { return [...list.filter(r => receiptId(r.chat, r.who) !== w.id), w.data]; }
