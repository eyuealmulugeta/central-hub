// v0.33.0: the crew form. A person fills in their own details from a link (crew.html), reading them from their
// Fayda ID or passport first; the Admin reviews the form in Central Hub and accepts it as an employee record.
// Pure functions: the page (crewpage.js) and the hub (ui/crewforms.js) share them, and the tests read them.

import { parseMrz, datesIn, NATIONALITY } from './docread.js';

/** How long a link stays open: one person (until used), or a crew link that takes as many people as come. */
export const LINK_DAYS = { one: 7, crew: 3 };
/** The trades of the site (the same list as Field Report's), with "Other" for one not listed. */
export const TRADES = ['Foreman', 'Site supervision', 'Site Technician', 'Welder / fitter', 'Rigger / erector', 'Crane operator', 'Mason', 'Carpenter', 'Steel fixer', 'Electrician', 'Plumber', 'Painter', 'Driver', 'Labourer'];
/** The fields a form may hold. Must match crewFormOk() in firestore.rules. */
export const FORM_FIELDS = ['id', 'link', 'doc', 'name', 'gender', 'birthday', 'nationality', 'phone', 'address', 'emergency', 'emergencyPhone', 'trade',
  'idNumber', 'fin', 'passportNumber', 'passportExpiry', 'idExpiry', 'certificate', 'photo', 'idFront', 'idBack', 'passportImage', 'at', 'status'];
export const IMAGES = ['photo', 'idFront', 'idBack', 'passportImage'];
/** Largest picture kept in a form, in characters of its data URL (about 190 KB). Must match firestore.rules. */
export const MAX_IMAGE_CHARS = 260000;
/** Pictures on the form are made this small before they are sent (core/image.js limits). */
export const FORM_PHOTO = { maxBytes: 140 * 1024, maxSide: 640 };
export const FORM_ID = { maxBytes: 185 * 1024, maxSide: 1400 };

