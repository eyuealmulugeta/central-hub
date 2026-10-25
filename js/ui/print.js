// The print engine (v0.22.1, docs/plan-hub-makeover.md part 6): one house style for every document. The letterhead
// band with the logo, the title, the reference and the status; numbered sections; sign-off blocks; and a footer on every
// printed page (company, document, project, reference, printed date, "Page x of y"). The Daily Site Report set the
// style (js/ui/dailyreport.js); the other documents use these pieces so they all look alike.
//
// A document is `<div class="paper dsr [land]" data-foot="...">`: `dsr` is the house style, `land` an A4 landscape
// page. main.js reads data-foot and writes it into the printed page's footer (footCss); the shared PDF draws it too.

import { fmtFull } from '../core/util.js';
import { html } from './dom.js';

/**
 * The footer line of a document: "Amistad Prefab · Site pay sheet · CHB Warehouse · AP-CHB-PAY-2026-10-B · printed 1 Nov 2026".
 * `project: false` leaves the project out (company documents such as payslips).
 */
export function footText(c, title, ref, { note = '', project = true } = {}) {
  const co = c.global.company?.name || 'Amistad Prefab';
  return [co, title, project ? c.project?.name : '', ref, `printed ${fmtFull(c.today)}`, note].filter(Boolean).join(' · ');
}

/**
 * The letterhead band. `facts` are [label, value] pairs shown under it (a "Ref" fact is added from `ref`), `status` a
 * short state such as "Approved" with its tone (ok, warn or '').
 */
export function docHead(c, { title, sub = '', ref = '', status = '', tone = '', facts = [] }) {
  const co = c.global.company || {};
  const all = [...facts.filter(([, v]) => v !== '' && v != null), ...(ref ? [['Ref', ref]] : [])];
  return html`<header class="dsr-head">
      <img src="${co.logo || 'assets/logo.png'}" alt="">
      <div class="dsr-co"><b class="p-company">${co.name || 'Amistad Prefab'}</b><span>${[String(co.address || '').split('\n')[0], co.phone].filter(Boolean).join(' · ')}</span></div>
      <div class="dsr-title"><h2>${title}</h2>${sub ? html`<span>${sub}</span>` : ''}${status ? html`<span class="dsr-st ${tone}">${status}</span>` : ''}</div>
    </header>
    ${all.length ? html`<dl class="facts doc-facts">${all.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}`;
}

/** A numbered section: "01 Summary". `n` may be a letter for an annex, or '' for no number. */
export const docSec = (n, title, body, sub = '', cls = '') => html`<section class="dsr-sec ${cls}"><h3>${n === '' ? '' : html`<span>${typeof n === 'number' ? String(n).padStart(2, '0') : n}</span>`}${title}${sub ? html` <small>${sub}</small>` : ''}</h3>${body}</section>`;

/** Sign-off blocks: [{ label, name, note }], each with lines for the signature and the date; `{ stamp: true }` is a box for the company stamp. */
export const signoff = list => html`<div class="doc-sign" style="grid-template-columns:repeat(${list.length},1fr)">${list.map(s => s.stamp
  ? html`<div><span>${s.label || 'Company stamp'}</span><em class="doc-stamp"></em></div>`
  : html`<div><span>${s.label}</span><b>${s.name || ''}</b><i>Signature</i><i>${s.note || 'Date'}</i></div>`)}</div>`;

/** The footer line on screen and in the shared PDF; on paper it is in the page margin, with the page number. */
export const docFoot = foot => html`<p class="doc-foot">${foot}</p>`;

/** CSS for the printed pages: the footer text bottom left on every page of the house pages (portrait and landscape). */
export function footCss(text) {
  const t = String(text || '').replace(/[\r\n]+/g, ' ').replace(/[\\"]/g, m => `\\${m}`);
  if (!t) return '';
  const box = `@bottom-left { content: "${t}"; font: 8.5px "Segoe UI", sans-serif; color: #555; margin-left: 12mm; }`;
  return `@page dsr { ${box} } @page land { ${box} } @page a3 { ${box} }`;
}

/**
 * The S-curve: planned progress (dashed) and actual progress (solid) over time, with today's line. `curve` comes
 * from sCurve in js/engine/brief.js. Drawn in the page as SVG, so it prints sharp.
 */
export function sCurveSvg(curve, { width = 520, height = 170 } = {}) {
  const pts = curve.points;
  if (pts.length < 2) return html`<p class="dsr-none">No schedule yet: the S-curve shows once the schedule has tasks.</p>`;
  const L = 30, R = 8, T = 8, B = 20, w = width - L - R, h = height - T - B;
  const t0 = Date.parse(pts[0].day), t1 = Date.parse(pts.at(-1).day) || t0 + 1;
  const x = d => (L + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * w).toFixed(1);
  const y = v => (T + h - v / 100 * h).toFixed(1);
  const line = key => pts.filter(p => p[key] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p[key])}`).join(' ');
  const now = curve.today >= 0 ? pts[curve.today] : null;
  const months = [];
  for (const p of pts) { const m = p.day.slice(0, 7); if (!months.some(x => x.m === m)) months.push({ m, day: p.day }); }
  const label = m => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
  return html`<svg class="scurve" viewBox="0 0 ${width} ${height}" role="img" aria-label="Planned and actual progress">
    ${[0, 25, 50, 75, 100].map(v => html`<line x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}" class="sc-grid"/><text x="${L - 4}" y="${+y(v) + 3}" class="sc-ax" text-anchor="end">${v}%</text>`)}
    ${months.filter((_, i) => months.length < 9 || i % 2 === 0).map(m => html`<text x="${x(m.day)}" y="${height - 5}" class="sc-ax">${label(m.m)}</text>`)}
    <path d="${line('planned')}" class="sc-plan"/>
    <path d="${line('actual')}" class="sc-act"/>
    ${now ? html`<line x1="${x(now.day)}" x2="${x(now.day)}" y1="${T}" y2="${T + h}" class="sc-today"/>
      <circle cx="${x(now.day)}" cy="${y(now.actual ?? 0)}" r="3.5" class="sc-dot"/>` : ''}
  </svg>
  <p class="sc-key"><span class="sc-k plan"></span>Planned <span class="sc-k act"></span>Actual${now ? ` · today ${Math.round(now.actual ?? 0)} % against ${Math.round(now.planned)} % planned` : ''}</p>`;
}

/** The site plan as zone tiles: worked today (blue), worked before (light), planned for the next day (dashed). */
export function zonePlan(tiles) {
  if (!tiles.length) return html`<p class="dsr-none">No zones named in the reports yet. Zones come from the headings of the site's activity lines ("Zone A: ...").</p>`;
  return html`<div class="zplan">${tiles.map((t, i) => html`<div class="zt ${t.state}"><em>${i + 1}</em><b>${t.zone}</b><span>${t.state === 'today' ? `${t.lines} item${t.lines === 1 ? '' : 's'} today` : t.state === 'before' ? 'Worked before' : 'Next day'}</span></div>`)}</div>
    <p class="sc-key"><span class="zk today"></span>Worked today <span class="zk before"></span>Worked before <span class="zk next"></span>Planned next day</p>`;
}
