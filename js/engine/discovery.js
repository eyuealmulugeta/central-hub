// v1.52.0 (owner, 11 Nov, D1 + D2): Discovery. News for the Installation and Trading divisions, read by the server every
// 6 hours (functions/discovery.js) from free feeds: K-HOME (Henan K-Home Steel Structure Co., the factory Amistad works
// with) blog feed and project news page, prefab industry feeds, and Google News searches. Each item keeps only a
// headline, a short summary, the source and the link: the article itself stays on its own site. Items are kept 30 days.
// The parsers follow Bete's Feed (Bete functions/shared/discover.js), which has run since 9 Nov.

export const KEEP_DAYS = 30;
const g = q => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:30d`)}&hl=en-US&gl=US&ceid=US:en`;

/** The tabs of each division's Discovery page. */
export const TABS = {
  installation: [['partner', 'K-HOME partner'], ['install', 'Installation methods'], ['tech', 'New technology']],
  trading: [['market', 'Container housing market'], ['leads', 'Potential markets']],
};
/** Regions the owner chose for the Trading markets (11 Nov): Africa, Middle East, Europe. */
export const REGIONS = [['africa', 'Africa'], ['mideast', 'Middle East'], ['europe', 'Europe']];

// kind: rss (a feed) or khnews (K-HOME's project news page, which has no feed)
export const SOURCES = [
  // Installation: K-HOME partner
  { id: 'khome-blog', div: 'installation', tab: 'partner', name: 'K-HOME blog', url: 'https://khomechina.com/feed/', max: 10, keep: 365 },
  { id: 'khome-news', div: 'installation', tab: 'partner', name: 'K-HOME projects', url: 'https://www.khomehouse.com/newslist-1', kind: 'khnews', max: 12, keep: 365 },
  { id: 'g-khome', div: 'installation', tab: 'partner', name: 'K-HOME in the news', url: g('"K-Home" container house'), max: 6 },
  // Installation: methods
  { id: 'g-cont-install', div: 'installation', tab: 'install', name: 'Container house installation', url: g('container house installation'), max: 8 },
  { id: 'g-mod-assembly', div: 'installation', tab: 'install', name: 'Modular assembly on site', url: g('modular building assembly on site'), max: 8 },
  { id: 'g-prefab-found', div: 'installation', tab: 'install', name: 'Prefab foundations', url: g('prefabricated house foundation'), max: 6 },
  { id: 'g-steel-erect', div: 'installation', tab: 'install', name: 'Steel structure erection', url: g('steel structure erection safety'), max: 6 },
  // Installation: new technology
  { id: 'mbi', div: 'installation', tab: 'tech', name: 'Modular Building Institute', url: 'https://www.modular.org/feed/', max: 8 },
  { id: 'offsitehub', div: 'installation', tab: 'tech', name: 'Offsite Hub', url: 'https://www.offsitehub.co.uk/feed/', max: 8 },
  { id: 'g-mod-tech', div: 'installation', tab: 'tech', name: 'Modular construction technology', url: g('modular construction technology'), max: 8 },
  { id: 'g-prefab-innov', div: 'installation', tab: 'tech', name: 'Prefab innovation', url: g('prefabricated building innovation'), max: 8 },
  { id: 'g-panels', div: 'installation', tab: 'tech', name: 'Sandwich panels and insulation', url: g('sandwich panel new technology'), max: 6 },
  // Trading: container housing market
  { id: 'g-cont-market', div: 'trading', tab: 'market', name: 'Container house market', url: g('container house market'), max: 8 },
  { id: 'g-flatpack', div: 'trading', tab: 'market', name: 'Flat pack container prices', url: g('flat pack container price demand'), max: 6 },
  { id: 'g-mkt-africa', div: 'trading', tab: 'market', region: 'africa', name: 'Modular housing, Africa', url: g('modular housing market Africa'), max: 8 },
  { id: 'g-mkt-mideast', div: 'trading', tab: 'market', region: 'mideast', name: 'Prefab housing, Middle East', url: g('prefab modular housing market Middle East'), max: 8 },
  { id: 'g-mkt-europe', div: 'trading', tab: 'market', region: 'europe', name: 'Container homes, Europe', url: g('container modular homes market Europe'), max: 8 },
  // Trading: potential markets (who may need camps, offices, classrooms, clinics), by region
  { id: 'g-af-mining', div: 'trading', tab: 'leads', region: 'africa', name: 'Mining camps, Africa', url: g('mining camp accommodation Africa'), max: 8 },
  { id: 'g-af-refugee', div: 'trading', tab: 'leads', region: 'africa', name: 'Refugee and emergency housing, Africa', url: g('refugee shelter prefabricated Africa'), max: 6 },
  { id: 'g-af-camps', div: 'trading', tab: 'leads', region: 'africa', name: 'Construction camps, East Africa', url: g('construction camp Ethiopia OR Kenya OR Tanzania OR Uganda'), max: 8 },
  { id: 'g-af-schools', div: 'trading', tab: 'leads', region: 'africa', name: 'Classrooms and clinics, Africa', url: g('prefabricated classrooms OR clinics Africa'), max: 6 },
  { id: 'g-me-labour', div: 'trading', tab: 'leads', region: 'mideast', name: 'Labour accommodation, Gulf', url: g('labour accommodation modular Saudi OR UAE OR Qatar'), max: 8 },
  { id: 'g-me-projects', div: 'trading', tab: 'leads', region: 'mideast', name: 'Giga projects site camps', url: g('site camp modular giga project Saudi'), max: 6 },
  { id: 'g-eu-housing', div: 'trading', tab: 'leads', region: 'europe', name: 'Modular housing, Europe', url: g('modular housing refugees OR students Europe'), max: 8 },
  { id: 'g-eu-site', div: 'trading', tab: 'leads', region: 'europe', name: 'Site offices, Europe', url: g('container site office construction Europe'), max: 6 },
];

