// v1.82.0 (S2): the tools of a missing day, shared by Needs attention (the Dashboard page, loaded when opened) and Review.
import { store } from '../core/store.js';
import { fmtDate } from '../core/util.js';
import { html } from './dom.js';
import { markDayOff, markNoAct, reqListFR, requestReport } from '../sync/fieldreport.js';

// v1.73.0 (owner, 18 Nov): Request report on a missing day (Field Report script 7.70.0): the requests and engineers of a project
const frReq = {};   // Field Report code -> { reqs, engineers, at, busy }
const hm = iso => { const d = new Date(iso); return iso && !Number.isNaN(+d) ? d.toTimeString().slice(0, 5) : ''; };
/** The status line of a request: "Requested 10:20 to Abebe by Tes · Seen 11:05 · due ...", "Submitted", "cancelled". */
export function reqLine(r) {
  if (!r || !r.at) return '';
  if (r.sub) return `Requested ${hm(r.at)} · Submitted ${hm(r.sub)}`;
  if (r.cx) return `Request cancelled ${hm(r.cx)}`;
  return `Requested ${hm(r.at)}${r.toName ? ` to ${r.toName}` : ''} by ${r.by}${r.seen ? ` · Seen ${hm(r.seen)}` : ' · Not seen yet'} · due ${String(r.due || '').replace('T', ' ')}`;
}
/** One request every 4 hours (the script refuses sooner too): '' or the time it may go again. */
export const reqWait = (r, now = Date.now()) => (r && r.at && !r.sub && Date.parse(r.at) + 4 * 3600e3 > now ? hm(new Date(Date.parse(r.at) + 4 * 3600e3).toISOString()) : '');
const reqOpenFR = r => !!r && !r.sub && !r.cx;
function loadReqs(code, force) {
  const k = frReq[code];
  if (!code || (k && (k.busy || (!force && Date.now() - k.at < 5 * 60e3)))) return;
  frReq[code] = { ...(k || { reqs: {}, engineers: [] }), busy: true };
  reqListFR(code).then(o => { frReq[code] = { reqs: o.reqs || {}, engineers: o.engineers || [], at: Date.now() }; paintReqs(code); })
    .catch(() => { frReq[code] = { reqs: {}, engineers: [], at: Date.now() }; });
}
/** Fills the request lines and the "Send to" lists in the page once Field Report answered. */
function paintReqs(code) {
  const k = frReq[code];
  document.querySelectorAll(`[data-frreq][data-code="${code}"]`).forEach(el => { el.textContent = reqLine(k.reqs[el.dataset.frreq]) || 'Not requested yet'; });
  document.querySelectorAll(`select[data-req-to][data-code="${code}"]`).forEach(sel => {
    sel.replaceChildren(...k.engineers.map((e, i) => Object.assign(document.createElement('option'), { value: e.id, textContent: `${e.name}${i === 0 && e.n ? ' (usually reports)' : ''}` })));
  });
}

const DAYOFF_KINDS = ['Holiday', 'Weather', 'Client stop', 'Other'];   // = Field Report script 7.68.0

/** v1.73.0: the Request report row under "Daily report missing" (the GM and the approvers). */
function reqRow(code, day, today) {
  const k = frReq[code]; loadReqs(code);
  const r = k?.reqs?.[day], wait = reqWait(r), eng = k?.engineers || [];
  return html`<span class="toolbar">
    <span class="muted" data-frreq="${day}" data-code="${code}">${k && !k.busy ? reqLine(r) || 'Not requested yet' : 'Checking requests…'}</span>
    <select aria-label="Send to" data-req-to data-code="${code}">${eng.length ? eng.map((e, i) => html`<option value="${e.id}">${e.name}${i === 0 && e.n ? ' (usually reports)' : ''}</option>`) : html`<option value="">The usual site engineer</option>`}</select>
    <input data-req-note maxlength="200" placeholder="Note (optional)" aria-label="Note">
    <input type="datetime-local" data-req-due value="${today}T23:59" aria-label="Due">
    <button class="btn small" data-act="reqReport" data-day="${day}" ${wait ? `disabled title="One request every 4 hours: again after ${wait}"` : ''}>Request report</button>
    ${reqOpenFR(r) ? html`<button class="btn small ghost" data-act="reqCancel" data-day="${day}">Cancel request</button>` : ''}</span>`;
}

