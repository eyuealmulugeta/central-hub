// Contacts: the email addresses and phone numbers people send documents to, saved once and found by name afterwards.
// Each project also remembers who its documents were sent to and who was copied, so the next email is filled in.
// Pure functions; the Contacts page and the email dialog use them.

export const DEFAULT_DOMAIN = 'gmail.com';
/** Phone numbers written with a leading 0 are taken as Ethiopian (+251) unless they say otherwise with + or 00. */
export const DEFAULT_COUNTRY_CODE = '251';

const lower = s => String(s || '').trim().toLowerCase();
const words = s => lower(s).split(/[^a-z0-9]+/).filter(Boolean);

/** "melaku.mangisto" or "2e.construction.gc" as a name to read: "Melaku Mangisto". */
export const prettyName = email => lower(email).split('@')[0].split(/[._\-+]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/** A list typed in one box (commas, semicolons or lines) as separate entries. */
export const splitList = text => String(text || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);

/** The one saved contact a typed name stands for: the exact name, else the only contact whose name (or a word of it) starts with it. */
export function byName(text, contacts) {
  const t = lower(text);
  if (!t) return null;
  const exact = contacts.filter(c => lower(c.name) === t);
  if (exact.length === 1) return exact[0];
  const starts = contacts.filter(c => lower(c.name).startsWith(t) || words(c.name).some(w => w.startsWith(t)));
  return starts.length === 1 ? starts[0] : null;
}

/**
 * What one typed entry means as an address: an address stays as typed (lower case); a saved name becomes that contact's
 * address; a plain word with no @ gets "@gmail.com"; anything else (several words, no contact by that name) is left alone.
 */
export function resolveOne(part, contacts = [], domain = DEFAULT_DOMAIN) {
  const t = String(part || '').trim();
  if (!t) return '';
  if (t.includes('@')) return t.toLowerCase();
  const hit = byName(t, contacts);
  if (hit) return lower(hit.email);
  return /^[^\s@]+$/.test(t) ? `${t.toLowerCase()}@${domain}` : t;
}

/** A whole box: every entry resolved, written back separated by ", ". */
export const resolveList = (text, contacts = [], domain = DEFAULT_DOMAIN) => splitList(text).map(p => resolveOne(p, contacts, domain)).join(', ');

/** What to offer while typing: contacts whose name, address or company contains the last entry, and the plain word as a Gmail address. */
export function suggestions(text, contacts = [], limit = 8, domain = DEFAULT_DOMAIN) {
  const last = String(text || '').split(/[,;\n]/).pop().trim().toLowerCase();
  const found = contacts.filter(c => !last || [c.name, c.email, c.company].some(v => lower(v).includes(last)))
    .sort((a, b) => String(b.used || '').localeCompare(String(a.used || '')) || lower(a.name).localeCompare(lower(b.name)))
    .slice(0, limit)
    .map(c => ({ email: lower(c.email), label: c.name || c.email }));
  if (last && /^[^\s@]+$/.test(last) && !found.some(f => f.email === `${last}@${domain}`)) found.push({ email: `${last}@${domain}`, label: 'Gmail address' });
  return found;
}

/**
 * Remember the people an email went to, for a project. `entries` are { email, name?, phone?, as: 'to' | 'cc' }.
 * A new address becomes a contact (named from its address until a name is written); a known one is kept and the project is added
 * to its To or Copy list. Returns the new list of contacts; the old one is not changed.
 */
export function remember(contacts, entries, { projectId = '', today = '', newId = () => `ct${Math.random().toString(36).slice(2, 9)}` } = {}) {
  const out = contacts.map(c => ({ ...c, to: [...(c.to || [])], cc: [...(c.cc || [])] }));
  for (const e of entries) {
    const email = lower(e.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    let c = out.find(x => lower(x.email) === email);
    if (!c) { c = { id: newId(), name: String(e.name || '').trim() || prettyName(email), email, phone: '', company: '', to: [], cc: [], used: today }; out.push(c); }
    if (e.phone && !c.phone) c.phone = String(e.phone).trim();
    if (projectId) {
      const key = e.as === 'cc' ? 'cc' : 'to';
      if (!c[key].includes(projectId)) c[key].push(projectId);
    }
    if (today) c.used = today;
  }
  return out;
}

/** Who a project's documents went to last times: { to: [emails], cc: [emails] }. A person who was To is not also offered as Copy. */
export function defaultsFor(contacts, projectId) {
  const mine = key => contacts.filter(c => projectId && (c[key] || []).includes(projectId)).map(c => lower(c.email));
  const to = mine('to');
  return { to, cc: mine('cc').filter(e => !to.includes(e)) };
}

/** A phone number as WhatsApp and Telegram write it: digits only, with the country code. '' when it is not a number. */
export function phoneDigits(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  const text = String(raw || '').trim();
  let digits = text.replace(/\D+/g, '');
  if (digits.length < 7) return '';
  if (text.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `${countryCode}${digits.slice(1)}`;
  return digits;
}

export const whatsappTo = (phone, text) => `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
export const telegramTo = phone => `https://t.me/+${phoneDigits(phone)}`;
