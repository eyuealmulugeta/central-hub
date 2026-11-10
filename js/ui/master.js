// v1.48.0 (owner, 10 Nov, M1–M4): the Master page. The whole company on one read-only page for the Admin, the GM and
// the Executive: every project's progress, days behind, last report, reports waiting and crew today (M1); contract,
// invoiced, paid and cash this month, and the open trading deals (M2), with no one's pay; and what needs someone
// today (M3). Phone and desktop (M4). Figures come from engine/master.js.
import { store } from '../core/store.js';
import { money, fmtDate } from '../core/util.js';
import { html } from './dom.js';
import { masterView } from '../engine/master.js';
import { dealTotals as dealPrice } from '../engine/deals.js';
import { summaryOf } from './seen.js';

let backup = null, asked = false;
function loadBackup() {
  asked = true;
  store.serverBackup().then(b => { backup = b || {}; store.notify(); }).catch(() => { backup = {}; store.notify(); });
}

const pct = v => (v == null ? '—' : `${Math.round(v)}%`);
const ago = n => (n == null ? 'none yet' : n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const bar = v => html`<span class="ms-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, Math.round(v || 0)))}%"></i></span>`;

export function render(c) {
  if (!asked) loadBackup();
  const cur = c.global?.fx?.base || 'USD';
  // the open project: today's figures, not the last saved ones
  let open = null; try { open = c.sched && c.project ? summaryOf(c) : null; } catch { open = null; }
  const projects = (store.projects || []).map(p => (open && p.id === c.project.id ? { ...p, summary: { ...(p.summary || {}), ...open, money: store.seesPay ? open.money : p.summary?.money } } : p));
  const v = masterView({ projects, contracts: c.company?.contracts || [], deals: c.company?.deals || [], backup, fx: c.global?.fx, currency: cur, today: c.today, priceOf: d => dealPrice(d).price || 0 });
  const m = v.money, high = v.alerts.filter(a => a.sev === 'high').length;
  const tile = (label, value, sub = '', tone = '') => html`<div class="ms-tile ${tone}"><span>${label}</span><b>${value}</b>${sub ? html`<small>${sub}</small>` : ''}</div>`;
  return html`<section class="card wide ms">
    <div class="toolbar"><h2>Master</h2><span class="muted">Read only · ${fmtDate(c.today)}</span></div>
    <div class="ms-tiles">
      ${tile('Live projects', v.rows.length, `${v.rows.filter(r => r.behind >= 5).length} behind plan`)}
      ${tile('Crew on site today', v.crew, 'from today\'s reports')}
      ${tile('Needs attention', v.alerts.length, high ? `${high} urgent` : 'nothing urgent', high ? 'bad' : '')}
      ${tile('Open deals', v.trade.open, money(v.trade.value, cur))}
    </div>

    <h3 class="ms-h">Projects</h3>
    ${v.rows.length ? html`<div class="ms-scroll"><table class="ms-table">
      <thead><tr><th>Project</th><th>Progress</th><th>Behind</th><th>Last report</th><th>Waiting</th><th>Crew today</th></tr></thead>
      <tbody>${v.rows.map(r => html`<tr>
        <td data-l="Project"><button type="button" class="ms-link" data-act="openProject" data-id="${r.id}" data-to="dashboard">${r.name}</button>${r.code ? html` <small class="muted">${r.code}</small>` : ''}</td>
        <td data-l="Progress">${bar(r.progress)} ${pct(r.progress)}${r.basis === 'billed' ? html` <small class="muted">billed</small>` : ''}</td>
        <td data-l="Behind" class="${r.behind >= 15 ? 'bad' : r.behind >= 5 ? 'warn' : ''}">${r.behind ? `${r.behind} work days` : 'On plan'}</td>
        <td data-l="Last report" class="${r.since == null || r.since >= 5 ? 'bad' : r.since >= 2 ? 'warn' : ''}">${ago(r.since)}</td>
        <td data-l="Waiting">${r.waiting || '—'}</td>
        <td data-l="Crew today">${r.crew || '—'}</td>
      </tr>`)}</tbody></table></div>` : html`<p class="empty">No live projects.</p>`}

    <h3 class="ms-h">Money <small class="muted">(${cur}, all projects; no salaries)</small></h3>
    <div class="ms-tiles">
      ${tile('Contract value', money(m.contract, cur))}
      ${tile('Invoiced', money(m.invoiced, cur), m.contract ? `${pct(m.invoiced / m.contract * 100)} of contract` : '')}
      ${tile('Paid to us', money(m.received, cur), m.owed ? `${money(m.owed, cur)} still owed` : '')}
      ${tile('Cash this month', money(m.monthIn - m.monthOut, cur), `in ${money(m.monthIn, cur)} · out ${money(m.monthOut, cur)}`, m.monthIn - m.monthOut < 0 ? 'bad' : '')}
    </div>
    ${m.missing ? html`<p class="muted small">${m.missing} project${m.missing === 1 ? ' has' : 's have'} no money figures yet: they appear once the Admin opens ${m.missing === 1 ? 'it' : 'them'}.</p>` : ''}

    <h3 class="ms-h">Needs attention</h3>
    ${v.alerts.length ? html`<ul class="ms-alerts">${v.alerts.slice(0, 30).map(a => html`<li class="${a.sev}">
      <span class="ms-dot" aria-hidden="true"></span><span class="ms-at">${a.text}</span>
      ${a.id ? html`<button type="button" class="btn small" data-act="openProject" data-id="${a.id}" data-to="${a.link}">Open</button>` : html`<a class="btn small" href="#${a.link}">Open</a>`}
    </li>`)}</ul>${v.alerts.length > 30 ? html`<p class="muted small">+ ${v.alerts.length - 30} more</p>` : ''}` : html`<p class="empty">Nothing needs attention.</p>`}
    <p class="muted small">Server backup: ${backup == null ? 'reading…' : v.backup.last ? `last weekly copy ${fmtDate(v.backup.last.slice(0, 10))}, ${v.backup.kept} kept` : 'no copy yet'}.</p>
  </section>`;
}

export const actions = {};
