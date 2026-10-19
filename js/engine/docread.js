// Reading a document from the text a picture of it was turned into (OCR). A passport or an ID card carries a
// machine-readable zone (the two or three lines of capitals and "<" at the bottom): it has check digits, so what is
// read from it can be proved right. Other papers are read by their labels and dates, and need a human look.
// Pure functions: the picture-to-text step is in ui/ocr.js.

const WEIGHTS = [7, 3, 1];
const VALUE = ch => (ch === '<' ? 0 : /\d/.test(ch) ? +ch : ch.charCodeAt(0) - 55);   // A = 10 ... Z = 35

/** The ICAO check digit of a field. */
export function checkDigit(field) {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += VALUE(field[i]) * WEIGHTS[i % 3];
  return sum % 10;
}

// What an OCR engine mistakes for a digit in a field that can only hold digits, and for a letter in one that can only hold letters.
const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B' };
const digits = s => [...s].map(ch => TO_DIGIT[ch] || ch).join('');
const letters = s => [...s].map(ch => TO_LETTER[ch] || ch).join('');

/** YYMMDD to an ISO date. `future` is true for an expiry date: the century is the nearest one that makes sense. */
export function mrzDate(yymmdd, future, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = +yymmdd.slice(0, 2), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6);
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return '';
  const thisYear = +today.slice(0, 4);
  let year = 2000 + yy;
  if (!future && year > thisYear) year -= 100;       // a birth date is never in the future
  return `${year}-${mm}-${dd}`;
}

/** "ERIKSSON<<ANNA<MARIA" to { surname, given }. */
function names(zone) {
  const [surname, ...rest] = zone.replace(/<+$/, '').split('<<');
  const clean = s => s.split('<').filter(Boolean).join(' ');
  return { surname: clean(surname || ''), given: clean(rest.join(' ')) };
}

const titleCase = s => s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** Country codes to the nationality as people write it (the common ones here; any other stays as its code). */
export const NATIONALITY = {
  ETH: 'Ethiopian', ERI: 'Eritrean', KEN: 'Kenyan', UGA: 'Ugandan', TZA: 'Tanzanian', SDN: 'Sudanese', SSD: 'South Sudanese', SOM: 'Somali', DJI: 'Djiboutian',
  EGY: 'Egyptian', ZAF: 'South African', NGA: 'Nigerian', GHA: 'Ghanaian', COD: 'Congolese', ZMB: 'Zambian', ZWE: 'Zimbabwean', RWA: 'Rwandan', SYC: 'Seychellois',
  ISR: 'Israeli', ARE: 'Emirati', SAU: 'Saudi', TUR: 'Turkish', IND: 'Indian', PAK: 'Pakistani', CHN: 'Chinese', PHL: 'Filipino', BGD: 'Bangladeshi', LKA: 'Sri Lankan',
  USA: 'American', GBR: 'British', CAN: 'Canadian', DEU: 'German', FRA: 'French', ITA: 'Italian', ESP: 'Spanish', NLD: 'Dutch', RUS: 'Russian', UTO: 'Utopian',
};
export const nationalityOf = code => NATIONALITY[code] || code;

// What an OCR engine confuses in the number field of a passport: tried one or two at a time until the check digit fits.
// (1 and L are left out: they weigh the same in a check digit, so it cannot tell them apart.)
const SWAPS = { 1: ['I'], I: ['1'], 0: ['O', 'D', 'Q'], O: ['0'], D: ['0'], Q: ['0'], 5: ['S'], S: ['5'], 8: ['B'], B: ['8'], 2: ['Z'], Z: ['2'], 6: ['G'], G: ['6'] };
function repairNumber(field, check) {
  const ok = f => checkDigit(f) === check;
  if (ok(field)) return field;
  for (let i = 0; i < field.length; i++) for (const x of SWAPS[field[i]] || []) {
    const one = field.slice(0, i) + x + field.slice(i + 1);
    if (ok(one)) return one;
    for (let j = i + 1; j < field.length; j++) for (const y of SWAPS[one[j]] || []) {
      const two = one.slice(0, j) + y + one.slice(j + 1);
      if (ok(two)) return two;
    }
  }
  return field;
}

// The second line of a passport zone, found by its shape so that an extra or missing character in the country does not shift the rest.
const D = '[0-9OQDIZSBGL]';
const TD3_B = new RegExp(`^([A-Z0-9<]{9})(${D}|<)([A-Z0<]{3,4}?)(${D}{6})(${D})([MF<])(${D}{6})(${D})`);

