// Daily reports. A report holds the same entries as the Field Report app:
// weather and hours, safety, delays, manpower, equipment, progress, notes,
// next-day plan and requests. Reports arrive from Field Report (and wait for
// the Office to confirm their progress) or are entered here directly.

import { store } from '../core/store.js';
import { billingOf } from '../engine/billing.js';
import { fieldConfig, fetchFieldReports, importFieldReports, importSince, suggestQuantities, reviewFieldReport, reportedByTask, buildSetup, sendSetup, FIELD_SCHEMA, DEEP_OVERLAP_DAYS } from '../sync/fieldreport.js';
import { mergeCalendar, weeklyOff } from '../engine/calendar.js';
import { uid, toDay, fromDay, fmtDate, clamp, sum, num, todayISO } from '../core/util.js';
import { derive } from '../core/derive.js';
import { summaryOf } from './seen.js';
import { html, options, chip } from './dom.js';
import { connected } from './fieldsetup.js';
import { openPanel } from './prices.js';
import { toTrash, inBin, restore as restoreTrash, purge, isExpired, daysLeft, RETENTION_DAYS } from '../engine/trash.js';
import { inPeriod, periodChoices, monthName } from '../engine/periods.js';

const WEATHER = ['Clear', 'Cloudy', 'Rain', 'Wind', 'Heat'];
const GROUND = ['Dry', 'Wet', 'Muddy'];
const SAFETY = ['None', 'Near miss', 'Incident'];
const DELAY_KINDS = ['Weather', 'Material', 'Equipment', 'Manpower', 'Client', 'Other'];
const EQUIPMENT_STATUS = ['Active', 'Idle', 'Breakdown'];
const BLANK_EQUIPMENT_ROWS = 2;
const LOOKAHEAD_DAYS = 10;

let notice = '';
let fieldNotice = '';
let reviewing = null;   // id of the field report being confirmed
let busy = false;
let autoFailed = false; // the notice on screen is an error from an automatic check
let checkedAt = '';     // time of the last automatic check, e.g. 14:05
const expanded = new Set(); // ids of submitted reports shown in full
let replyNotice = '';   // result of the last reply sent to the site
let replying = false;
let sentBack = null;    // { id, decision, text }: the reply just sent from the review, shown until "Go back"
let viewing = null;     // id of a report opened for reading (its PDF on top, the history beside it)
let binNotice = '';
let tab = '';           // 'list' (the reports) or 'enter' (the Daily report form); '' until chosen: the site starts on the form
const period = { year: 0, month: 0, week: 0 };   // the reports shown: 0 is any

const FIELD_STATUS = { submitted: ['Submitted by site', 'info'], approved: ['Approved', 'ok'], changes: ['Changes requested', 'warn'] };
const REPLY_DONE = {
  approve: 'Approved. The site is notified and the report is locked in Field Report.',
  changes: 'Sent back. The site is notified and can correct and re-submit.',
  comment: 'Comment sent to the site.',
  reopen: 'Reopened. The site can edit and re-submit.',
};

// tasks the field can report on today: anything unfinished that has started or is about to
const reportable = c => c.sched.rows.filter(r => r.progress < 100 && (r.actualStart || r.es <= toDay(c.today) + LOOKAHEAD_DAYS));
const underReview = ws => ws.reports.find(r => r.id === reviewing && r.review === 'pending') || null;
// trades with a day rate, plus any the field report used that have none yet
const tradeList = (ws, cur) => [...new Set([...Object.keys(ws.laborRates), ...(cur?.manpower || []).map(m => m.trade)])];
// equipment named in earlier reports, most recent first, offered again as ready rows
const knownEquipment = ws => [...new Set([...ws.reports].sort((a, b) => b.date.localeCompare(a.date))
  .flatMap(r => (r.field?.equipment || []).map(e => e.name)))].filter(Boolean);
const lines = text => String(text || '').split('\n').map(s => s.trim()).filter(Boolean);

