// What the search box can find: the pages, every kind of record with all its text (not only its name), and the words
// each page shows. Built fresh each time the box opens, from what this person may open now. Each entry is
// { kind, label, hint, body, run }: `body` is the rest of the text, matched but not shown (the box shows a snippet of it).

import { flatText, htmlToText } from '../engine/find.js';
import { fmtFull } from '../core/util.js';

// These pages mark things as read when they are drawn, or load their figures when opened, so they are not drawn just to read their text:
// their records (messages, bookings) are searched instead.
const NOT_DRAWN = new Set(['discuss', 'meetings', 'finance', 'tradesummary']);
const SETTINGS = ['apps', 'prices', 'access', 'catalog', 'company', 'links'];

const trim = (v, n = 90) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const without = (record, ...keys) => { const copy = { ...record }; for (const k of keys) delete copy[k]; return copy; };

/**
 * @param env { store, company (this division's), ctx, allowed(page), goTo(page, before), focus: {hr, contracts, trade, docs, schedule, letters, owners, payroll}, titles, division }
 */
export function buildIndex(env) {
  const { store, company, ctx, allowed, goTo, focus, titles } = env;
  const items = [];
  const add = (kind, label, hint, body, run) => { if (label || body) items.push({ kind, label: label || kind, hint: hint || '', body: body || '', run }); };
  const installation = env.division === 'installation';

  // ---- the company's records, with all of their text
  if (store.isAdmin) {
    for (const s of company.staff) add('Person', s.name, s.title || s.department || '', flatText(without(s, 'photo', 'passportImage')), () => goTo('hr', () => focus.hr.focusOn(s.id)));
    for (const o of company.owners || []) add('Owner', o.name, o.title || '', flatText(without(o, 'photo', 'passportImage')), () => goTo('owners', () => focus.owners.focusOn(o.id)));
    for (const l of company.letters) add('Letter', `${l.number || ''} ${l.subject || ''}`.trim(), l.to || '', flatText(l, 1500), () => goTo('letters', () => focus.letters.focusOn(l.id)));
    for (const r of company.payroll) add('Payroll', `Payroll ${r.month}`, r.status || '', flatText(r, 1200), () => goTo('payroll', () => focus.payroll.focusOn(r.id)));
  }
  if (store.can('contracts')) {
    for (const k of company.contracts) add('Contract', `${k.ref || ''} ${k.title || ''}`.trim(), k.party || '', flatText(k, 1200), () => goTo('contracts', () => focus.contracts.focusOn(k.id)));
    for (const g of company.signs || []) add('Signature request', g.title || g.ref, g.status || '', flatText(without(g, 'chunks', 'hash')), () => goTo('documentsign'));
  }
  if (store.can('trade')) {
    for (const s of company.shipments) add('Shipment', `${s.ref || ''} ${s.supplier || ''}`.trim(), [s.origin, s.destination].filter(Boolean).join(' to '), flatText(s, 1500), () => goTo('trade', () => focus.trade.focusOn(s.id)));
    for (const x of company.sales || []) add('Sale', `Sale to ${x.customer || ''}`.trim(), x.date ? fmtFull(x.date) : '', flatText(x), () => goTo('stock'));
  }
  if (store.can('contacts')) for (const x of company.contacts || []) add('Contact', x.name, x.email || x.phone || '', flatText(x), () => goTo('contacts'));
  if (store.can('meetings')) for (const b of company.bookings || []) add('Meeting', `${b.name || ''}${b.company ? `, ${b.company}` : ''}`, b.start ? fmtFull(b.start.slice(0, 10)) : '', flatText(b), () => goTo('meetings'));
  // messages of this department's channels
  const trading = env.division === 'trading';
  for (const m of store.company.messages || []) {
    if ((m.channel === 'general-trading') !== trading) continue;   // each department searches its own conversations
    add('Message', trim(m.text, 70), m.name || '', flatText(m), () => goTo('discuss'));
  }

  // ---- the open project's records (Installation)
  if (ctx && installation) {
    const p = ctx.project, ws = ctx.ws;
    if (allowed('prices')) add('Project settings', p.name, 'Settings, This project', flatText(without(p, 'summary', 'off')), () => goTo('prices'));
    if (allowed('schedule')) for (const t of ctx.sched?.rows || ws.tasks) add('Task', t.name, t.start ? fmtFull(t.start) : '', flatText(ws.tasks.find(x => x.id === t.id) || t), () => goTo('schedule', () => focus.schedule.focusOn(t.id)));
    if (allowed('reports')) for (const r of ws.reports) add('Daily report', `Daily report ${r.date ? fmtFull(r.date) : ''}`, r.by || '', flatText(without(r, 'id', 'review'), 1600), () => goTo('reports'));
    if (allowed('ledger')) for (const e of ws.ledger) add(e.type === 'income' ? 'Receipt' : 'Cost', e.description || e.category, `${e.amount} ${e.currency || ''}${e.date ? `, ${fmtFull(e.date)}` : ''}`, flatText(e), () => goTo('ledger'));
    if (allowed('docs')) for (const d of ws.docs) add({ invoice: 'Invoice', quote: 'Quotation', po: 'Purchase order', report: 'Client report' }[d.type] || 'Document', d.number, `${d.party?.name || ''}, ${d.status || ''}`, flatText(without(d, 'data')), () => goTo('docs', () => focus.docs.focusOn(d.id)));
    if (allowed('dashboard')) for (const i of ws.items) add('Follow-up', i.title, `${i.owner || ''} ${i.status}`, flatText(i), () => goTo('dashboard'));
    if (allowed('requests')) for (const r of ws.requests || []) add('Request', r.title || r.category, r.status || '', flatText(r), () => goTo('requests'));
    if (allowed('prices')) for (const m of ws.team) add('Team member', m.name, m.role || '', flatText(m), () => goTo('prices'));
  }

  return items;
}

/**
 * The words each page shows (headings, labels, help text, what is in the fields), added a page at a time so the search box
 * opens at once: `push(items)` is called as each page is read. A page is drawn and put back in one step, so nothing on
 * screen changes. A page with several tabs of its own (Settings) gives the text of all of them (`indexText`).
 */
export async function indexPages(env, push) {
  const { allowed, ctx, titles } = env;
  if (!ctx) return;
  const seen = new Set();
  for (const page of [...env.hubs.flatMap(h => h.tabs), ...SETTINGS]) {
    if (NOT_DRAWN.has(page) || !allowed(page)) continue;
    const view = env.views[page];
    const settingsPage = SETTINGS.includes(page);
    const key = settingsPage ? page : env.baseOf(page);
    if (!view?.render || seen.has(key)) continue;
    seen.add(key);
    await new Promise(resolve => setTimeout(resolve, 0));   // let the screen breathe between pages
    if (env.cancelled?.()) return;
    const before = env.settings.get();
    try {
      if (settingsPage) env.settings.set(page);
      const html = settingsPage && view.indexText ? view.indexText(ctx) : String(view.render(ctx));
      push([{ kind: 'On the page', label: titles[page] || page, hint: '', body: htmlToText(html), run: () => env.goTo(page) }]);
    } catch { /* a page that cannot be drawn here is simply not searched */ }
    finally { env.settings.set(before); }
  }
}
