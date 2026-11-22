// v1.81.0 (owner, 22 Nov): Project › Register: the schedule and quantity register (one row per activity with a total
// quantity), edited here, from Excel and to Excel. v1.82.0: Project › Progress: what was executed against the total,
// planned % to date, variance, the S-curve, progress per activity, the daily quantity of one activity, a date range,
// and CRITICAL RISK. v1.83.0: a past day's quantity corrected here, with the audit log. Figures: engine/register.js.

import { store } from '../core/store.js';
import { calendarOf } from '../engine/calendar.js';
import { registerRows, progressOf, registerCurve, risks, registerSheet, importRegister, qtyProblem, editQty, dailyOf, BEHIND_DAYS } from '../engine/register.js';
import { readXlsx } from '../core/xlsx.js';
import { xlsxBytes } from '../core/xlsxwrite.js';
import { uid, toDay, nextWork, workBetween, num, fmtDate, downloadText } from '../core/util.js';
import { html, chip } from './dom.js';
import { sCurveSvg } from './print.js';

let mode = 'register';
let notice = '';
let read = null;               // the Excel file read, waiting for Apply: { name, result }
let from = '', to = '';        // the date range of the charts ('' = whole plan / today)
let pick = '';                 // the activity of the daily chart
export function preset(p = {}) { mode = p.progress ? 'progress' : 'register'; notice = ''; }

const wdOf = c => calendarOf(c.project, c.ws.reports || []);
const reportsOf = c => (c.ws.reports || []).filter(r => !r.field?.nowork);
const mayPlan = c => c.role !== 'site';
const mayFix = () => !!store.canApprove;

export function render(c) { return mode === 'progress' ? progressView(c) : registerView(c); }

// ---- Register ----