/** Every entry of one report, laid out like the Field Report sheet. */
function sheet(r, c) {
  const f = r.field || {};
  if (f.nowork) {
    return html`<div class="sheet-detail">
      <b>No work reported</b><span>${f.reason}${f.note ? ` (${f.note})` : ''}</span>
    </div>`;
  }
  const { ws } = c;
  const hoursPerDay = billingOf(c.project).hoursPerDay;
  const crew = r.manpower || [];
  const hrsEach = m => m.hrs ?? (m.count ? hoursPerDay + (m.ot || 0) / m.count : 0);
  const task = id => ws.tasks.find(t => t.id === id);
  const fact = (k, v) => (v || v === 0 ? html`<dt>${k}</dt><dd>${v}</dd>` : '');
  const list = (title, items) => (items?.length
    ? html`<div><span class="muted">${title}</span><ul class="plain prose">${items.map(x => html`<li>${x}</li>`)}</ul></div>` : '');
  const empty = title => html`<div><span class="muted">${title}</span><span class="none">Nothing entered</span></div>`;
  const requests = f.requests?.length ? f.requests.map(x => `${x.priority}: ${x.text}`) : r.issue ? [r.issue] : [];

  return html`<div class="sheet-detail">
    <dl class="facts">
      ${fact('Report No.', f.no)}
      ${fact('Prepared by', [r.by, f.position].filter(Boolean).join(', '))}
      ${fact('Activities', (f.activities || []).join(', '))}
      ${fact('Location', f.location)}
      ${fact('Working hours', f.hours?.start ? `${f.hours.start} to ${f.hours.end}` : '')}
      ${fact('Weather', [r.weather, f.tempC != null && f.tempC !== '' ? `${f.tempC}°C` : ''].filter(Boolean).join(', '))}
      ${fact('Ground', f.ground)}
      ${fact('Safety', f.safety ? (f.safety === 'None' ? 'No incidents or near misses' : f.safety) : '')}
      ${fact('Toolbox talk', f.toolbox == null ? '' : f.toolbox ? 'Held' : 'Not held')}
      ${fact('Photos', f.photos ? `${f.photos} in the PDF` : '')}
    </dl>

    <div><span class="muted">Manpower</span>
      ${crew.length ? html`<table class="table compact">
        <thead><tr><th>Trade</th><th class="r">Qty</th><th class="r">Hours</th><th class="r">Man-hrs</th></tr></thead>
        <tbody>${crew.map(m => html`<tr><td>${m.trade}</td><td class="r">${m.count}</td><td class="r">${num(hrsEach(m), 1)}</td><td class="r">${num(m.count * hrsEach(m), 1)}</td></tr>`)}
          <tr class="group"><td>Total</td><td class="r">${sum(crew, m => m.count)}</td><td></td><td class="r">${num(sum(crew, m => m.count * hrsEach(m)), 1)}</td></tr></tbody>
      </table>` : html`<span class="none">Nothing entered</span>`}</div>

    <div><span class="muted">Equipment</span>
      ${f.equipment?.length ? html`<table class="table compact">
        <thead><tr><th>Equipment</th><th class="r">Qty</th><th class="r">Hours</th><th>Status</th></tr></thead>
        <tbody>${f.equipment.map(e => html`<tr><td>${e.name}</td><td class="r">${e.qty}</td><td class="r">${e.hrs}</td><td>${e.status || ''}</td></tr>`)}</tbody>
      </table>` : html`<span class="none">Nothing entered</span>`}</div>

    ${f.delays?.length
      ? list(`Work delay, ${num(sum(f.delays, d => +d.h || 0))} h in total`, f.delays.map(d => `${d.k}${d.h != null ? `: ${d.h} h` : ''}`))
      : html`<div><span class="muted">Work delay</span><span>No delays reported</span></div>`}

    <div><span class="muted">Progress against the schedule</span>
      ${r.entries?.length ? html`<ul class="plain">${r.entries.map(e => html`
        <li>${task(e.taskId)?.name || 'Removed task'}${e.qty > 0 ? html` <b>+${num(e.qty)} ${task(e.taskId)?.unit || ''}</b>` : ''}${e.progress != null ? html` <b>${e.progress}%</b>` : ''}${e.delayDays ? html` ${chip(`+${e.delayDays} d`, 'warn')}` : ''}
          ${e.note ? html`<span class="muted"> ${e.note}</span>` : ''}</li>`)}</ul>`
      : html`<span class="none">${r.review === 'pending' ? 'Not confirmed yet' : 'Nothing entered'}</span>`}</div>

    ${f.work?.length ? list('Work reported against tasks', f.work.map(w => `${task(w.taskId)?.name || 'Unknown task'}: ${w.qty > 0 ? `${num(w.qty)} ${task(w.taskId)?.unit || ''}` : w.pct != null ? `${w.pct}%` : ''}${w.location ? `, ${w.location}` : ''}${w.note ? `. ${w.note}` : ''}`)) : ''}
    ${f.milestones?.some(m => m.reached) ? list('Milestones reported as reached', f.milestones.filter(m => m.reached).map(m => `${task(m.taskId)?.name || 'Unknown milestone'}${m.note ? `. ${m.note}` : ''}`)) : ''}
    ${f.attendance?.length ? list(`Attendance, ${f.attendance.filter(a => a.state === 'present').length} of ${f.attendance.length} present`,
      f.attendance.map(a => `${a.name}: ${a.state || 'present'}${a.ot > 0 ? `, ${num(a.ot)} h overtime` : ''}`)) : ''}
    ${f.delayItems?.length ? list('Delays, for the claim record', f.delayItems.map(d => `${d.cause || 'Delay'}${d.party ? `, responsible: ${d.party}` : ''}: ${num(d.hours)} h${d.taskId ? ` on ${task(d.taskId)?.name || 'a task'}` : ''}${d.idlePeople ? `, ${d.idlePeople} people idle` : ''}${d.note ? `. ${d.note}` : ''}`)) : ''}
    ${f.received?.length ? list('Materials received', f.received.map(x => `${x.name}: ${num(x.qty)} ${x.unit || ''}${x.note ? `. ${x.note}` : ''}`)) : ''}
    ${list('Instructions from the client', f.instructions)}
    ${f.progress?.length ? list('Progress summary', f.progress) : empty('Progress summary')}
    ${(f.extra || []).map(x => list(x.activity, x.items))}
    ${list('Safety notes', f.safetyNotes)}
    ${list('Notes', f.notes)}
    ${f.plan?.length ? list('Next day schedule', f.plan) : empty('Next day schedule')}
    ${list('Requests', requests)}
    ${f.pdfId ? html`<span class="actions left"><a href="https://drive.google.com/file/d/${f.pdfId}/view" target="_blank" rel="noopener">Open the Field Report PDF</a>${locate(f)}</span>` : ''}
    ${r.source === 'field' ? replyBox(r, c) : ''}
  </div>`;
}

/** Opens the Drive folder that holds the report's PDF. A report that came before Field Report's script 7.26.0 does not know
 * its folder until the next check: Drive is then searched for the file's name instead. */
const locate = f => (f.folderId
  ? html`<a class="btn small" href="https://drive.google.com/drive/folders/${encodeURIComponent(f.folderId)}" target="_blank" rel="noopener" title="Opens the Drive folder of ${f.pdf || 'this report'}">Locate the file in Drive</a>`
  : f.pdf || f.pdfId ? html`<a class="btn small" href="https://drive.google.com/drive/search?q=${encodeURIComponent(f.pdf || f.pdfId)}" target="_blank" rel="noopener" title="Searches Google Drive for ${f.pdf || 'the file'}">Locate the file in Drive</a>` : '');