/** The names line: the "<" an OCR engine reads as "<K" or "L" is put back. */
function cleanNames(line) {
  return line.replace(/<K/g, '<').replace(/[LKEC]{2,}$/, m => '<'.repeat(m.length));
}

function readTd3(a, b, today) {
  const m = TD3_B.exec(b);
  if (!m) return null;
  const [, rawNumber, nCheck, country, birth, bCheck, sex, expiry, eCheck] = m;
  const number = repairNumber(rawNumber, +digits(nCheck));
  const n = names(cleanNames(a).slice(5));
  return fromParts({ type: 'passport', number, nCheck, issuer: a.slice(2, 5), nationality: country.slice(0, 3), birth, bCheck, sex, expiry, eCheck, ...n, today });
}

function readTd1(a, b, c, today) {
  const number = a.slice(5, 14), nCheck = a[14], birth = b.slice(0, 6), bCheck = b[6], sex = b[7], expiry = b.slice(8, 14), eCheck = b[14], nationality = b.slice(15, 18);
  return fromParts({ type: 'id', number, nCheck, issuer: a.slice(2, 5), nationality, birth, bCheck, sex, expiry, eCheck, ...names(c), today });
}

function fromParts(x) {
  const number = x.number.replace(/<+$/, '');
  const birth = digits(x.birth), expiry = digits(x.expiry);
  const ok = {
    number: checkDigit(x.number) === +digits(x.nCheck),
    birth: checkDigit(birth) === +digits(x.bCheck),
    expiry: checkDigit(expiry) === +digits(x.eCheck),
  };
  return {
    kind: x.type === 'passport' ? 'Passport' : 'National ID',
    surname: titleCase(letters(x.surname)), given: titleCase(letters(x.given)),
    name: titleCase([letters(x.given), letters(x.surname)].filter(Boolean).join(' ')),
    number, issuer: letters(x.issuer), nationalityCode: letters(x.nationality), nationality: nationalityOf(letters(x.nationality)),
    sex: x.sex === 'F' || x.sex === 'M' ? x.sex : '',
    birth: mrzDate(birth, false, x.today), expiry: mrzDate(expiry, true, x.today),
    checks: ok, proven: ok.number && ok.birth && ok.expiry, source: 'mrz',
  };
}

/** The machine-readable lines in some OCR text: the lines made only of capitals, digits and "<", of the right length. */
export function mrzLines(text) {
  return String(text || '').toUpperCase().split(/\r?\n/)
    .map(l => l.replace(/[\s«]/g, '').replace(/[^A-Z0-9<]/g, ''))
    .filter(l => l.length >= 28 && (l.match(/</g) || []).length >= 2);
}

/** Read the zone of a passport (2 lines of 44) or an ID card (3 lines of 30), tolerating a character or two too many or too few. */
export function parseMrz(text, today) {
  const lines = mrzLines(text);
  const fit = (l, n) => (Math.abs(l.length - n) <= 2 ? l.slice(0, n).padEnd(n, '<') : null);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i][0] !== 'P' || lines[i].length < 36 || lines[i + 1].length < 36) continue;
    const r = readTd3(lines[i].slice(0, 46), lines[i + 1], today);
    if (r) return r;
  }
  for (let i = 0; i + 2 < lines.length; i++) {
    const a = fit(lines[i], 30), b = fit(lines[i + 1], 30), c = fit(lines[i + 2], 30);
    if (a && b && c && /^[IAC]/.test(a[0])) return readTd1(a, b, c, today);
  }
  return null;
}

// ---- papers without a machine-readable zone: by labels and dates

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = n => String(n).padStart(2, '0');

/** Every date in a text, as ISO, in the order written. Day first (14/03/2028, 14 MAR 2028) or year first (2028-03-14). */
export function datesIn(text) {
  const out = [];
  const t = String(text || '').toUpperCase();
  for (const m of t.matchAll(/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g)) out.push({ at: m.index, iso: `${m[1]}-${pad(m[2])}-${pad(m[3])}` });
  for (const m of t.matchAll(/\b(\d{1,2})[\/.\-\s]([A-Z]{3})[A-Z]*[\/.\-\s,]*(\d{2,4})\b/g)) {
    const mo = MONTHS[m[2]];
    if (mo) out.push({ at: m.index, iso: `${m[3].length === 2 ? 2000 + +m[3] : m[3]}-${pad(mo)}-${pad(m[1])}` });
  }
  for (const m of t.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g)) {
    if (+m[1] <= 31 && +m[2] <= 12) out.push({ at: m.index, iso: `${m[3]}-${pad(m[2])}-${pad(m[1])}` });
  }
  return out.filter(d => !Number.isNaN(Date.parse(d.iso))).sort((a, b) => a.at - b.at);
}