// ---- parsing (pure) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
export const decode = s => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] ?? m;
});
const cdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const tag = (x, name) => { const m = x.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? cdata(m[1]).trim() : ''; };
const attr = (x, name, a) => x.match(new RegExp(`<${name}\\b[^>]*?\\b${a}=["']([^"']+)["']`, 'i'))?.[1] || '';
const text = html => decode(decode(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export const httpsUrl = u => { const s = decode(String(u ?? '').trim()).replace(/^http:\/\//i, 'https://'); return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 600 ? s : ''; };
export function short(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.–—-]+$/, '')}…`;
}
/** A stable short id for a link (two 32-bit FNV-1a hashes). */
export function itemId(link) {
  const h = seed => { let x = seed; for (let i = 0; i < link.length; i += 1) x = Math.imul(x ^ link.charCodeAt(i), 16777619) >>> 0; return x.toString(16).padStart(8, '0'); };
  return h(2166136261) + h(33554467);
}
const base = s => ({ div: s.div, tab: s.tab, region: s.region || '', source: s.name, sourceId: s.id, ...(s.keep ? { keep: s.keep } : {}) });

/** A feed's newest items. Google News titles end with " - Publisher": that goes into source. */
export function parseFeed(xml, s) {
  const blocks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const x of blocks) {
    let title = short(text(tag(x, 'title')), 200);
    const link = httpsUrl(tag(x, 'link') || attr(x, 'link', 'href'));
    if (!title || !link) continue;
    let source = s.name;
    const pub = text(tag(x, 'source'));
    if (pub && title.endsWith(` - ${pub}`)) { title = title.slice(0, -(pub.length + 3)); source = pub; }
    const body = decode(tag(x, 'description') || tag(x, 'summary') || tag(x, 'content'));
    let summary = short(text(body).replace(/The post .* appeared first on .*\.?$/i, '').replace(/\s*\[(…|&hellip;|\.\.\.)\]\s*$/, '…'), 240);
    if (summary.startsWith(title.slice(0, 40))) summary = '';   // Google News repeats the headline
    const when = Date.parse(tag(x, 'pubDate') || tag(x, 'published') || tag(x, 'updated') || tag(x, 'dc:date'));
    out.push({ id: itemId(link), ...base(s), source, title, link, summary, at: Number.isNaN(when) ? '' : new Date(when).toISOString() });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, s.max || 10);
}

/** K-HOME's project news page (no feed, no dates): the links to /news/ pages, newest first as the page lists them. */
export function parseNewsList(html, s) {
  const seen = new Set(), out = [];
  for (const m of String(html || '').matchAll(/<a[^>]+href=["'](https?:\/\/www\.khomehouse\.com\/news\/[^"']+\.html)["'][^>]*>([^<]{6,200})</gi)) {
    const link = httpsUrl(m[1]), title = short(text(m[2]), 200);
    if (!link || !title || seen.has(link)) continue;
    seen.add(link);
    out.push({ id: itemId(link), ...base(s), title, link, summary: '', at: '' });
  }
  return out.slice(0, s.max || 10);
}

export const parseSource = (body, s) => (s.kind === 'khnews' ? parseNewsList(body, s) : parseFeed(body, s));

/** When an item counts from: its own date, or when the server first saw it. */
export const dayOf = x => x.at || x.seen || '';
/** Items older than KEEP_DAYS are deleted (K-HOME's own posts: a year). */
export const expired = (x, nowMs) => Date.parse(dayOf(x) || 0) < nowMs - (x.keep || KEEP_DAYS) * 864e5;

/** What the server writes: new items (seen now), dates kept for ones it already has, and the old ones to delete. */
export function plan(found, existing, nowIso) {
  const have = new Map(existing.map(x => [x.id, x])), nowMs = Date.parse(nowIso);
  const write = [];
  for (const x of found) {
    const old = have.get(x.id);
    const rec = { ...x, seen: old?.seen || nowIso };
    if (expired(rec, nowMs)) continue;
    if (!old || old.title !== rec.title || old.summary !== rec.summary || old.at !== rec.at || old.tab !== rec.tab) write.push(rec);
  }
  const ids = new Set(found.map(x => x.id));
  const remove = existing.filter(x => expired(x, nowMs) && !ids.has(x.id)).map(x => x.id);
  return { write, remove };
}

// ---- the page (pure) ----
/** Items of one division and tab, newest first, with search and region. */
export function itemsFor(items, { div, tab, region = '', q = '', saved = null } = {}) {
  const w = String(q || '').trim().toLowerCase();
  return (items || []).filter(x => x.div === div && (!tab || x.tab === tab) && (!region || x.region === region)
    && (!saved || saved.includes(x.id)) && (!w || `${x.title} ${x.summary} ${x.source}`.toLowerCase().includes(w)))
    .sort((a, b) => String(dayOf(b)).localeCompare(String(dayOf(a))));
}
/** How many came in the last 7 days. */
export const newThisWeek = (items, nowMs) => (items || []).filter(x => Date.parse(x.seen || dayOf(x) || 0) >= nowMs - 7 * 864e5).length;

/** A Trading lead from an item: the Deal enquiry's notes (its wanted field is a date, left for the person). */
export function leadOf(x) {
  return { notes: `From Discovery (${x.source}${x.region ? `, ${REGIONS.find(([k]) => k === x.region)?.[1] || x.region}` : ''}): ${x.title}\n${x.link}` };
}

/** What we know of K-HOME (from khomechina.com, read 11 Nov 2026): shown on the partner tab. */
export const KHOME = {
  name: 'K-HOME (Henan K-Home Steel Structure Co., Ltd)',
  about: 'Chinese factory: design, manufacture and installation of modular containers and prefabricated buildings. 15+ years, 70+ export countries, 3+ production bases, Xinxiang, Henan. ISO 9001 and CE; rock wool panels Class A non-combustible; SGS or BV inspection accepted.',
  products: ['Flat pack, detachable, folding and expandable container houses', 'Container houses on wheels (caravans)', 'K-type and T-type prefabricated houses', 'Gable roof portable cabins, Apple cabins, space capsule houses', 'Portable restrooms and ablution units', 'Portal steel structure buildings: workshops, warehouses, crane buildings'],
  solutions: ['Barracks', 'Offices', 'Classrooms and schools', 'Camps: construction, mining, military, refugee', 'Hostels and motels', 'Shops, canteens, coffee shops', 'Clinics and container hospitals'],
  africa: ['Ethiopia: 112-unit container accommodation, installed 2021 led by K-HOME\'s Kenya engineers; a container hotel', 'Kenya: container school', 'Tanzania: canteen and training rooms', 'Congo: camp and offshore living quarters', 'Ghana: construction camp', 'Botswana: prefab classrooms', 'Mali: accommodation camp', 'Nigeria, Cameroon, Mozambique'],
  links: [['Products and solutions', 'https://khomechina.com/solutions'], ['Projects', 'https://khomechina.com/projects'], ['Blog', 'https://khomechina.com/blog'], ['Project news', 'https://www.khomehouse.com/newslist-1'], ['Ethiopia installation (2021)', 'https://www.khomehouse.com/news/khome-installation-team-go-to-ethiopia-for-con-42556915.html']],
};