/** Status of a field report in the Field Report app, the conversation so far, and the reply to its preparer. */
function replyBox(r, c) {
  const f = r.field;
  const [label, cls] = FIELD_STATUS[f.status] || FIELD_STATUS.submitted;
  const send = (decision, text, primary) => html`<button class="btn small ${primary ? 'primary' : ''}" type="button" data-act="reply" data-id="${r.id}" data-d="${decision}" ${replying ? 'disabled' : ''}>${text}</button>`;
  return html`<div class="reply">
    <span><span class="muted">In Field Report</span> ${chip(label, cls)}${f.reviewedBy ? html` <span class="muted">by ${f.reviewedBy}</span>` : ''}</span>
    ${(f.comments || []).length ? html`<ul class="plain">${f.comments.map(x => html`<li><b>${x.by}</b> <span class="muted">${String(x.at || '').slice(0, 10)}</span> ${x.text}</li>`)}</ul>` : ''}
    ${c.role === 'site' ? '' : html`
      <textarea rows="2" placeholder="Message to ${r.by}: what to correct, or a comment" aria-label="Message to the person who prepared the report"></textarea>
      <div class="actions left">
        ${f.status === 'approved' ? send('reopen', 'Reopen for the site') : html`${send('changes', 'Send back for changes', true)}${send('approve', 'Approve')}`}
        ${send('comment', 'Comment only')}
        <span class="muted">${replyNotice}</span>
      </div>`}
  </div>`;
}

