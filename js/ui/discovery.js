// v1.52.0 (owner, 11 Nov, D1 + D2): Discovery. Installation: the K-HOME partner, installation methods, new technology.
// Trading: the container housing market and potential markets in Africa, the Middle East and Europe, with Make a lead
// (a Deal enquiry). The Admin, the GM and the Executive (read only) see it. Headlines come from the server
// (functions/discovery.js, every 6 hours); each opens on its own site. Saved items stay on this device.
import { store } from '../core/store.js';
import { uid, fmtDate } from '../core/util.js';
import { html } from './dom.js';
import { currentDivision, TRADING } from '../core/division.js';
import { TABS, REGIONS, KHOME, itemsFor, newThisWeek, leadOf } from '../engine/discovery.js';
import { nextDealRef } from '../engine/deals.js';

const SAVE_KEY = 'sf:discoverySaved';
const readSaved = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch { return []; } };
const writeSaved = list => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(-200))); } catch { /* private window */ } };

let items = null, status = null, loading = false, busy = false, note = '';
const f = { installation: { tab: 'partner', q: '', region: '', saved: false }, trading: { tab: 'market', q: '', region: '', saved: false } };
const divNow = () => (currentDivision() === TRADING ? TRADING : 'installation');

/** A few sample headlines for ?local (never written to a real database). */
export const SAMPLE = [
  { id: 's1', div: 'installation', tab: 'partner', region: '', source: 'K-HOME blog', title: 'How to install a flat pack container house in one day', link: 'https://khomechina.com/blog', summary: 'Sample: the steps from base to roof panels.', at: '2026-11-10T08:00:00.000Z' },
  { id: 's2', div: 'installation', tab: 'install', region: '', source: 'Sample news', title: 'Steel foundations for modular camps on soft ground', link: 'https://example.com/a', summary: 'Sample: screw piles versus concrete pads.', at: '2026-11-09T08:00:00.000Z' },
  { id: 's3', div: 'installation', tab: 'tech', region: '', source: 'Modular Building Institute', title: 'Rock wool panels pass new fire test', link: 'https://example.com/b', summary: '', at: '2026-11-08T08:00:00.000Z' },
  { id: 's4', div: 'trading', tab: 'market', region: 'africa', source: 'Sample news', title: 'Container housing demand grows in East Africa', link: 'https://example.com/c', summary: 'Sample: camps and schools lead demand.', at: '2026-11-10T08:00:00.000Z' },
  { id: 's5', div: 'trading', tab: 'leads', region: 'mideast', source: 'Sample news', title: 'Gulf contractor seeks 2,000-bed labour camp', link: 'https://example.com/d', summary: '', at: '2026-11-09T08:00:00.000Z' },
  { id: 's6', div: 'trading', tab: 'leads', region: 'europe', source: 'Sample news', title: 'City orders modular student housing', link: 'https://example.com/e', summary: '', at: '2026-11-07T08:00:00.000Z' },
];

function load() {
  loading = true;
  if (!store.cloud) { items = SAMPLE; status = { at: new Date().toISOString(), sample: true }; loading = false; return; }
  Promise.all([store.listCol('discovery'), store.discoveryStatus()])
    .then(([l, s]) => { items = l || []; status = s; })
    .catch(e => { items = []; note = String(e?.message || e); })
    .finally(() => { loading = false; store.notify(); });
}

export const mayRefresh = () => store.cloud && store.role === 'owner' && !store.readOnly;
export const mayLead = () => !store.readOnly;
const when = x => (x.at ? fmtDate(x.at.slice(0, 10)) : x.seen ? `seen ${fmtDate(x.seen.slice(0, 10))}` : '');

function card(x, div, saved) {
  const on = saved.includes(x.id);
  const region = REGIONS.find(([k]) => k === x.region)?.[1];
  return html`<article class="dv-item">
    <a class="dv-title" href="${x.link}" target="_blank" rel="noopener noreferrer">${x.title}</a>
    <div class="dv-meta muted">${x.source}${region ? ` · ${region}` : ''}${when(x) ? ` · ${when(x)}` : ''}</div>
    ${x.summary ? html`<p class="dv-sum">${x.summary}</p>` : ''}
    <div class="dv-acts">
      <a class="btn" href="${x.link}" target="_blank" rel="noopener noreferrer">Open</a>
      <button type="button" class="btn" data-act="dvSave" data-id="${x.id}" aria-pressed="${on}">${on ? '★ Saved' : '☆ Save'}</button>
      ${div === TRADING && mayLead() ? html`<button type="button" class="btn primary" data-act="dvLead" data-id="${x.id}">Make a lead</button>` : ''}
    </div>
  </article>`;
}