function registerView(c) {
  const wd = wdOf(c), rows = registerRows(c.ws.tasks || [], { workDays: wd, today: c.today });
  const edit = mayPlan(c);
  const cell = (r, f, v, type = 'text', w = '') => edit
    ? html`<input type="${type}" class="reg-in ${w}" value="${v ?? ''}" data-chg="regSet" data-id="${r.id}" data-f="${f}" ${type === 'number' ? 'min="0" step="any"' : ''}>`
    : html`${v ?? ''}`;
  const others = (c.ws.tasks || []).filter(t => !t.milestone && !(+t.totalQty > 0)).length;
  return html`<div class="toolbar">
      <h2>Schedule and quantity register</h2><span class="grow"></span><span class="muted">${notice}</span>
      <button class="btn" data-act="regExcel" ${rows.length ? '' : 'disabled'}>Export to Excel</button>
      ${edit ? html`<label class="btn">Import from Excel <input type="file" accept=".xlsx" data-chg="regFile" hidden></label>` : ''}
    </div>
    ${read ? importBox(read) : ''}
    <section class="card">
      <p class="muted">One row per activity with a total quantity. Daily rate = total ÷ planned working days (the project's working days and holidays). Weight is optional: with weights the overall progress uses them, otherwise the planned days.${others ? ` ${others} schedule task${others === 1 ? ' has' : 's have'} no total quantity and ${others === 1 ? 'is' : 'are'} left out: give a total on the Schedule or here by import.` : ''}</p>
      ${rows.length ? html`<div class="scroll-x"><table class="table reg">
        <thead><tr><th>WBS</th><th>Activity</th><th>Unit</th><th class="num">Total</th><th>Planned start</th><th>Planned finish</th><th class="num">Working days</th><th class="num">Daily rate</th><th class="num">Weight</th></tr></thead>
        <tbody>${rows.map(r => html`<tr>
          <td>${cell(r, 'wbs', r.wbs, 'text', 'w-s')}</td><td>${cell(r, 'name', r.name)}</td><td>${cell(r, 'unit', r.unit, 'text', 'w-s')}</td>
          <td class="num">${cell(r, 'totalQty', r.total, 'number', 'w-m')}</td>
          <td>${cell(r, 'start', r.start, 'date')}</td><td>${cell(r, 'finish', r.finish, 'date')}</td>
          <td class="num">${r.days}</td><td class="num">${num(r.rate)} ${r.unit}</td><td class="num">${cell(r, 'weight', r.weight || '', 'number', 'w-s')}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty">No activity with a total quantity yet. Add tasks on the Schedule (with a total quantity), or import the register from Excel: columns WBS, Activity, Unit, Total quantity, Planned start, Planned finish, Weight.</p>`}
    </section>`;
}

function importBox(x) {
  const r = x.result;
  return html`<section class="card">
    <p><b>${x.name}</b>: ${r.updated} activit${r.updated === 1 ? 'y' : 'ies'} updated, ${r.added} added.</p>
    ${r.problems.length ? html`<ul class="plain">${r.problems.slice(0, 12).map(p => html`<li class="bad">${p}</li>`)}</ul>` : ''}
    <div class="actions left"><button class="btn primary" data-act="regApply" ${r.added + r.updated ? '' : 'disabled'}>Apply to the schedule</button><button class="btn ghost" data-act="regDrop">Cancel</button></div>
  </section>`;
}

// ---- Progress ----

const bars = list => {
  if (!list.length) return html`<p class="muted">No activity has a logged quantity yet.</p>`;
  const H = 22, W = 520, L = 170, w = W - L - 50;
  return html`<svg class="reg-bars" viewBox="0 0 ${W} ${list.length * H + 18}" role="img" aria-label="Progress per activity against 100 %">
    ${list.map((r, i) => html`<text x="${L - 6}" y="${i * H + 15}" text-anchor="end" class="sc-ax">${String(`${r.wbs} ${r.name}`).slice(0, 28)}</text>
      <rect x="${L}" y="${i * H + 4}" width="${w}" height="${H - 8}" class="rb-full"/>
      <rect x="${L}" y="${i * H + 4}" width="${(Math.min(100, r.pct) / 100 * w).toFixed(1)}" height="${H - 8}" class="${r.pct > 100 ? 'rb-over' : r.behind > BEHIND_DAYS ? 'rb-late' : 'rb-done'}"/>
      <line x1="${L + r.planned / 100 * w}" x2="${L + r.planned / 100 * w}" y1="${i * H + 2}" y2="${i * H + H - 2}" class="rb-plan"/>
      <text x="${L + w + 6}" y="${i * H + 15}" class="sc-ax">${Math.round(r.pct)} %</text>`)}
    <text x="${L}" y="${list.length * H + 14}" class="sc-ax">0 %</text><text x="${L + w}" y="${list.length * H + 14}" text-anchor="end" class="sc-ax">100 %</text>
  </svg><p class="sc-key"><span class="sc-k act"></span>Done <span class="rb-k"></span>Planned to date</p>`;
};

const dayChart = (days, unit) => {
  if (!days.length) return html`<p class="muted">No quantity logged in these dates.</p>`;
  const W = 520, H = 150, B = 20, max = Math.max(...days.map(d => d.qty), 1), bw = Math.min(24, (W - 40) / days.length - 2);
  return html`<svg class="reg-days" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily quantity">
    ${days.map((d, i) => { const h = d.qty / max * (H - B - 14), x = 30 + i * (bw + 2); return html`<rect x="${x}" y="${H - B - h}" width="${bw}" height="${h}" class="${d.over ? 'rb-over' : 'rb-done'}"><title>${d.date}: ${d.qty} ${unit}</title></rect>
      ${days.length <= 16 || i % 2 === 0 ? html`<text x="${x}" y="${H - 6}" class="sc-ax">${d.date.slice(8)}</text>` : ''}`; })}
    <text x="0" y="12" class="sc-ax">${num(max)} ${unit}</text></svg>`;
};

function progressView(c) {
  const wd = wdOf(c), reps = reportsOf(c), tasks = c.ws.tasks || [];
  const end = to || c.today;
  const p = progressOf(tasks, reps, { today: c.today, workDays: wd, to: end });
  if (!p.rows.length) return html`<section class="card"><p class="empty">No activity with a total quantity yet. Fill the Register first.</p></section>`;
  const curve = registerCurve(tasks, reps, { today: end, workDays: wd, from: from || undefined, to: to || undefined });
  const started = p.rows.filter(r => r.started), idle = p.rows.filter(r => !r.started);
  const sel = p.rows.find(r => r.id === pick) || started[0] || p.rows[0];
  const range = dailyOf(p, sel.id, from || '', end);
  const crit = risks(tasks, reps, { today: c.today, workDays: wd });
  const over = p.rows.flatMap(r => r.over.map(o => ({ ...o, r })));
  return html`<div class="toolbar">
      <h2>Progress ${Math.round(p.actual)} % against ${Math.round(p.planned)} % planned</h2>
      <span class="muted">weighted by ${p.by === 'weight' ? 'the weight column' : 'planned working days'} · to ${fmtDate(end)}</span><span class="grow"></span>
      <label>From <input type="date" data-chg="regFrom" value="${from}"></label><label>To <input type="date" data-chg="regTo" value="${to}"></label>
      <span class="muted">${notice}</span>
    </div>
    ${crit.length ? html`<section class="card crit">
      <h3>CRITICAL RISK</h3>
      ${crit.map(x => html`<div class="crit-i"><b>${x.title}</b> <span>${x.text}</span>
        <ol>${x.options.map((o, i) => html`<li class="${i === x.recommend ? 'rec' : ''}">${o}${i === x.recommend ? html` <b>Recommended.</b>` : ''}</li>`)}</ol></div>`)}
      <p class="muted small">Money above 5,000 USD is not checked here: the register has no cost per activity.</p>
    </section>` : ''}
    ${over.length ? html`<section class="card"><h3>Over the total quantity</h3><ul class="plain">${over.map(o => html`<li>${chip('Over total', 'warn')} <b>${o.r.wbs} ${o.r.name}</b> ${fmtDate(o.date)}: ${o.why}</li>`)}</ul></section>` : ''}
    <section class="card">
      <div class="scroll-x"><table class="table reg">
        <thead><tr><th>WBS</th><th>Activity</th><th class="num">Total</th><th class="num">Done</th><th class="num">Progress</th><th class="num">Remaining</th><th class="num">Planned to date</th><th class="num">Variance</th><th>Status</th></tr></thead>
        <tbody>${started.map(r => html`<tr>
          <td>${r.wbs}</td><td>${r.name}</td><td class="num">${num(r.total)} ${r.unit}</td><td class="num">${num(r.cum)}</td><td class="num"><b>${num(r.pct, 1)} %</b></td>
          <td class="num">${num(r.remaining)}</td><td class="num">${num(r.planned, 1)} %</td><td class="num ${r.variance < 0 ? 'bad' : 'ok'}">${r.variance > 0 ? '+' : ''}${num(r.variance, 1)} pts</td>
          <td>${r.behind > BEHIND_DAYS ? chip(`${r.behind} days behind`, 'high') : chip(r.status, r.status === 'Done' ? 'ok' : 'info')}</td></tr>`)}
        ${idle.map(r => html`<tr class="muted"><td>${r.wbs}</td><td>${r.name}</td><td class="num">${num(r.total)} ${r.unit}</td><td colspan="5"></td><td>${chip('Not started')}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted small">Only activities with a logged quantity count in the charts and the client report; the others show Not started.</p>
    </section>
    <div class="grid2">
      <section class="card"><h3>S-curve, planned against actual</h3>${sCurveSvg(curve)}</section>
      <section class="card"><h3>Progress per activity</h3>${bars(started)}</section>
    </div>
    <section class="card">
      <div class="toolbar"><h3>Daily quantity</h3><select data-chg="regPick">${p.rows.map(r => html`<option value="${r.id}" ${r.id === sel.id ? 'selected' : ''}>${r.wbs} ${r.name}</option>`)}</select></div>
      ${dayChart(range, sel.unit)}
      ${range.length ? html`<div class="scroll-x"><table class="table reg"><thead><tr><th>Date</th><th class="num">Quantity</th><th>From</th><th></th></tr></thead><tbody>
        ${range.map(d => html`<tr><td>${fmtDate(d.date)}</td><td class="num">${num(d.qty)} ${sel.unit}${d.over ? html` ${chip('Over total', 'warn')}` : ''}</td><td>${d.from === 'hub' ? 'Central Hub' : 'Field Report'}</td>
          <td>${mayFix() ? html`<span class="reg-fix"><input type="number" min="0" step="any" class="w-m" value="${d.qty}" aria-label="New quantity"><input type="text" placeholder="Reason (needed over the total)" aria-label="Reason"><button class="btn small" data-act="qtyFix" data-rid="${d.reportId}" data-tid="${sel.id}" data-was="${d.qty}">Save</button></span>` : ''}</td></tr>`)}
      </tbody></table></div>` : ''}
      ${auditOf(c, sel.id)}
    </section>`;
}

function auditOf(c, id) {
  const lines = (c.ws.reports || []).flatMap(r => (r.qtyLog || []).filter(x => x.taskId === id).map(x => ({ ...x, date: r.date }))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return lines.length ? html`<h4>Changes made</h4><ul class="plain small">${lines.slice(0, 20).map(x => html`<li>${fmtDate(x.at.slice(0, 10))} ${x.at.slice(11, 16)} · ${x.by}: ${fmtDate(x.date)} ${x.from ?? '–'} → ${x.to}${x.why ? ` (${x.why})` : ''}</li>`)}</ul>` : '';
}

// ---- actions ----

export const actions = {
  regExcel(el, c) {
    const wd = wdOf(c), rows = registerRows(c.ws.tasks || [], { workDays: wd, today: c.today });
    const p = progressOf(c.ws.tasks || [], reportsOf(c), { today: c.today, workDays: wd });
    downloadText(`Register ${c.project.fieldCode || c.project.name} ${c.today}.xlsx`, xlsxBytes([{ name: 'Register', rows: registerSheet(rows, p) }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  },
  regApply(el, c) {
    if (!read || !mayPlan(c)) return;
    const { tasks, added, updated } = read.result;
    if (!confirm(`Apply the register from ${read.name}? ${updated} activit${updated === 1 ? 'y' : 'ies'} updated, ${added} added to the schedule.`)) return;
    store.update(ws => { ws.tasks = tasks; });
    notice = `Register applied: ${updated} updated, ${added} added.`; read = null;
  },
  regDrop() { read = null; },
  qtyFix(el, c) {
    if (!mayFix()) return;
    const box = el.closest('.reg-fix'), [q, why] = box.querySelectorAll('input');
    const { rid, tid } = el.dataset, was = +el.dataset.was;
    const t = (c.ws.tasks || []).find(x => x.id === tid);
    const p = progressOf(c.ws.tasks || [], reportsOf(c), { today: c.today, workDays: wdOf(c) });
    const done = (p.rows.find(r => r.id === tid)?.cum || 0) - was;
    const bad = qtyProblem(q.value, { total: +t?.totalQty || 0, done, why: why.value });
    if (bad) { notice = bad; return; }
    if (+q.value === was && !why.value.trim()) return;
    const by = store.profile?.name || store.user?.name || store.user?.email || 'Central Hub';
    store.update(ws => { const i = ws.reports.findIndex(r => r.id === rid); if (i > -1) ws.reports[i] = editQty(ws.reports[i], tid, { qty: +q.value, why: why.value, by, before: was }); });
    notice = `Saved: ${was} → ${+q.value}. Every figure is worked out again; the change is in the log below.`;
  },
};

export const changes = {
  regSet(el, c) {
    if (!mayPlan(c)) return;
    const { id, f } = el.dataset, wd = wdOf(c), v = el.value;
    store.update(ws => {
      const t = ws.tasks.find(x => x.id === id);
      if (!t) return;
      if (f === 'totalQty' || f === 'weight') t[f] = Math.max(0, +v || 0);
      else if (f === 'finish') { if (v && t.start && v >= t.start) t.duration = Math.max(1, workBetween(nextWork(toDay(t.start), wd), toDay(v), wd) + 1); }
      else if (f === 'start') { if (v) t.start = v; }
      else if (f === 'name') { if (v.trim()) t.name = v.trim(); }
      else t[f] = v.trim();
    });
  },
  async regFile(el, c) {
    const f = el.files?.[0];
    if (!f) return;
    try {
      const rows = await readXlsx(await f.arrayBuffer());
      read = { name: f.name, result: importRegister(rows, c.ws.tasks || [], { workDays: wdOf(c), newId: () => uid('t') }) };
    } catch (err) { notice = `Not read: ${err.message}`; }
    el.value = '';
    store.notify();
  },
  regFrom(el) { from = el.value; },
  regTo(el) { to = el.value; },
  regPick(el) { pick = el.value; },
};