export function render(c) {
  const { ws, project } = c;
  const cur = underReview(ws);
  const tasks = reportable(c);
  const trades = tradeList(ws, cur);
  const crew = new Map((cur?.manpower || []).map(m => [m.trade, m]));
  const lead = ws.team.find(m => /site|engineer|foreman/i.test(m.role)) || ws.team[0];
  const reports = [...ws.reports].sort((a, b) => b.date.localeCompare(a.date));
  const pending = reports.filter(r => r.review === 'pending');
  const weather = cur?.weather && !WEATHER.includes(cur.weather) ? [cur.weather, ...WEATHER] : WEATHER;
  const last = reports.find(r => r.field?.hours?.start)?.field.hours || { start: '08:00', end: '17:00' };
  const equipment = [...knownEquipment(ws), ...Array(BLANK_EQUIPMENT_ROWS).fill('')];

  // quantities read from the site's text, offered as starting values
  const text = cur?.field ? [...(cur.field.progress || []), ...(cur.field.extra || []).flatMap(x => x.items || [])] : [];
  // What the site entered against a task is used exactly; text is only read for a quantity where it entered none.
  const reported = cur ? reportedByTask(cur.field, billingOf(project).hoursPerDay) : {};
  const suggested = cur ? { ...suggestQuantities(text, tasks.filter(t => t.qtyTotal)), ...reported } : {};
  const entry = id => cur?.entries.find(e => e.taskId === id);
  const cfg = fieldConfig.get();
  const back = sentBack && ws.reports.find(r => r.id === sentBack.id);
  const viewed = !cur && viewing ? ws.reports.find(r => r.id === viewing) : null;
  const open = cur || viewed;

  const formCard = html`
    <section class="card">
      <h2>${back ? `Field report, ${fmtDate(back.date)}` : cur ? `Confirm field report, ${fmtDate(cur.date)}` : 'Daily report'}</h2>
      ${back ? html`
        <div class="sent-back">
          <p><b>${sentBack.decision === 'changes' ? `Sent back to ${back.by} for changes.` : `Approved. ${back.by} has been notified.`}</b></p>
          ${sentBack.text ? html`<p class="muted">Your message: ${sentBack.text}</p>` : ''}
          <p class="muted">${sentBack.decision === 'changes'
            ? 'It stays in the list as "Sent back to site". When the corrected report is filed, it comes back here by itself within a minute.'
            : 'It is locked in Field Report. Its progress still needs confirming here: open it again with Review.'}</p>
          <button class="btn primary" type="button" data-act="goBack" data-fresh>Go back</button>
        </div>` : ''}
      <form data-form="report" class="form" ${back ? 'hidden' : ''}>
        ${cur ? sheet(cur, c) : ''}
        <div class="grid4">
          <label>Date <input type="date" name="date" value="${cur?.date || c.today}" max="${c.today}" required ${cur ? 'readonly' : ''}></label>
          <label>Prepared by <input name="by" list="team-names" value="${cur?.by || lead?.name || ''}" required>
            <datalist id="team-names">${ws.team.map(m => html`<option value="${m.name}"></option>`)}</datalist></label>
          ${cur ? '' : html`<label>Position <input name="position" value="${lead?.role || ''}"></label>`}
          <label>Weather <select name="weather">${options(weather.map(w => [w, w]), cur?.weather || 'Clear')}</select></label>
          ${cur ? '' : html`
            <label>Temperature, °C <input type="number" name="temp" step="any"></label>
            <label>Ground <select name="ground">${options(GROUND.map(g => [g, g]), 'Dry')}</select></label>
            <label>Work started <input type="time" name="start" value="${last.start}"></label>
            <label>Work finished <input type="time" name="end" value="${last.end}"></label>`}
        </div>

        ${cur ? '' : html`
          <h3>Safety</h3>
          <div class="grid3">
            <label>Incidents <select name="safety">${options(SAFETY.map(s => [s, s === 'None' ? 'No incidents or near misses' : s]), 'None')}</select></label>
            <label class="check"><input type="checkbox" name="toolbox" checked> Toolbox talk held</label>
            <label>Safety notes <input name="safetyNotes"></label>
          </div>

          <h3>Work delay, hours</h3>
          <div class="grid3">${DELAY_KINDS.map((k, i) => html`
            <label>${k} <input type="number" name="dl_${i}" min="0" step="any" placeholder="0"></label>`)}</div>`}

        <h3>${cur ? 'Progress on that day' : 'Progress against the schedule'}</h3>
        ${tasks.length ? html`
          <table class="table compact">
            <thead><tr><th>Task</th><th class="r">Done</th><th class="r">Delay (days)</th><th>Location, note or delay reason</th></tr></thead>
            <tbody>${tasks.map(r => html`
              <tr>
                <td>${r.name}${r.qtyTotal ? html`<span class="muted note">${num(r.qtyTotal - r.qtyDone)} of ${num(r.qtyTotal)} ${r.unit || ''} remaining</span>` : ''}</td>
                <td class="r nowrap">${r.qtyTotal
                  ? html`<input class="narrow" type="number" name="q_${r.id}" min="0" step="any" placeholder="0" value="${entry(r.id)?.qty || suggested[r.id]?.qty || ''}" title="Quantity installed that day" aria-label="Quantity installed, ${r.name}"> <span class="muted unit">${r.unit || ''}</span>`
                  : html`<input class="narrow" type="number" name="p_${r.id}" min="0" max="100" value="${reported[r.id]?.pct ?? r.progress}" title="Percent complete so far" aria-label="Percent done, ${r.name}"> <span class="muted unit">%</span>`}</td>
                <td class="r"><input class="narrow" type="number" name="d_${r.id}" min="0" step="any" value="${entry(r.id)?.delayDays || reported[r.id]?.delayDays || 0}" aria-label="Delay days, ${r.name}"></td>
                <td><input name="n_${r.id}" value="${entry(r.id)?.note || suggested[r.id]?.note || ''}" aria-label="Note, ${r.name}"></td>
              </tr>`)}</tbody>
          </table>` : html`<p class="empty">No open tasks to report on. Add tasks on the Schedule screen.</p>`}
        ${cur ? '' : html`<label>Progress summary, one item per line
          <textarea name="summary" rows="3" placeholder="e.g. Installed 25 pcs roof sheeting between Axis 04 and 08"></textarea></label>`}

        <h3>Manpower on site</h3>
        <div class="grid4">${trades.map((t, i) => html`
          <label>${t}
            <span class="pair">
              <input type="number" name="m_${i}" min="0" value="${crew.get(t)?.count || 0}" title="People on site" aria-label="${t}, people on site">
              <input type="number" name="o_${i}" min="0" step="any" placeholder="OT h" value="${crew.get(t)?.ot || ''}" title="Total overtime hours" aria-label="${t}, overtime hours">
            </span>
          </label>`)}</div>
        ${trades.length ? '' : html`<p class="muted">Add trades and their day rates under Settings, Labour day rates.</p>`}

        ${cur ? '' : html`
          <h3>Equipment</h3>
          <table class="table compact">
            <thead><tr><th>Equipment</th><th class="r">Qty</th><th class="r">Hours</th><th>Status</th></tr></thead>
            <tbody>${equipment.map((name, i) => html`
              <tr>
                <td><input name="en_${i}" value="${name}" placeholder="Equipment name" aria-label="Equipment name"></td>
                <td class="r"><input class="narrow" type="number" name="eq_${i}" min="0" placeholder="0" aria-label="Quantity"></td>
                <td class="r"><input class="narrow" type="number" name="eh_${i}" min="0" step="any" placeholder="0" aria-label="Hours"></td>
                <td><select name="es_${i}" aria-label="Status">${options(EQUIPMENT_STATUS.map(s => [s, s]), 'Active')}</select></td>
              </tr>`)}</tbody>
          </table>

          <label>Notes, one per line <textarea name="notes" rows="2"></textarea></label>
          <label>Next day schedule, one activity per line <textarea name="plan" rows="2"></textarea></label>
          <div class="request">
            <label>Site request or issue (opens a follow-up automatically)
              <input name="issue" placeholder="e.g. Need second mobile crane from Thursday"></label>
            <label>Priority <select name="priority"><option>Normal</option><option>Urgent</option></select></label>
          </div>`}

        <div class="actions left">
          <button class="btn primary">${cur ? 'Confirm report' : 'Submit report'}</button>
          <button class="btn ghost" type="button" data-fresh data-act="${cur ? 'cancelReview' : 'clearForm'}" title="${cur ? 'Leave this report unconfirmed' : 'Clear everything typed in this form'}">Cancel</button>
          <span class="muted">${notice}</span>
        </div>
      </form>
    </section>`;

  const fieldCard = c.role === 'site' ? '' : html`
    <section class="card">
      <div class="toolbar">
        <h2>From Field Report</h2><span class="grow"></span>
        <span class="muted" id="fr-checked">${autoLine(project, cfg)}</span>
        <button class="btn" data-act="pull" ${busy ? 'disabled' : ''}>${busy ? 'Getting reports…' : 'Check now'}</button>
      </div>
      ${fieldNotice ? html`<p class="muted">${fieldNotice}</p>` : ''}
      ${pending.length ? html`<ul class="list">${pending.map(r => html`
        <li class="row">
          <span class="row-main">
            <span><b>${fmtDate(r.date)}</b> ${r.field?.status === 'changes' ? chip('Sent back to site', 'high') : chip('To confirm', 'warn')}</span>
            <span class="muted">${r.field?.nowork ? `No work: ${r.field.reason}` : `${r.by}, ${sum(r.manpower || [], m => m.count)} on site, report No. ${r.field?.no || ''}`}</span>
          </span>
          <button class="btn small ${r.id === reviewing ? '' : 'primary'}" data-act="review" data-fresh data-id="${r.id}">Review</button>
        </li>`)}</ul>` : ''}
      ${connected(project) ? '' : html`<p class="muted">Not connected to Field Report yet. Set it up under <a href="#links">Settings, Field Report and import</a>.</p>`}
    </section>`;

  const pick = periodChoices(reports.map(r => r.date), period);
  const shown = reports.filter(r => inPeriod(r.date, period));
  const listCard = html`
    <section class="card">
      <div class="toolbar">
        <h2>Submitted reports</h2><span class="muted">${shown.length === reports.length ? reports.length : `${shown.length} of ${reports.length}`}</span><span class="grow"></span>
        <select data-chg="period" data-f="year" aria-label="Year"><option value="0">Every year</option>${options(pick.years.map(y => [y, String(y)]), period.year)}</select>
        <select data-chg="period" data-f="month" aria-label="Month"><option value="0">Every month</option>${options(pick.months.map(m => [m, monthName(m)]), period.month)}</select>
        <select data-chg="period" data-f="week" aria-label="Week"><option value="0">Every week</option>${options(pick.weeks.map(w => [w, `Week ${w}`]), period.week)}</select>
      </div>
      ${shown.length ? html`<ul class="list">${shown.map(r => html`
        <li class="stack">
          <div class="row top">
            <span class="row-main">
              <span><b>${fmtDate(r.date)}</b> ${r.field?.no ? html`<span class="muted">No. ${r.field.no}</span>` : ''} ${r.source === 'field' ? chip('Field Report', 'info') : ''} ${r.review === 'pending' ? chip('To confirm', 'warn') : ''}</span>
              <span class="muted">${r.field?.nowork ? `No work: ${r.field.reason}`
                : `${r.by}${r.weather ? `, ${r.weather}` : ''}, ${sum(r.manpower || [], m => m.count)} on site, ${r.entries?.length || 0} task${r.entries?.length === 1 ? '' : 's'} updated`}</span>
            </span>
            <button class="btn small" data-act="openReport" data-fresh data-id="${r.id}" title="Read it with its PDF on top and the history beside it">Open</button>
            <button class="btn ghost small" data-act="toggle" data-id="${r.id}">${expanded.has(r.id) ? 'Hide' : 'Show all'}</button>
            <button class="btn ghost small" data-act="remove" data-id="${r.id}" title="Delete report and re-sync the schedule">Delete</button>
          </div>
          ${expanded.has(r.id) ? sheet(r, c) : ''}
        </li>`)}</ul>` : html`<p class="empty">${reports.length ? 'No reports in this period.' : 'No reports yet.'}</p>`}
      ${binBody(c)}
    </section>`;

  // Reading a report: its PDF on top, then the details or the form to confirm it, and the history beside it.
  if (open) {
    return html`
      <div class="rv">
        <div class="rv-main">
          ${pdfCard(open)}
          ${cur ? formCard : readCard(open, c)}
          ${store.isAdmin ? html`<section class="card">${binBody(c)}</section>` : ''}
        </div>
        <aside class="card rv-side" aria-label="History of reports">${historyList(reports, open.id)}</aside>
      </div>`;
  }
  const now = tab || (c.role === 'site' ? 'enter' : 'list');
  const tabs = [['list', 'Reports', pending.length], ['enter', 'Daily report']];
  // one column: Field Report first, then the tabs
  return html`<div class="side">${fieldCard}
    <div class="emp-tabs set-tabs" role="tablist">${tabs.map(([k, label, n]) => html`
      <button type="button" role="tab" class="tab ${now === k ? 'on' : ''}" data-act="repTab" data-t="${k}" aria-selected="${now === k ? 'true' : 'false'}">${label}${n ? html` <span class="badge">${n}</span>` : ''}</button>`)}</div>
    ${now === 'enter' || back ? formCard : listCard}</div>`;
}

