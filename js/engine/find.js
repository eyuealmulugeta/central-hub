// Finding text anywhere in Central Hub, however it is typed. Pure functions; the search box (ui/palette.js) and the
// highlighter (ui/finder.js) use them.
//
// A query matches a text when every word of it is found in the text (capitals, accents and punctuation do not matter),
// or when the query, written without spaces and punctuation, is found in the text written the same way (so "INV MOD 001",
// "inv-mod-001" and "INVMOD001" are one thing, and so are "+251 911 75 75 83" and "251911757583"), or when the query is a
// date in any usual form and the text holds that date in any other (2026-09-20, 20/09/2026, 20 Sep 2026, Sep 20 2026).
// Numbers match with or without thousands separators ("7,549,635.00" and "7549635").

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Lower case, no accents, no thousands separators inside numbers. Keeps spaces and punctuation. */
export function fold(text) {
  let t = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/(\d)[   ](?=\d{3}(?!\d))/g, '$1');
  return t;
}

/** Letters and digits only. */
export const compact = text => fold(text).replace(/[^a-z0-9]+/g, '');

const words = text => fold(text).split(/[^a-z0-9@+]+/).map(w => w.replace(/^[@+]+|[@+]+$/g, '')).filter(Boolean);

/** Every way the query could be a date, folded: [] when it is not one. */
export function dateForms(query) {
  const q = fold(query).trim();
  let y, m, d;
  let hit;
  if ((hit = q.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/))) [y, m, d] = [+hit[1], +hit[2], +hit[3]];
  else if ((hit = q.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/))) [d, m, y] = [+hit[1], +hit[2], +hit[3]];
  else if ((hit = q.match(/^(\d{1,2})[-/. ]?([a-z]{3,9})[-/. ,]*(\d{4})$/))) {
    const i = MONTHS.indexOf(hit[2].slice(0, 3));
    if (i >= 0) [d, m, y] = [+hit[1], i + 1, +hit[3]];
  } else if ((hit = q.match(/^([a-z]{3,9})[-/. ]?(\d{1,2})[-/. ,]*(\d{4})$/))) {
    const i = MONTHS.indexOf(hit[1].slice(0, 3));
    if (i >= 0) [m, d, y] = [i + 1, +hit[2], +hit[3]];
  }
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return [];
  const p = n => String(n).padStart(2, '0');
  return [...new Set([
    `${y}-${p(m)}-${p(d)}`, `${p(d)}/${p(m)}/${y}`, `${d}/${m}/${y}`,
    `${d} ${MONTHS[m - 1]} ${y}`, `${p(d)} ${MONTHS[m - 1]} ${y}`, `${d} ${LONG[m - 1]} ${y}`, `${MONTHS[m - 1]} ${d} ${y}`, `${MONTHS[m - 1]} ${d}, ${y}`,
  ])];
}

/** The spellings of a query to look for in folded text. */
function needles(query) {
  const dates = dateForms(query);
  if (dates.length) return { dates };
  const c = compact(query);
  return { words: words(query), compact: c.length >= 3 ? c : '' };
}

/** Does `text` hold the query, in any of the ways above? */
export function matches(text, query) {
  const q = needles(query);
  if (q.dates) { const t = fold(text); return q.dates.some(d => t.includes(d)); }
  if (!q.words.length) return false;
  const t = fold(text);
  if (q.words.every(w => t.includes(w))) return true;
  return !!q.compact && compact(text).includes(q.compact);
}

/** Folded text with, for each folded character, where it came from in the original. */
function foldWithMap(text) {
  const source = String(text ?? '');
  let out = '';
  const at = [];
  for (let i = 0; i < source.length; i++) {
    const piece = fold(source[i]);
    for (const ch of piece) { out += ch; at.push(i); }
  }
  return { out, at };
}

/** The [start, end) ranges of the original text that show a match: used to highlight and to cut a snippet. */
export function ranges(text, query) {
  const source = String(text ?? '');
  const q = needles(query);
  const found = [];
  const add = (from, to, map) => { found.push([map[from], map[to - 1] + 1]); };
  if (q.dates) {
    const { out, at } = foldWithMap(source);
    for (const d of q.dates) for (let i = out.indexOf(d); i >= 0; i = out.indexOf(d, i + d.length)) add(i, i + d.length, at);
  } else {
    const { out, at } = foldWithMap(source);
    // the query as one run (ignoring spaces and punctuation) is what a person meant when it is there; otherwise each word is marked
    let squeezed = '';
    const back = [];
    for (let i = 0; i < out.length; i++) if (/[a-z0-9]/.test(out[i])) { squeezed += out[i]; back.push(i); }
    if (q.compact && q.words.length > 1 || q.compact && !q.words.every(w => out.includes(w))) {
      for (let i = squeezed.indexOf(q.compact); i >= 0; i = squeezed.indexOf(q.compact, i + q.compact.length)) add(back[i], back[i + q.compact.length - 1] + 1, at);
    }
    if (!found.length && q.words.every(w => out.includes(w))) {
      for (const w of q.words) for (let i = out.indexOf(w); i >= 0; i = out.indexOf(w, i + w.length)) add(i, i + w.length, at);
    }
  }
  // merge overlaps, in order
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of found) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  return merged;
}

/** A short piece of `text` around the first match, for the search results. */
export function snippet(text, query, width = 90) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  const [first] = ranges(source, query);
  if (!first) return source.slice(0, width) + (source.length > width ? '…' : '');
  const from = Math.max(0, first[0] - Math.floor(width / 3));
  const to = Math.min(source.length, from + width);
  return `${from > 0 ? '…' : ''}${source.slice(from, to)}${to < source.length ? '…' : ''}`;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/**
 * The words a screen shows, from the HTML that draws it: the text of every tag, plus what sits in the fields (typed
 * values, the chosen option, placeholders, titles and labels), which are text too.
 */
export function htmlToText(html) {
  const source = String(html ?? '');
  const parts = [];
  for (const m of source.matchAll(/\b(?:value|placeholder|title|aria-label)="([^"]*)"/g)) if (m[1] && !/^(on|off|true|false)$/i.test(m[1])) parts.push(m[1]);
  const body = source.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
  parts.push(body);
  return parts.join(' ').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, e => ENTITIES[e]).replace(/\s+/g, ' ').trim();
}

/** Every piece of readable text in a record (a plain object): strings and numbers, not pictures, not ids. */
export function flatText(value, limit = 800) {
  const out = [];
  let size = 0;
  const walk = (v, key) => {
    if (size > limit || v == null || v === false) return;
    if (typeof v === 'string') {
      if (v.startsWith('data:') || v.length > 400 && !/\s/.test(v.slice(0, 100)) || /^(id|.*Id|.*Ids)$/.test(key || '')) return;
      out.push(v); size += v.length;
    } else if (typeof v === 'number') { out.push(String(v)); size += 6; }
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(value, '');
  return out.join(' ').slice(0, limit * 2);
}