/** v1.82.0 (B4): the tools of a missing day (day-off, No activity, Request report): Needs attention and Review use the same. */
export function missTools(c, day) {
  const p = c.project;
  if (!p.fieldCode || !store.canApprove || store.readOnly) return '';
  return html`<span class="toolbar">
          <select aria-label="Reason for the day off" data-dayoff-k>${DAYOFF_KINDS.map(k => html`<option>${k}</option>`)}</select>
          <button class="btn small" data-act="dayOff" data-day="${day}">Mark ${fmtDate(day)} as day-off</button></span>
          <span class="toolbar"><input aria-label="Reason for No activity" maxlength="120" placeholder="Reason for No activity (required)" data-na-why>
          <button class="btn small" data-act="noAct" data-day="${day}">⏸ Mark ${fmtDate(day)} No activity</button></span>${reqRow(p.fieldCode, day, c.today)}`;
}

export const missActions = {
  /** v1.71.0 (owner, 17 Nov): the GM or the PE marks the missing day as a day off in Field Report; the calendar adds it. */
  /** v1.73.0 (owner, 18 Nov): ask the site engineer for the missing day's report (push + pop-up on his phone). */
  async reqReport(el, c) {
    const li = el.closest('li'), code = c.project.fieldCode;
    el.disabled = true;
    try {
      const out = await requestReport({ proj: code, date: el.dataset.day, to: li?.querySelector('[data-req-to]')?.value, note: li?.querySelector('[data-req-note]')?.value, due: li?.querySelector('[data-req-due]')?.value });
      frReq[code] = { ...(frReq[code] || { engineers: [] }), reqs: out.reqs || {}, at: Date.now(), busy: false };
      paintReqs(code);
      alert(`Requested from ${out.req?.toName || 'the site engineer'}. It pops up on his phone until the report is sent.`);
    } catch (e) { el.disabled = false; alert(`Not sent: ${e.message}`); }
  },
  async reqCancel(el, c) {
    if (!confirm('Cancel this report request?')) return;
    const code = c.project.fieldCode;
    try { const out = await requestReport({ proj: code, date: el.dataset.day, cancel: true }); frReq[code] = { ...(frReq[code] || { engineers: [] }), reqs: out.reqs || {}, at: Date.now(), busy: false }; paintReqs(code); el.remove(); }
    catch (e) { alert(`Not cancelled: ${e.message}`); }
  },
  // v1.75.0 (owner, 19 Nov): No activity: a working day (keeps its report number), not missing, a reason required
  async noAct(el, c) {
    const day = el.dataset.day, why = (el.closest('li')?.querySelector('[data-na-why]')?.value || '').trim();
    if (!why) { alert('Write the reason for No activity first.'); return; }
    el.disabled = true;
    try { const out = await markNoAct({ proj: c.project.fieldCode, date: day, why }); store.updateProject(p => { p.noAct = out.noAct || {}; }); }
    catch (e) { el.disabled = false; alert(`Not marked: ${e.message}`); }
  },
  async dayOff(el, c) {
    const day = el.dataset.day, k = el.closest('li')?.querySelector('[data-dayoff-k]')?.value || 'Holiday';
    if (!confirm(`Mark ${fmtDate(day)} as a day off (${k}) for ${c.project.name}? No report is then needed for that day.`)) return;
    el.disabled = true;
    try {
      await markDayOff({ proj: c.project.fieldCode, date: day, k, by: store.user?.name || '' });
      store.updateProject(p => { p.nonWorking = [...new Set([...(p.nonWorking || []), day])].sort(); });
    } catch (e) { el.disabled = false; alert(`Not marked: ${e.message}`); }
  },
};