/** The report's own PDF, shown from Google Drive. */
function pdfCard(r) {
  const f = r.field || {};
  if (f.nowork) return html`<section class="card"><h3>No work this day</h3><p class="muted">${f.reason || ''}${f.note ? ` (${f.note})` : ''}</p></section>`;
  if (!f.pdfId) {
    return html`<section class="card"><h3>Report PDF</h3><p class="muted">${r.source === 'field' ? 'No PDF came with this report.' : 'This report was typed in Central Hub, so there is no Field Report PDF.'}</p></section>`;
  }
  return html`<section class="card">
    <div class="toolbar"><h3>Field Report PDF, ${fmtDate(r.date)}</h3><span class="grow"></span>
      <a class="btn small" href="https://drive.google.com/file/d/${f.pdfId}/view" target="_blank" rel="noopener">Open in Drive</a>${locate(f)}</div>
    <iframe class="rv-pdf" src="https://drive.google.com/file/d/${f.pdfId}/preview" title="Field Report PDF of ${fmtDate(r.date)}" loading="lazy"></iframe>
    <p class="muted">Shown through Google Drive: you need to be signed in to Google with access to the file.</p>
  </section>`;
}

/** A report that needs no confirming, read in full. */
function readCard(r, c) {
  return html`<section class="card">
    <div class="toolbar"><h2>Field report, ${fmtDate(r.date)}</h2>${r.field?.no ? html`<span class="muted">No. ${r.field.no}</span>` : ''}<span class="grow"></span>
      <button class="btn ghost small" data-act="remove" data-id="${r.id}" title="Moves it to the recycle bin for ${RETENTION_DAYS} days">Delete</button></div>
    ${sheet(r, c)}
  </section>`;
}

/** Every report of the project, newest first, to move between them. */
function historyList(reports, activeId) {
  return html`
    <div class="toolbar"><h3>History</h3><span class="grow"></span><button class="btn small" data-act="closeView" data-fresh>Close</button></div>
    <ul class="timeline">${reports.map(r => {
      const [label, cls] = FIELD_STATUS[r.field?.status] || [];
      return html`<li class="${r.id === activeId ? 'on' : ''}"><button type="button" class="link tl" data-act="openReport" data-fresh data-id="${r.id}">
        <span><b>${fmtDate(r.date)}</b> ${r.review === 'pending' ? chip('To confirm', 'warn') : ''}${r.field?.nowork ? chip('No work') : label && r.source === 'field' ? chip(label, cls) : ''}</span>
        <span class="muted">${r.field?.nowork ? r.field.reason || '' : `${r.by}, ${sum(r.manpower || [], m => m.count)} on site`}</span></button></li>`;
    })}</ul>`;
}

