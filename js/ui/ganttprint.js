// The schedule as a printed page (v0.22.4, docs/plan-hub-makeover.md part 6): A3 landscape in the house style, the whole
// project on one sheet: a row per task with its plan (grey) and forecast bar, milestones, the critical path, today's line,
// month columns and the legend. Drawn as SVG so it prints sharp at any size.

import { toDay, fromDay, fmtDay, fmtFull } from '../core/util.js';
import { html } from './dom.js';
import { docHead, footText, signoff } from './print.js';
import { docRef } from '../engine/docref.js';

const STATUS = { done: ['Done', '#188038'], active: ['In progress', '#0b57d0'], late: ['Overdue', '#d93025'], pending: ['Not started', '#98a2b3'] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The reference of the printed programme: AP-CHB-PRG-2026-10-25 (the day it was printed). */
export const ganttRef = c => docRef({ company: c.global.company, project: c.project, type: 'PRG', key: c.today });

/**
 * The SVG chart. `width` is the drawing width in px (A3 landscape is about 1500 px of content); rows get shorter when
 * there are many tasks, so a long programme still fits one sheet.
 */
export function ganttSvg(s, today, { width = 1500, nameW = 330, maxH = 900 } = {}) {
  const rows = s.rows || [];
  const T = toDay(today);
  const from = Math.min(s.start, s.planStart, T) - 2;
  const to = Math.max(s.end, s.planEnd, T) + 4;
  const span = Math.max(1, to - from + 1);
  const chartW = width - nameW;
  const rowH = Math.max(14, Math.min(40, Math.floor((maxH - 40) / Math.max(1, rows.length))));
  const head = 34, H = head + rows.length * rowH + 4;
  const x = d => nameW + (d - from) / span * chartW;
  const out = [];
  // months
  let d = from;
  while (d <= to) {
    const iso = fromDay(d), y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    const next = toDay(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
    const a = x(d), b = x(Math.min(next, to + 1));
    out.push(html`<rect x="${a}" y="0" width="${b - a}" height="${H}" fill="${m % 2 ? '#ffffff' : '#f6f8fb'}"/>`);
    if (b - a > 26) out.push(html`<text x="${(a + b) / 2}" y="14" text-anchor="middle" class="gp-m">${MON[m - 1]}${m === 1 || d === from ? ` ${y}` : ''}</text>`);
    out.push(html`<line x1="${a}" y1="0" x2="${a}" y2="${H}" stroke="#dde2ea"/>`);
    d = next;
  }
  // weeks (Mondays) as ticks when there is room
  if (chartW / span * 7 >= 14) for (let w = from; w <= to; w++) if (new Date(fromDay(w) + 'T00:00:00Z').getUTCDay() === 1) out.push(html`<text x="${x(w) + 1}" y="28" class="gp-w">${+fromDay(w).slice(8)}</text>`);
  out.push(html`<line x1="0" y1="${head}" x2="${width}" y2="${head}" stroke="#0b4f9c" stroke-width="1.5"/>`);
  rows.forEach((r, i) => {
    const y = head + i * rowH, mid = y + rowH / 2, bh = Math.max(6, rowH * 0.42);
    if (i % 2) out.push(html`<rect x="0" y="${y}" width="${nameW}" height="${rowH}" fill="#f6f8fb"/>`);
    out.push(html`<line x1="0" y1="${y + rowH}" x2="${width}" y2="${y + rowH}" stroke="#eef1f5"/>`);
    const label = `${r.name}${r.milestone ? '' : ` · ${Math.round(r.progress || 0)}%`}`;
    out.push(html`<text x="6" y="${mid + 4}" class="gp-n${r.critical ? ' crit' : ''}">${label.length > 52 ? label.slice(0, 51) + "…" : label}</text>`);
    out.push(html`<rect x="${x(r.planEs)}" y="${mid + bh / 2 - 1}" width="${Math.max(2, x(r.planEf + 1) - x(r.planEs))}" height="3" fill="#b8c2d0"/>`);
    const col = (STATUS[r.status] || STATUS.pending)[1];
    if (r.milestone) {
      const cx = x(r.es + 0.5), k = bh * 0.75;
      out.push(html`<path d="M${cx} ${mid - k}L${cx + k} ${mid}L${cx} ${mid + k}L${cx - k} ${mid}Z" fill="${col}"/>`);
      if (cx + k + 70 < width) out.push(html`<text x="${cx + k + 4}" y="${mid + 4}" class="gp-d">${fmtDay(r.es)}</text>`);
    } else {
      const a = x(r.es), w = Math.max(3, x(r.ef + 1) - a);
      out.push(html`<rect x="${a}" y="${mid - bh / 2 - 1}" width="${w}" height="${bh}" rx="2" fill="${col}" fill-opacity=".28" stroke="${r.critical ? '#b42318' : col}" stroke-width="${r.critical ? 1.4 : 0.8}"/>`);
      out.push(html`<rect x="${a}" y="${mid - bh / 2 - 1}" width="${w * Math.min(100, r.progress || 0) / 100}" height="${bh}" rx="2" fill="${col}"/>`);
      if (r.slip > 0 && (r.progress || 0) < 100 && a + w + 40 < width) out.push(html`<text x="${a + w + 4}" y="${mid + 4}" class="gp-s">+${r.slip} d</text>`);
    }
  });
  const tx = x(T + 0.5);
  out.push(html`<line x1="${tx}" y1="${head - 6}" x2="${tx}" y2="${H}" stroke="#d93025" stroke-width="1.4" stroke-dasharray="4 3"/>`);
  out.push(html`<text x="${tx + 3}" y="${head - 8}" class="gp-t">Today</text>`);
  out.push(html`<line x1="${nameW}" y1="0" x2="${nameW}" y2="${H}" stroke="#0b4f9c"/>`);
  return html`<svg class="gp-svg" viewBox="0 0 ${width} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

/** The printed programme: letterhead, the figures, the chart, the legend and the sign-off. */
export function ganttPaper(c) {
  const s = c.sched, ref = ganttRef(c);
  const done = s.rows.filter(r => r.status === 'done').length, late = s.rows.filter(r => r.status === 'late').length;
  const pace = s.slip > 0 ? `${s.slip} working days behind` : s.slip < 0 ? `${-s.slip} working days ahead` : 'On plan';
  return html`<div class="paper dsr a3 doc-paper gantt-paper" data-foot="${footText(c, 'Project programme', ref)}">
    ${docHead(c, { title: 'Project programme', sub: `${c.project.name} · as of ${fmtFull(c.today)}`, ref, status: pace, tone: s.slip > 0 ? 'warn' : 'ok',
      facts: [['Planned', s.rows.length ? `${fmtDay(s.planStart)} to ${fmtDay(s.planEnd)}` : '—'], ['Forecast finish', s.rows.length ? fmtDay(s.end) : '—'], ['Tasks', `${s.rows.length} · ${done} done${late ? ` · ${late} overdue` : ''}`], ['Client', c.project.client?.name || (typeof c.project.client === 'string' ? c.project.client : '')]] })}
    ${s.rows.length ? html`<div class="gp-chart">${ganttSvg(s, c.today)}</div>` : html`<p class="muted">No tasks in the schedule yet.</p>`}
    <div class="gp-key">${Object.values(STATUS).map(([label, col]) => html`<span><i style="background:${col}"></i>${label}</span>`)}
      <span><i class="plan"></i>Plan</span><span><i class="crit"></i>Critical path</span><span><b>◆</b>Milestone</span><span><i class="today"></i>Today</span></div>
    ${signoff([{ label: 'Prepared by' }, { label: 'Checked by (project engineer)' }, { label: 'Approved by' }])}
  </div>`;
}