function partnerCard() {
  const list = a => html`<ul>${a.map(t => html`<li>${t}</li>`)}</ul>`;
  return html`<details class="dv-ref" open><summary><b>${KHOME.name}</b> · the factory we work with</summary>
    <p>${KHOME.about}</p>
    <div class="dv-cols"><div><h4>Products</h4>${list(KHOME.products)}</div><div><h4>Solutions</h4>${list(KHOME.solutions)}</div><div><h4>In Africa</h4>${list(KHOME.africa)}</div></div>
    <p class="dv-links">${KHOME.links.map(([t, u]) => html`<a class="btn" href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)}</p>
  </details>`;
}

export function render() {
  if (items === null && !loading) load();
  const div = divNow(), s = f[div], tabs = TABS[div], saved = readSaved();
  const all = (items || []).filter(x => x.div === div);
  const list = itemsFor(items, { div, tab: s.saved ? '' : s.tab, region: div === TRADING ? s.region : '', q: s.q, saved: s.saved ? saved : null });
  const fresh = newThisWeek(all, Date.now());
  const count = k => all.filter(x => x.tab === k).length;
  const tabBtn = (k, t, on, act, n) => html`<button type="button" role="tab" class="dv-tab ${on ? 'on' : ''}" aria-selected="${on}" data-act="${act}" data-k="${k}">${t} <small>${n}</small></button>`;
  return html`<section class="card wide dv">
    <div class="toolbar"><h2>Discovery</h2><span class="muted">${div === TRADING ? 'Trading: markets and leads' : 'Installation: partner, methods and new technology'} · ${fresh} new this week${store.readOnly ? ' · Read only' : ''}</span><span class="grow"></span>
      ${mayRefresh() ? html`<button type="button" class="btn" data-act="dvRefresh" ${busy ? 'disabled' : ''}>${busy ? 'Reading…' : 'Refresh'}</button>` : ''}</div>
    <div class="dv-tabs" role="tablist">${tabs.map(([k, t]) => tabBtn(k, t, !s.saved && s.tab === k, 'dvTab', count(k)))}${tabBtn('saved', '★ Saved', s.saved, 'dvSavedTab', all.filter(x => saved.includes(x.id)).length)}</div>
    <div class="actions left">
      <input type="search" data-chg="dvF" data-k="q" value="${s.q}" placeholder="Search headlines" aria-label="Search headlines">
      ${div === TRADING ? html`<select data-chg="dvF" data-k="region" aria-label="Region"><option value="">All regions</option>${REGIONS.map(([k, t]) => html`<option value="${k}" ${s.region === k ? 'selected' : ''}>${t}</option>`)}</select>` : ''}
      <span class="muted">${status?.sample ? 'Sample headlines (local mode)' : status?.at ? `Read ${new Date(status.at).toLocaleString()} · read again every 6 hours` : 'The server reads the news every 6 hours.'}${note ? ` · ${note}` : ''}</span>
    </div>
    ${div !== TRADING && s.tab === 'partner' && !s.saved ? partnerCard() : ''}
    ${loading && items === null ? html`<p class="empty">Loading…</p>`
      : list.length ? html`<div class="dv-list">${list.map(x => card(x, div, saved))}</div>`
      : html`<p class="empty">${s.saved ? 'Nothing saved yet: tap ☆ Save on a headline.' : s.q || s.region ? 'Nothing matches.' : 'No headlines yet: the server reads the news every 6 hours.'}</p>`}
    <p class="muted dv-foot">Headlines, a short summary and the link only; each article opens on its own site. Kept 30 days.</p>
  </section>`;
}

export const actions = {
  dvTab(el) { const s = f[divNow()]; s.tab = el.dataset.k; s.saved = false; },
  dvSavedTab() { f[divNow()].saved = true; },
  dvSave(el) { const id = el.dataset.id, l = readSaved(); writeSaved(l.includes(id) ? l.filter(x => x !== id) : [...l, id]); },
  dvLead(el, c) {
    if (!mayLead()) return;
    const x = (items || []).find(i => i.id === el.dataset.id);
    if (!x) return;
    const { notes } = leadOf(x);
    const d = { id: uid('dl'), ref: nextDealRef(c.company.deals), customer: '', status: 'enquiry', margin: 20, lines: [], wanted: '', notes, created: c.today, by: store.user?.email || '', division: TRADING, from: 'discovery' };
    store.updateCompany(co => { co.deals ||= []; co.deals.push(d); });
    note = `Lead ${d.ref} made in Deals.`;
    location.hash = '#deals';
  },
  async dvRefresh() {
    if (busy || !mayRefresh()) return;
    busy = true; note = ''; store.notify();
    try { const out = await store.callServer('discoveryNow', {}); note = `${out?.added ?? 0} new or changed${out?.failed?.length ? `, ${out.failed.length} sources did not answer` : ''}.`; items = null; }
    catch (e) { note = String(e?.message || e); }
    finally { busy = false; store.notify(); }
  },
};
export const changes = { dvF(el) { f[divNow()][el.dataset.k] = el.value; } };