/** Deleted reports, kept 30 days: the Admin restores them or removes them for good. */
function binBody(c) {
  if (!store.isAdmin) return '';
  const items = inBin(c.ws);
  return html`<div id="recycle-bin" class="bin">
    <div class="toolbar"><h2>Recycle bin</h2><span class="muted">${binNotice || (items.length ? `${items.length} deleted. Each is removed for good ${RETENTION_DAYS} days after it was deleted.` : '')}</span></div>
    ${items.length ? html`<table class="table compact">
      <thead><tr><th>Report</th><th>Deleted</th><th>By</th><th class="r">Days left</th><th></th></tr></thead>
      <tbody>${items.map(t => html`<tr>
        <td><b>${fmtDate(t.record.date)}</b> <span class="muted">${t.record.field?.nowork ? `No work: ${t.record.field.reason || ''}` : `${t.record.by}, ${t.record.field?.no ? `No. ${t.record.field.no}` : ''}`}</span>${t.items?.length ? html`<span class="muted note">${t.items.length} follow-up${t.items.length === 1 ? '' : 's'} with it</span>` : ''}</td>
        <td class="nowrap">${fmtDate(t.deletedAt.slice(0, 10))}</td><td>${t.byName || t.by}</td>
        <td class="r ${daysLeft(t) <= 3 ? 'bad' : ''}">${daysLeft(t)}</td>
        <td class="r nowrap"><button class="btn small primary" data-act="restoreReport" data-id="${t.id}">Restore</button>
          <button class="btn ghost small" data-act="removeForGood" data-id="${t.id}">Delete permanently</button></td></tr>`)}</tbody>
    </table>` : html`<p class="muted">Empty. A deleted report waits here for ${RETENTION_DAYS} days before it is removed for good.</p>`}
  </div>`;
}

/** The first time the page opens, clear what has been in the bin too long. Only the Admin can delete, so only the Admin does. */
export function onEnter() {
  const ws = store.ws;
  if (!store.isAdmin || !ws.trash?.some(t => isExpired(t) || ws.reports.some(r => r.id === t.record?.id))) return;
  store.update(w => { purge(w); });
}

export const submits = {
  report(fd, c) {
    const cur = underReview(c.ws);
    const date = cur?.date || fd.get('date') || c.today;
    const by = fd.get('by').trim();
    const entries = [];
    for (const r of reportable(c)) {
      const delayDays = Math.max(0, +fd.get('d_' + r.id) || 0);
      const note = (fd.get('n_' + r.id) || '').trim();
      if (r.qtyTotal) {
        // volume-tracked: the site reports units installed and the percentage follows
        const qty = Math.max(0, +fd.get('q_' + r.id) || 0);
        if (qty || delayDays) entries.push({ taskId: r.id, progress: null, qty, delayDays, note });
        else if (note && !cur) entries.push({ taskId: r.id, progress: null, qty: 0, delayDays, note });
        continue;
      }
      const raw = fd.get('p_' + r.id);
      const progress = raw === '' || raw == null ? null : clamp(Math.round(+raw), 0, 100);
      const changed = progress != null && progress !== r.progress;
      if (changed || delayDays || note) entries.push({ taskId: r.id, progress: changed ? progress : null, delayDays, note });
    }
    const manpower = tradeList(c.ws, cur)
      .map((trade, i) => ({ trade, count: Math.max(0, +fd.get('m_' + i) || 0), ot: Math.max(0, +fd.get('o_' + i) || 0) }))
      .filter(m => m.count > 0 || m.ot > 0);

    if (cur) {
      // the site's own entries stay as written; the Office adds the progress and may correct the crew
      const hrs = new Map((cur.manpower || []).map(m => [m.trade, m.hrs]));
      store.update(ws => Object.assign(underReview(ws), {
        by, weather: fd.get('weather'), entries, review: 'done',
        manpower: manpower.map(m => (hrs.get(m.trade) != null && m.ot === cur.manpower.find(x => x.trade === m.trade)?.ot ? { ...m, hrs: hrs.get(m.trade) } : m)),
      }));
      reviewing = null;
      notice = `Field report for ${fmtDate(date)} confirmed. The schedule is updated.`;
      return;
    }

    const issue = fd.get('issue').trim();
    const urgent = fd.get('priority') === 'Urgent';
    const equipment = [];
    for (let i = 0; fd.has('en_' + i); i++) {
      const name = fd.get('en_' + i).trim();
      const qty = Math.max(0, +fd.get('eq_' + i) || 0);
      if (name && qty) equipment.push({ name, qty, hrs: Math.max(0, +fd.get('eh_' + i) || 0), status: fd.get('es_' + i) });
    }
    const field = {
      v: FIELD_SCHEMA, position: fd.get('position').trim(),
      hours: { start: fd.get('start'), end: fd.get('end') },
      tempC: fd.get('temp') === '' ? null : +fd.get('temp'), ground: fd.get('ground'),
      safety: fd.get('safety'), toolbox: fd.has('toolbox'), safetyNotes: lines(fd.get('safetyNotes')),
      delays: DELAY_KINDS.map((k, i) => ({ k, h: Math.max(0, +fd.get('dl_' + i) || 0) })).filter(d => d.h > 0),
      equipment, progress: lines(fd.get('summary')), extra: [], notes: lines(fd.get('notes')), plan: lines(fd.get('plan')),
      requests: issue ? [{ priority: urgent ? 'Urgent' : 'Normal', text: issue }] : [],
    };
    const said = entries.length || manpower.length || issue || equipment.length || field.delays.length
      || field.progress.length || field.notes.length || field.plan.length || field.safetyNotes.length || field.safety !== 'None';
    if (!said) {
      notice = 'Nothing to submit: enter at least progress, manpower, equipment or a note.';
      return false;
    }
    // a second report for the same day adds its quantities and manpower to the first
    const sameDay = c.ws.reports.filter(r => r.date === date && !r.field?.nowork).length;
    if (sameDay && !confirm(`There is already a report for ${fmtDate(date)}.\n\nSave this one as well? Its quantities and manpower are added to the day's totals.`)) {
      notice = 'Not saved.';
      return false;
    }
    store.update(ws => {
      ws.reports.push({ id: uid('r'), date, by, weather: fd.get('weather'), manpower, entries, issue, field });
      if (issue) {
        ws.items.push({
          id: uid('i'), type: 'site_request', title: urgent ? `URGENT: ${issue}` : issue, owner: by, created: date,
          due: urgent ? date : fromDay(toDay(date) + 3), status: 'open', remindEvery: urgent ? 1 : 2,
        });
      }
    });
    notice = `Report for ${fmtDate(date)} saved. Schedule, ledger and follow-ups are updated.`;
  },
};