const KIND_WORDS = [
  ['Driving licence', /DRIVING|DRIVER'?S? LICEN[CS]E/],
  ['Visa or residence permit', /\bVISA\b|RESIDENCE PERMIT|RESIDENT PERMIT/],
  ['Work permit', /WORK PERMIT|EMPLOYMENT PERMIT/],
  ['National ID', /NATIONAL ID|IDENTITY CARD|ID CARD|IDENTIFICATION CARD/],
  ['Passport', /PASSPORT/],
  ['Medical certificate', /MEDICAL/],
  ['Safety certificate', /SAFETY|FIRST AID/],
];

/** What can be read from a paper's text: its kind, its number and when it runs out. Always for a person to check. */
export function readPaper(text, today) {
  const mrz = parseMrz(text, today);
  if (mrz) return mrz;
  const t = String(text || '').toUpperCase();
  const kind = KIND_WORDS.find(([, re]) => re.test(t))?.[0] || '';
  const dates = datesIn(text);
  const near = re => { const m = re.exec(t); return m ? dates.find(d => d.at >= m.index && d.at - m.index < 60)?.iso || '' : ''; };
  const expiry = near(/EXPIR|VALID (UNTIL|TO|THROUGH)|DATE OF EXP|EXP\.? DATE|\bEXP\b/) || '';
  const birth = near(/BIRTH|\bDOB\b|BORN/);
  const num = /(?:PASSPORT|LICEN[CS]E|ID|DOCUMENT|PERMIT|CARD|CERTIFICATE)?\s*(?:NO|NUMBER|NUM|N°|#)[.:\s]*([A-Z0-9][A-Z0-9\-\/]{4,19})/.exec(t);
  return { kind, number: num ? num[1] : '', expiry, birth, name: '', nationality: '', source: 'text', proven: false };
}

// ---- putting what was read into a person's record

/**
 * What to write into a person (an employee or an owner) from what was read. Only empty fields are filled: what is
 * already typed is never overwritten, and a different value is reported instead.
 * Options: birthday (the record has a date of birth), expiryField (the record keeps the passport expiry itself),
 * kindHint (the kind of paper when the text did not say), newId (makes an id for a new paper).
 * @returns {{ patch: Object, filled: string[], differs: string[] }}
 */
export function fillPerson(person, f, o = {}) {
  const patch = {}, filled = [], differs = [];
  const put = (key, label, value) => {
    if (!value) return;
    if (!String(person[key] || '').trim()) { patch[key] = value; filled.push(label); }
    else if (String(person[key]).trim().toLowerCase() !== String(value).toLowerCase()) differs.push(`${label} reads ${value}`);
  };
  if (f.source === 'mrz') {
    put('name', 'Name', f.name);
    put('nationality', 'Nationality', f.nationality);
    if (o.birthday) put('birthday', 'Date of birth', f.birth);
  }
  const kind = f.kind || o.kindHint || 'Other';
  if (kind === 'Passport') {
    put('passportNumber', 'Passport No.', f.number);
    if (o.expiryField) put(o.expiryField, 'Passport expiry', f.expiry);
  }
  if (kind === 'National ID') put('idNumber', 'Identification No.', f.number);
  if (f.number || f.expiry) {
    const docs = (person.documents || []).map(d => ({ ...d }));
    const mine = docs.find(d => d.kind === kind && (!d.number || d.number === f.number));
    if (mine) {
      if (!mine.number && f.number) mine.number = f.number;
      if (!mine.expiry && f.expiry) mine.expiry = f.expiry;
      else if (f.expiry && mine.expiry !== f.expiry) differs.push(`${kind} expiry reads ${f.expiry}`);
    } else {
      docs.push({ id: o.newId ? o.newId() : `dc${docs.length + 1}`, kind, number: f.number || '', expiry: f.expiry || '', link: '' });
    }
    patch.documents = docs;
    filled.push(`${kind} in Papers`);
  }
  return { patch, filled, differs };
}