/** A link's secret id: 40 hex characters, so it cannot be guessed. */
export function newLinkId(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(20)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** The id of one form under a crew link (the one-person link's form takes the link's own id). */
export const formIdOf = (link, random = n => crypto.getRandomValues(new Uint8Array(n))) =>
  (link.kind === 'one' ? link.id : `${link.id}-${[...random(4)].map(b => b.toString(16).padStart(2, '0')).join('')}`);
/** The address a link opens. */
export const linkUrl = (id, base = 'https://hub.amistadprefab.com/') => `${base.replace(/\/?$/, '/')}crew.html?l=${id}`;

/** A new link record. `kind` 'one' (one person, `name` and `email` are theirs) or 'crew' (as many as come). */
export function makeLink({ kind = 'one', name = '', email = '', projectId = '', projectName = '', by, byName = '', now = Date.now(), id = newLinkId(), trades = [] }) {
  const k = kind === 'crew' ? 'crew' : 'one';
  // v0.57.0: the link carries the Manpower Directory's trades, so the form offers the same list (no tiers shown)
  return { id, kind: k, name: String(name).trim(), email: String(email).trim().toLowerCase(), projectId, projectName, by, byName, at: new Date(now).toISOString(), untilMs: now + LINK_DAYS[k] * 864e5, status: 'open', ...(trades.length ? { trades: [...new Set(trades.map(String))].slice(0, 200) } : {}) };
}
/** v0.46.0: Ask for changes: the link opens again for 7 days with the office's note, shown on the form. Pure. */
export const reopenLink = (link, note, now = Date.now()) => ({ ...link, status: 'open', untilMs: now + LINK_DAYS.one * 864e5, note: String(note || '').trim().slice(0, 300), noteAt: new Date(now).toISOString() });

/** Why a link cannot take a form now ('' when it can). */
export function linkState(link, now = Date.now()) {
  if (!link) return 'This link is not known. Ask for a new one.';
  if (link.status !== 'open') return 'This link was closed by the office. Ask for a new one.';
  if (!(link.untilMs > now)) return 'This link has run out. Ask for a new one.';
  return '';
}

// ---- reading a Fayda ID (the Ethiopian national ID card): its English print, front and back

const titleCase = s => s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (m, a, b) => a + b.toUpperCase());
const digits = s => String(s || '').replace(/\D/g, '');
/** The latest-year date near a label: a Fayda card prints each date twice, Ethiopian and Gregorian, and the Gregorian year is the larger. */
function dateNear(t, dates, re) {
  const m = re.exec(t);
  if (!m) return '';
  const near = dates.filter(d => d.at >= m.index && d.at - m.index < 90).slice(0, 2);   // the pair printed under the label
  return near.sort((a, b) => b.iso.localeCompare(a.iso))[0]?.iso || '';
}
/** The first line after a label that is a name in Latin letters (2 to 5 words). */
function nameAfter(lines, re) {
  const i = lines.findIndex(l => re.test(l.toUpperCase()));
  for (const l of lines.slice(i < 0 ? 0 : i + 1, i < 0 ? lines.length : i + 4)) {
    const w = l.replace(/[^A-Za-z\s'.-]/g, ' ').trim().split(/\s+/).filter(x => x.length > 1);
    if (w.length >= 2 && w.length <= 5 && !/NAME|DATE|BIRTH|SEX|FEDERAL|ETHIOPIA|REPUBLIC|NATIONAL|CARD|DIGITAL/i.test(w.join(' '))) return titleCase(w.join(' '));
  }
  return '';
}

/** What can be read from the text of a Fayda card (one side or both). Always for the person to check. */
export function readFayda(text) {
  const raw = String(text || ''), t = raw.toUpperCase(), lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const dates = datesIn(raw);
  const fan = /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/.exec(raw);
  const rest = fan ? raw.replace(fan[1], ' ') : raw;
  const fin = /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/.exec(rest);
  const phone = /(?:\+?251|\b0)[\s-]?([79]\d{2})[\s-]?(\d{3})[\s-]?(\d{3})\b/.exec(raw);
  const addrAt = lines.findIndex(l => /ADDRESS/i.test(l));
  const address = addrAt < 0 ? '' : lines.slice(addrAt + 1, addrAt + 4).map(l => l.replace(/[^A-Za-z0-9\s,/.-]/g, ' ').replace(/\s+/g, ' ').trim()).filter(l => /[A-Za-z]{3}/.test(l)).join(', ');
  return {
    doc: 'fayda',
    name: nameAfter(lines, /FULL\s*NAME|\bNAME\b/),
    birth: dateNear(t, dates, /BIRTH/),
    expiry: dateNear(t, dates, /EXPIR/),
    gender: /\bFEMALE\b/.test(t) ? 'female' : /\bMALE\b/.test(t) ? 'male' : '',
    idNumber: fan ? digits(fan[1]) : '',
    fin: fin ? digits(fin[1]) : '',
    phone: phone ? `0${phone[1]}${phone[2]}${phone[3]}` : '',
    nationality: /ETHIOPIAN/.test(t) ? 'Ethiopian' : '',
    address,
  };
}

/** What can be read from a passport's photo page (its two machine-readable lines). Null when they could not be read. */
export function readPassport(text, today) {
  const m = parseMrz(text, today);
  if (!m || m.kind !== 'Passport') return null;
  return { doc: 'passport', name: m.name, birth: m.birth, expiry: m.expiry, gender: m.sex === 'F' ? 'female' : m.sex === 'M' ? 'male' : '', passportNumber: m.number, nationality: m.nationality, proven: !!m.proven };
}

/** What was read, as form fields: only fields still empty are filled. Returns { patch, filled } (labels of what was filled). */
export function fillForm(form, facts) {
  const patch = {}, filled = [];
  const put = (key, label, value) => { if (value && !String(form[key] || '').trim()) { patch[key] = value; filled.push(label); } };
  if (!facts) return { patch, filled };
  put('name', 'name', facts.name);
  put('gender', 'gender', facts.gender);
  put('birthday', 'date of birth', facts.birth);
  put('nationality', 'nationality', facts.nationality);
  put('phone', 'phone', facts.phone);
  put('address', 'address', facts.address);
  if (facts.doc === 'fayda') { put('idNumber', 'Fayda number (FAN)', facts.idNumber); put('fin', 'FIN', facts.fin); put('idExpiry', 'card expiry', facts.expiry); }
  if (facts.doc === 'passport') { put('passportNumber', 'passport number', facts.passportNumber); put('passportExpiry', 'passport expiry', facts.expiry); }
  return { patch, filled };
}

/**
 * What is still missing before a form can be sent ('' when it can).
 * v1.3.1 (owner, 7 Nov): every step is needed to finish the registration, except the passport (optional): both sides
 * of the Fayda ID, the photo, and every detail (the certificate may be "None").
 */
export const REQUIRED = [
  ['idFront', 'Take a picture of the front of your Fayda ID.'], ['idBack', 'Take a picture of the back of your Fayda ID.'],
  ['photo', 'Take your photo.'], ['name', 'Write your full name.'], ['trade', 'Choose your trade.'], ['phone', 'Write your phone number.'],
  ['gender', 'Choose your gender.'], ['birthday', 'Write your date of birth.'], ['nationality', 'Choose your nationality.'],
  ['idNumber', 'Write your Fayda number (FAN).'], ['fin', 'Write your FIN.'], ['address', 'Write your address.'],
  ['certificate', 'Write your highest certificate (or None).'], ['emergency', 'Write the emergency contact name.'], ['emergencyPhone', 'Write the emergency contact phone.'],
];
const nDigits = v => String(v || '').replace(/\D/g, '').length;
export function formMissing(f) {
  for (const [k, msg] of REQUIRED) if (!String(f[k] || '').trim()) return msg;
  if (nDigits(f.idNumber) !== 16) return 'The Fayda number (FAN) has 16 digits.';
  if (nDigits(f.fin) !== 12) return 'The FIN has 12 digits.';
  if (nDigits(f.phone) < 9) return 'Check the phone number.';
  if (nDigits(f.emergencyPhone) < 9) return 'Check the emergency contact phone.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.birthday)) || f.birthday > new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10)) return 'Check the date of birth.';
  return '';
}

/** The form as it is sent: only the known fields, trimmed. */
export function formRecord(f, { id, link, at = new Date().toISOString() }) {
  const out = { id, link, at, status: 'new' };
  for (const k of FORM_FIELDS) if (!(k in out) && f[k] != null && f[k] !== '') out[k] = typeof f[k] === 'string' ? f[k].trim().slice(0, IMAGES.includes(k) ? MAX_IMAGE_CHARS : 300) : f[k];
  return out;
}

// ---- in the hub: a form accepted as an employee

/**
 * The HR record a form becomes (Employee data). The Fayda ID or passport goes in Papers too. `existing` is the
 * employee the form updates (same Fayda number, passport number or name); only its empty fields are filled.
 */
export function staffFromForm(form, { link = null, today, newId, stampOf = () => ({}), existing = null }) {
  const docs = [...(existing?.documents || [])];
  const paper = (kind, number, expiry) => {
    if (!number || docs.some(d => d.kind === kind && d.number === number)) return;
    docs.push({ id: newId('dc'), kind, number, expiry: expiry || '', link: '' });
  };
  if (form.idNumber) paper('National ID', form.idNumber, form.idExpiry);
  if (form.passportNumber) paper('Passport', form.passportNumber, form.passportExpiry);
  const fresh = {
    name: form.name, title: form.trade || '', gender: form.gender || '', birthday: form.birthday || '', nationality: form.nationality || '',
    privatePhone: form.phone || '', privateAddress: form.address || '', emergency: form.emergency || '', emergencyPhone: form.emergencyPhone || '',
    idNumber: form.idNumber || '', fin: form.fin || '', passportNumber: form.passportNumber || '', certificate: form.certificate || '',
    photo: form.photo || '', idImage: form.idFront || '', idImageBack: form.idBack || '', passportImage: form.passportImage || '',
  };
  if (existing) {
    const p = { ...existing, documents: docs };
    for (const [k, v] of Object.entries(fresh)) if (v && !String(p[k] || '').trim()) p[k] = v;
    p.fromForm = { at: form.at, link: form.link };
    return p;
  }
  return {
    id: newId('st'), department: '', projectId: link?.projectId || '', status: 'active', started: today, agreement: {}, notes: `From the crew form of ${String(form.at || today).slice(0, 10)}.`,
    level: 'crew', accountEmail: '', assignments: [], ...fresh, documents: docs, fromForm: { at: form.at, link: form.link }, ...stampOf(),
  };
}

/** The employee a form is about, if already in HR: the same Fayda number, passport number, or the same name. */
export function sameStaff(staff, form) {
  const n = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return staff.find(p => (form.idNumber && p.idNumber === form.idNumber) || (form.passportNumber && p.passportNumber === form.passportNumber))
    || staff.find(p => n(p.name) && n(p.name) === n(form.name)) || null;
}

/**
 * The crew pool: the crew-level employees grouped by nationality, each with their trade and the projects they are on
 * now ("Free" when none). Groups by size, largest first; people by name.
 */
export function crewPool(staff, projects = []) {
  const name = id => projects.find(p => p.id === id)?.name || '';
  const groups = new Map();
  for (const p of staff) {
    if (p.status === 'left' || p.leftOn || (p.level && p.level !== 'crew')) continue;
    const nat = String(p.nationality || '').trim() || 'Not stated';
    const on = (p.assignments || []).filter(a => a.active !== false).map(a => name(a.projectId)).filter(Boolean);
    if (!groups.has(nat)) groups.set(nat, []);
    groups.get(nat).push({ id: p.id, name: p.name || 'Unnamed', trade: p.title || '', on, free: !on.length, photo: p.photo || '' });
  }
  return [...groups].map(([nationality, people]) => ({ nationality, people: people.sort((a, b) => a.name.localeCompare(b.name)), free: people.filter(x => x.free).length }))
    .sort((a, b) => b.people.length - a.people.length || a.nationality.localeCompare(b.nationality));
}

/** Nationalities for the form's list: Ethiopian first, then the others the hub knows. */
export const NATIONALITIES = ['Ethiopian', ...[...new Set(Object.values(NATIONALITY))].filter(x => x !== 'Ethiopian' && x !== 'Utopian').sort()];