export const changes = {
  /** Year, month or week of the reports listed. A wider choice clears the narrower ones under it. */
  period(el) {
    period[el.dataset.f] = +el.value || 0;
    if (el.dataset.f === 'year') { period.month = 0; period.week = 0; }
    if (el.dataset.f === 'month') period.week = 0;
  },
};

export const actions = {
  remove(el, c) {
    const r = c.ws.reports.find(x => x.id === el.dataset.id);
    if (!r) return;
    const again = r.source === 'field' && connected(c.project) ? '\n\nIt came from Field Report, so the next check brings it back as a report to confirm.' : '';
    if (!confirm(`Delete the report of ${fmtDate(r.date)}? Its progress, manpower and labour cost are taken out of the schedule and costs.\n\nIt goes to the recycle bin for ${RETENTION_DAYS} days. Restore it from there if you change your mind.${again}`)) return;
    const who = { by: store.user?.email || '', byName: store.profile.name || store.user?.name || 'Admin' };
    store.update(ws => { ws.trash.push(toTrash(r, ws, who)); ws.reports = ws.reports.filter(x => x.id !== r.id); });
    if (viewing === r.id) viewing = null;
    if (reviewing === r.id) reviewing = null;
    notice = '';
    binNotice = `Report of ${fmtDate(r.date)} moved to the recycle bin.`;
  },
  toggle(el) { if (!expanded.delete(el.dataset.id)) expanded.add(el.dataset.id); },
  review(el) { reviewing = el.dataset.id; viewing = null; sentBack = null; notice = ''; replyNotice = ''; },
  /** From a list or the history: a report that needs confirming opens for review, any other opens for reading. */
  openReport(el, c) {
    const r = c.ws.reports.find(x => x.id === el.dataset.id);
    if (!r) return;
    sentBack = null; notice = ''; replyNotice = '';
    if (r.review === 'pending') { reviewing = r.id; viewing = null; } else { reviewing = null; viewing = r.id; }
  },
  closeView() { reviewing = null; viewing = null; sentBack = null; notice = ''; },
  restoreReport(el, c) {
    let result = { ok: false, message: '' };
    store.update(ws => { result = restoreTrash(ws, el.dataset.id); });
    binNotice = result.message;
  },
  /** Admin only: the name starts with "remove", which the shell already reserves for the Admin. */
  removeForGood(el, c) {
    const t = c.ws.trash.find(x => x.id === el.dataset.id);
    if (!t || !confirm(`Delete the report of ${fmtDate(t.record.date)} permanently? It cannot be brought back.`)) return;
    store.update(ws => { ws.trash = ws.trash.filter(x => x.id !== t.id); });
    binNotice = 'Deleted permanently.';
  },
  cancelReview() { reviewing = null; notice = ''; },
  goBack() { if (sentBack?.decision === 'changes') reviewing = null; sentBack = null; replyNotice = ''; },
  /** Discard what was typed: the form is redrawn with its starting values. */
  clearForm() { notice = 'Form cleared. Nothing was saved.'; },
  repTab(el) { tab = el.dataset.t; },

  /** Send approve / changes / comment / reopen to the preparer through the Field Report receiver. */
  async reply(el, c) {
    if (replying) return;
    const decision = el.dataset.d;
    const text = el.closest('.reply').querySelector('textarea').value.trim();
    if ((decision === 'changes' || decision === 'comment') && !text) { replyNotice = 'Write the message first.'; return; }
    const projectId = c.project.id;
    const id = el.dataset.id;
    const report = c.ws.reports.find(r => r.id === id);
    replying = true;
    replyNotice = 'Sending…';
    try {
      const view = await reviewFieldReport({ name: report.field.pdf, decision, text });
      if (store.project.id !== projectId) throw new Error('The project was switched before the reply was recorded here. It was sent.');
      store.update(ws => {
        const rec = ws.reports.find(r => r.id === id);
        rec.field = { ...rec.field, status: view.status, comments: view.comments || [], reviewedBy: view.reviewedBy || '' };
      });
      replyNotice = REPLY_DONE[decision];
      // a verdict given from the review closes the review: the form gives way to a short confirmation
      if (reviewing === id && (decision === 'changes' || decision === 'approve')) {
        sentBack = { id, decision, text };
        if (decision === 'changes') reviewing = null;
      }
    } catch (err) {
      replyNotice = `Not sent: ${err.message}`;
    }
    replying = false;
    store.notify();
  },

  /** Fetch new and re-submitted reports from the Field Report receiver into this project. */
  pull() { return pullReports(false); },
  toFieldSetup() { openPanel('field'); },
};

const autoReady = (project, cfg) => !!(cfg.url && cfg.key && project?.fieldCode && project.fieldLabel);
const autoLine = (project, cfg) => !autoReady(project, cfg) ? ''
  : checkedAt ? `Checks every few seconds while this page is open, last at ${checkedAt}` : 'Checks every few seconds while this page is open';

/**
 * The automatic check, run by the shell once a minute. It only works once the
 * connection is set and the first pull has been confirmed by hand, and it
 * redraws the page only when something arrived.
 */
export async function autoPull(openOnly = false) {
  if (store.role === 'site' || store.loading || !store.project) return;
  const cfg = fieldConfig.get();
  if (autoReady(store.project, cfg)) await pullReports(true);
  // the other projects are looked at once a minute, not on the quick check of the open page
  if (!openOnly && store.seesMoney) await watchOthers(cfg);
}

// ---- the connected projects that are not open ----
// Their field reports are imported in the background too, so the red number on the project in
// the sidebar shows there is something to confirm. What the receiver last answered is remembered
// in this browser, and the project's data is only read when that answer changes.

let watching = false;
const markKey = id => `sf:frmark:${id}`;
const readMark = id => { try { return JSON.parse(localStorage.getItem(markKey(id))) || {}; } catch { return {}; } };
const fingerprint = (out, since) => JSON.stringify([
  (out.reports || []).filter(m => m.date >= since).map(m => [m.date, m.version || 1, m.status || '', (m.comments || []).length]),
  (out.nowork || []).filter(n => n.date >= since).map(n => n.date),
  (out.attendance || []).map(a => [a.date, a.at]),
]);

async function watchOthers(cfg) {
  if (watching) return;
  watching = true;
  for (const project of store.projects) {
    if (project.id === store.project.id || !autoReady(project, cfg)) continue;
    try { await pullOther(project); } catch { /* the error is shown when that project is opened */ }
  }
  watching = false;
}

async function pullOther(project) {
  const mark = readMark(project.id);
  const out = await fetchFieldReports({ proj: project.fieldCode, since: mark.since || '' });
  // the code now points somewhere else: left for the person to confirm with the project open
  if (out.project !== project.fieldLabel) return;
  if (mark.print && fingerprint(out, mark.since || '') === mark.print) return;

  let result;
  const ws = await store.updateOther(project.id, w => { result = importFieldReports(w, out, { hoursPerDay: billingOf(project).hoursPerDay }); });
  const since = importSince(ws);
  try { localStorage.setItem(markKey(project.id), JSON.stringify({ since, print: fingerprint(out, since) })); } catch { /* checked in full again next time */ }
  if (result.added || result.updated) {
    // its sidebar figures and alerts are worked out here, because nobody has it open
    store.patchProject(project.id, { summary: summaryOf(derive(project, ws, store.global, todayISO())) });
  }
}

/** Send the project's lists to Field Report again, quietly, when something that changes them came in (a no-work day). */
async function resendSetup() {
  const project = store.project;
  if (!project.fieldCode || !project.fieldSetupAt) return;
  try {
    const c = derive(project, store.ws, store.global, todayISO());
    await sendSetup(buildSetup({ ...c, people: store.users }, todayISO()));
    store.updateProject(p => { p.fieldSetupAt = todayISO(); });
  } catch (err) { console.warn('The lists could not be sent again:', err.message); }
}

async function pullReports(quiet) {
  if (busy) return;
  busy = true;
  if (!quiet) { fieldNotice = ''; autoFailed = false; }
  const project = store.project;
  let changed = !quiet;
  try {
    // the automatic check re-reads the last few days; "Check now" looks a month back for late or corrected reports
    const out = await fetchFieldReports({ proj: project.fieldCode, since: importSince(store.ws, quiet ? undefined : DEEP_OVERLAP_DAYS) });
    if (store.project.id !== project.id) throw new Error('The project was switched while reports were loading. Try again.');
    // The code decides whose reports arrive, so the first pull names both sides and asks.
    if (project.fieldLabel !== out.project) {
      if (quiet) throw new Error(`Field Report code ${out.proj} now points to "${out.project}". Click "Check now" to confirm.`);
      const count = (out.reports || []).length + (out.nowork || []).length;
      if (!confirm(`Field Report code ${out.proj} is "${out.project}".

Import its ${count} report(s) into the Central Hub project "${project.name}"?`)) {
        throw new Error('Nothing imported. Open the right project, or change the code under Settings.');
      }
      store.updateProject(p => { p.fieldLabel = out.project; });
    }
    // the calendar Field Report holds: its non-working dates are added to the project's, its weekly off days are only compared
    const cal = mergeCalendar(project, out);
    if (cal.added.length) store.updateProject(p => { p.nonWorking = cal.nonWorking; });
    const weeklyNote = cal.weeklyDiffers
      ? ` Field Report has ${cal.theirs.length ? cal.theirs.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : 'no weekday'} as weekly off days, this project has ${weeklyOff(project).map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || 'none'}. Change the working week under Settings if Field Report is right.` : '';
    const noworkBefore = store.ws.reports.filter(r => r.field?.nowork).length;
    // a dry run on a copy first, so a check that brings nothing does not write to the database
    const hoursPerDay = billingOf(project).hoursPerDay;
    const result = importFieldReports(structuredClone(store.ws), out, { hoursPerDay });
    if (result.added || result.updated) {
      store.update(ws => { importFieldReports(ws, out, { hoursPerDay }); });
      fieldNotice = `${result.added} new and ${result.updated - (result.attendance || 0)} updated from ${out.project}. Review each one to count its progress.`;
      if (result.attendance) fieldNotice += ` ${result.attendance} attendance mark(s) corrected by the site are on the Attendance sheet.`;
      if (out.more) fieldNotice += ' Older reports were left out.';
      fieldNotice += weeklyNote;
      changed = true;
      // a new no-work day moves the target date: Field Report gets the lists again by itself
      if (store.ws.reports.filter(r => r.field?.nowork).length > noworkBefore) resendSetup();
    } else if (!quiet) {
      fieldNotice = `No new reports.${weeklyNote}`;
    } else if (autoFailed) {
      // an earlier automatic check failed and this one worked: take the error off the screen
      fieldNotice = '';
      changed = true;
    }
    autoFailed = false;
    checkedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (err) {
    // a failed automatic check is shown once, not redrawn every minute
    if (fieldNotice !== err.message) changed = true;
    fieldNotice = err.message;
    autoFailed = quiet;
  }
  busy = false;
  if (changed) store.notify();
  else {
    const el = document.getElementById('fr-checked');
    if (el) el.textContent = autoLine(store.project, fieldConfig.get());
  }
}
