// Today (v0.22.0, Hub 2): what needs this person, across all projects. It replaces the grid of icons. A card per
// project (progress, spent against budget, health, one line), then "Needs you" most urgent first, "This week" and
// "Waiting on others". Each person sees only what their role may open; Site users never see money.

import { store } from '../core/store.js';
import { money, fmtDate, fmtFull, toDay, fromDay } from '../core/util.js';
import { html, icon } from './dom.js';
import { isGM, levelOf } from '../engine/expenses.js';
import { tradeActuals, tradeLines, tradeWarnings } from '../engine/tradebudget.js';
import { weeklyDue } from '../engine/report.js';
import { billStatus } from '../engine/bills.js';
import { healthOf, projectLine, needsYou, needGroups, thisWeek, waitingOn } from '../engine/today.js';
import { tradeSummary, stockAndSales, shipmentState, stageLabel } from '../engine/trade.js';
import { rowsOf, todayMedia, requestBoard, requestedAmount, moneySplit, bookLog, onSite } from '../engine/exechome.js';
import { titleOf } from '../engine/requests.js';
import { expenseTitle, isExpense } from '../engine/expenses.js';
import { siNo, SI_STATUS, SI_TONE } from '../engine/siteinstr.js';
import { topicLabel } from '../engine/spotlight.js';

let only = '';   // the project the lists are filtered to; '' = all projects
/** v0.24.0: "All projects" chosen at the top: every project again. */
export const showAll = () => { only = ''; };

const TONE = { ok: 'ok', warn: 'warn', bad: 'high', none: '' };
const SEV_TONE = { high: 'high', warn: 'warn', info: 'info' };
const SEV_LABEL = { high: 'Urgent', warn: 'Watch', info: 'Note' };
const me = () => store.user?.email || '';
const tag = (text, tone) => html`<span class="tag ${tone || ''}">${text}</span>`;

// v0.91.0 (owner, 5 Nov, R1): the executive Home page. Each box has a coloured heading tab; a box with nothing to
// show is left out and the rest close up (engine/exechome.js rowsOf). Detail boxes are about the open project.
const HEADS = {
  today: ['#1e3a5f', 'reports', 'Today at a glance'], money: ['#0f5f5a', 'finance', 'Financials & progress'],
  action: ['#8a2e3b', 'notifications', 'Needs your action'], spot: ['#5b4b8a', 'meetings', 'Spotlight'],
  requests: ['#8a5a14', 'docs', 'Site requests'], book: ['#3f4a75', 'contracts', 'Signed site book'],
  people: ['#2f5d8a', 'hr', 'On site now'], week: ['#475569', 'schedule', 'This week'], waits: ['#475569', 'discuss', 'Waiting on others'],
};
const box = (k, body, { n = '', link = null } = {}) => {
  const [hue, ic, title] = HEADS[k];
  return html`<section class="card xbox xbox-${k}"><div class="xhead" style="--xh:${hue}">${icon(ic, 17)}<h3>${title}</h3>${n !== '' ? html`<span class="xn">${n}</span>` : ''}<span class="grow"></span>${link ? html`<a class="xlink" href="#${link[0]}">${link[1]}</a>` : ''}</div><div class="xbody">${body}</div></section>`;
};
const pctOf = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const starsOf = v => html`<span class="xstars" title="${v} of 5">${'★'.repeat(Math.round(v))}<s>${'★'.repeat(5 - Math.round(v))}</s></span>`;

function todayBox(media, c) {
  const proj = c.project.fieldCode || '', shown = media.slice(0, 9), more = media.length - shown.length;
  return box('today', html`<div class="xmedia">${shown.map(({ r, p }, i) => html`<a class="xm ${i === 0 ? 'big' : ''}" href="#reports"><figure><img src="data:," alt="${p.caption || 'Site photo'}" data-fphoto="${proj}|${r.field.pdf}|${p.id}"><figcaption>${[p.time, p.zone || p.task, p.caption].filter(Boolean).join(' · ')}</figcaption></figure></a>`)}
      ${more > 0 ? html`<a class="xm xmore" href="#reports"><b>+${more}</b><span>more</span></a>` : ''}</div>
    <p class="xfoot">All photos are taken live with the Field Report camera, not uploaded.</p>`,
  { n: `${media.length} photo${media.length === 1 ? '' : 's'} · ${c.project.name}`, link: ['reports', 'Open reports'] });
}

function moneyBox(split, c, rows) {
  const cur = c.project.currency, R = 15.9, L = 2 * Math.PI * R;
  const arc = (pct, start, color) => html`<circle cx="21" cy="21" r="${R}" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${pct / 100 * L} ${L}" stroke-dashoffset="${-start / 100 * L}" transform="rotate(-90 21 21)"/>`;
  return box('money', html`${split ? html`<div class="xfin">
      <svg viewBox="0 0 42 42" width="120" height="120" role="img" aria-label="Budget: ${split.paidPct}% paid, ${split.requestedPct}% requested, ${split.remainingPct}% remaining">
        <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--line)" stroke-width="6"/>
        ${arc(split.paidPct, 0, '#0d9488')}${arc(split.requestedPct, split.paidPct, '#f59e0b')}${arc(split.remainingPct, split.paidPct + split.requestedPct, '#93c5fd')}
        <text x="21" y="21" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor">${split.paidPct}%</text><text x="21" y="26.5" text-anchor="middle" font-size="3.4" fill="currentColor" opacity=".65">paid</text></svg>
      <div class="xlegend"><div><i style="background:currentColor"></i>Budget<b>${money(split.budget, cur)}</b></div>
        <div><i style="background:#0d9488"></i>Paid ${split.paidPct}%<b>${money(split.paid, cur)}</b></div>
        <div><i style="background:#f59e0b"></i>Requested ${split.requestedPct}%<b>${money(split.requested, cur)}</b></div>
        <div><i style="background:#93c5fd"></i>Remaining ${split.remainingPct}%<b>${money(split.remaining, cur)}</b></div></div></div>` : ''}
    ${rows.map(s => { const paid = pctOf(s.money.spent, s.budget), done = Math.round(s.progress || 0); return html`<button type="button" class="xprow" data-act="openProject" data-id="${s.project.id}" data-to="dashboard" title="Open ${s.project.name}">
      <span><span>${s.project.name}</span><b>${done}% done · ${paid}% paid</b></span><span class="bar"><i class="${paid > done ? 'r' : ''}" style="width:${Math.min(100, done)}%"></i></span></button>`; })}
    ${rows.some(s => pctOf(s.money.spent, s.budget) > Math.round(s.progress || 0)) ? html`<p class="xnote">Red bar: paid ahead of the work done.</p>` : ''}`,
  { n: split ? c.project.name : '', link: ['ledger', 'Ledger'] });
}

function requestsBox(b) {
  const title = r => (isExpense(r) ? expenseTitle(r) : titleOf(r));
  return box('requests', html`<div class="xcnt"><div class="p"><b>${b.pending}</b><small>Pending</small></div><div class="a"><b>${b.approved}</b><small>Approved</small></div><div class="t"><b>${b.transit}</b><small>In transit</small></div></div>
    <ul class="xlist">${b.lines.slice(0, 3).map(({ r, stage }) => html`<li><i class="xdot ${stage}"></i><span class="xt"><b>${title(r)}</b>${r.neededBy ? html` <small>needed ${fmtDate(r.neededBy)}</small>` : ''}</span></li>`)}</ul>`,
  { n: `${b.open} open`, link: ['requests', 'Open'] });
}

function bookBox(list) {
  return box('book', html`<ul class="xlist">${list.map(x => html`<li><span class="xt"><b>${siNo(x.no)} · ${x.subject || '(no subject)'}</b><br><small>${[x.consultant?.name || x.from, fmtDate(String(x.consultant?.at || x.date || '').slice(0, 10))].filter(Boolean).join(' · ')}</small></span>
      ${x.consultant?.image ? html`<img class="xsig" src="${x.consultant.image}" alt="Signature of ${x.consultant.name || 'the consultant'}">` : ''}<span class="tag ${SI_TONE[x.status] || ''}">${SI_STATUS[x.status] || x.status}</span></li>`)}</ul>`,
  { n: String(list.length), link: ['siteinstr', 'Site book'] });
}

function peopleBox(list, rated) {
  const shown = list.slice(0, 6);
  return box('people', html`<ul class="xlist xpeople">${shown.map(p => html`<li>${p.photo ? html`<img class="xav" src="${p.photo}" alt="">` : html`<span class="xav">${initials(p.name)}</span>`}
      <span class="xt"><b>${p.name}</b><br><small>${p.role}</small></span>${rated && p.stars != null ? starsOf(p.stars) : ''}</li>`)}</ul>
    ${list.length > shown.length ? html`<a class="xlink2" href="#attendance">+ ${list.length - shown.length} more on site</a>` : ''}`,
  { n: `${list.length} ${list.length === 1 ? 'person' : 'people'}`, link: ['attendance', 'Attendance'] });
}

function needRow(n, c) {
  const other = n.projectId !== c.project.id;
  return html`<li class="trow">
    <span class="tic ${SEV_TONE[n.sev]}">${icon(n.link === 'reports' ? 'reports' : n.link === 'schedule' ? 'schedule' : n.link === 'requests' ? 'docs' : ['ledger', 'docs', 'invoices'].includes(n.link) ? 'finance' : 'dashboard', 18)}</span>
    <span class="tt"><b>${n.title}</b><span class="muted">${n.detail || ''}</span></span>
    <span class="tag ${SEV_TONE[n.sev]}">${SEV_LABEL[n.sev]}</span>
    ${other ? html`<button type="button" class="btn small" data-act="openProject" data-id="${n.projectId}" data-to="${n.link}">Open</button>`
      : html`<a class="btn small ${n.kind === 'Field reports' ? 'primary' : ''}" href="#${n.link}">${n.kind === 'Field reports' ? 'Review' : 'Open'}</a>`}
  </li>`;
}

/**
 * Today in Trading (v0.22.3): shipments, stock and sales only. The Installation projects belong to the other
 * division and are never shown here (owner, 26 Oct 2026).
 */
function tradingToday(c) {
  const cur = c.global.fx.base;
  const ships = c.company.shipments || [];
  const sum = tradeSummary(ships, c.global.fx, c.today, cur);
  const st = c.money ? stockAndSales(c.company, c.global.fx, cur) : null;
  const open = ships.map(s => ({ s, st: shipmentState(s, c.today) })).filter(x => !x.st.done);
  const late = open.filter(x => x.st.late).sort((a, b) => b.st.daysLate - a.st.daysLate);
  const soon = open.filter(x => x.st.daysToArrival != null && x.st.daysToArrival <= 7).sort((a, b) => a.st.daysToArrival - b.st.daysToArrival);
  const owed = st ? st.sales.filter(x => !x.paid) : [];
  const meetings = (c.company.meetings || []).filter(m => (!me() || m.by === me() || (m.invitees || []).some(i => i.email === me())) && String(m.start || '').slice(0, 10) >= c.today).slice(0, 5);
  const needs = late.length + owed.length;
  const card = (label, value, sub, tone = '') => html`<div class="pcard"><span class="pcard-hd"><b>${label}</b></span><span class="pcard-m"><span><b class="${tone}">${value}</b>${sub}</span></span></div>`;
  return html`
    <section class="today-head"><div><h2>${fmtFull(c.today)}</h2><span class="muted">Trading. ${needs ? `${needs} thing${needs > 1 ? 's' : ''} need${needs > 1 ? '' : 's'} you.` : 'Nothing needs you right now.'}</span></div></section>
    <section class="pcards">
      ${card('Shipments open', sum.open, sum.late ? `${sum.late} late` : 'none late')}
      ${c.money ? card('On the way', money(sum.onTheWay, cur), 'landed cost') : ''}
      ${st ? card('In stock', money(st.stockValue, cur), 'at landed cost') : ''}
      ${st ? card('Owed to you', money(st.unpaid, cur), `${owed.length} sale${owed.length === 1 ? '' : 's'} not paid`) : ''}
    </section>
    <section class="today-grid">
      <div class="card">
        <h3 class="card-h">Needs you <em class="count-q">${needs}</em></h3>
        ${needs ? html`<ul class="tlist">
          ${late.map(x => html`<li class="trow"><span class="tic high">${icon('trade', 18)}</span><span class="tt"><b>${x.s.ref || 'Shipment'}${x.s.supplier ? `, ${x.s.supplier}` : ''}</b><span class="muted">Late by ${x.st.daysLate} day${x.st.daysLate === 1 ? '' : 's'}. ${stageLabel(x.s.stage)}</span></span><span class="tag high">Late</span><a class="btn small" href="#trade">Open</a></li>`)}
          ${owed.slice(0, 8).map(x => html`<li class="trow"><span class="tic warn">${icon('finance', 18)}</span><span class="tt"><b>${x.item}${x.customer ? `, ${x.customer}` : ''}</b><span class="muted">Sold ${fmtDate(x.date)}${c.money ? `, ${money(x.revenue, cur)}` : ''} not paid yet</span></span><span class="tag warn">Owed</span><a class="btn small" href="#stock">Open</a></li>`)}
        </ul>` : html`<p class="empty">All clear. Late shipments and unpaid sales show here.</p>`}
      </div>
      <div class="today-side">
        <div class="card">
          <h3 class="card-h">Arriving this week</h3>
          ${soon.length ? html`<ul class="tlist">${soon.map(x => html`<li class="trow"><span class="tday"><b>${fmtDate(x.s.eta).split(' ')[0]}</b><small>${new Date(x.s.eta + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</small></span><span class="tt"><b>${x.s.ref || 'Shipment'}</b><span class="muted">${[x.s.supplier, stageLabel(x.s.stage)].filter(Boolean).join(', ')}</span></span><a class="btn small ghost" href="#trade">Open</a></li>`)}</ul>`
            : html`<p class="empty">No shipment due in the next 7 days.</p>`}
        </div>
        <div class="card">
          <h3 class="card-h">Meetings</h3>
          ${meetings.length ? html`<ul class="tlist">${meetings.map(m => html`<li class="trow"><span class="tt"><b>${m.title}</b><span class="muted">${fmtDate(String(m.start).slice(0, 10))} ${String(m.start).slice(11, 16)}</span></span></li>`)}</ul>`
            : html`<p class="empty">No meeting coming up.</p>`}
        </div>
      </div>
    </section>`;
}

export function render(c) {
  if (c.division === 'trading') return tradingToday(c);
  const summaries = c.summaries || [];
  const meetings = [...(c.company.meetings || []).filter(m => !me() || m.by === me() || (m.invitees || []).some(i => i.email === me())), ...(c.company.bookings || [])];
  const others = summaries.filter(s => s.project.id !== c.project.id);
  const needs = needsYou({ project: c.project, flags: c.flags, requests: c.ws.requests || [], others, approver: c.role !== 'site', gm: isGM({ role: c.role, ranks: store.ranks }), level: levelOf({ role: c.role, ranks: store.ranks }), me: store.user?.email || '', settings: c.global, meetings, today: c.today, weekly: c.role !== 'site' && weeklyDue(c.ws, c.today), bills: (c.ws.bills || []).map(b => ({ supplier: b.supplier, status: billStatus(b, c.today) })), trades: c.role === 'site' ? [] : tradeWarnings(tradeLines(c.project, tradeActuals(c.ws, c.project, c.company.staff))) })
    .filter(n => !only || n.projectId === only);
  const week = only && only !== c.project.id ? [] : thisWeek({ today: c.today, rows: c.sched.rows, items: c.flags.items, meetings });
  const waits = only && only !== c.project.id ? [] : waitingOn(c.flags.items);
  const urgent = needs.filter(n => n.sev === 'high').length;

  // v0.91.0: what each box has; a box with nothing is left out
  const may = page => (c.can ? c.can(page) : true);
  const own = summaries.find(s => s.project.id === c.project.id) || {};
  const media = c.project.fieldCode ? todayMedia(c.ws.reports || [], c.today) : [];
  const reqs = may('requests') ? requestBoard(c.ws.requests || []) : { open: 0 };
  const book = may('siteinstr') ? bookLog(c.ws.siteInstr || []) : [];
  const since = fromDay(toDay(c.today) - 14);
  const spot = may('spotlight') ? (c.company.spotlight || []).filter(n => n.kind === 'project' && n.projectId === c.project.id && n.date >= since)
    .sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date))).slice(0, 3) : [];
  const people = onSite({ reports: c.ws.reports || [], team: c.ws.team || [], staff: c.company.staff || [], evaluations: may('evaluation') ? c.company.evaluations || [] : null, today: c.today });
  const split = c.money && c.led ? moneySplit({ budget: c.led.budget, spent: c.led.spent, requested: requestedAmount(c.ws.requests || [], c.project.currency, c.global.fx) }) : null;
  const bars = c.money ? summaries.filter(s => s.money && +s.budget > 0) : [];
  const has = { today: media.length, money: split || bars.length, action: needs.length, spot: spot.length, requests: reqs.open, book: book.length, people: people.length, week: week.length, waits: waits.length };

  const kpi = (tone, label, value, hint, bar = null) => html`<div class="xkpi" style="--c:${tone}"><span class="lab">${label}</span><b>${value}</b><small>${hint}</small>${bar != null ? html`<span class="bar"><i style="width:${Math.min(100, Math.max(0, bar))}%"></i></span>` : ''}</div>`;
  const health = healthOf(own);
  const kpis = [
    own.basis && own.basis !== 'none' ? kpi('#2563eb', own.basis === 'billed' ? 'Invoiced' : 'Progress', `${Math.round(own.progress || 0)}%`, `${c.project.name} · ${health.label}`, own.progress || 0) : '',
    split ? kpi('#0d9488', 'Budget paid', `${split.paidPct}%`, `${money(split.paid, c.project.currency)} of ${money(split.budget, c.project.currency)}`, split.paidPct) : '',
    reqs.open ? kpi('#d97706', 'Requests open', reqs.open, `${reqs.pending} pending · ${reqs.transit} in transit`) : '',
    needs.length ? kpi('#e11d48', 'Needs your action', needs.length, urgent ? `${urgent} urgent` : 'none urgent') : '',
    people.length ? kpi('#7c3aed', 'On site today', people.length, c.project.name) : '',
  ].filter(Boolean);

  const BOX = {
    today: () => todayBox(media, c),
    money: () => moneyBox(split, c, bars),
    action: () => box('action', needGroups(needs).map(g => html`<details class="ngroup" ${folded.has(g.kind) ? '' : 'open'}>
          <summary data-act="needFold" data-k="${g.kind}"><b>${g.kind}</b> <em class="count-q">${g.items.length}</em>${g.high ? html` <span class="tag ${SEV_TONE.high}">${g.high} ${SEV_LABEL.high.toLowerCase()}</span>` : ''}</summary>
          <ul class="tlist">${g.items.map(n => needRow(n, c))}</ul></details>`), { n: String(needs.length) }),
    spot: () => box('spot', html`<ul class="xlist">${spot.map(n => html`<li><span class="tag info">${topicLabel(n.topic)}</span><span class="xt"><b>${n.note}</b><br><small>${n.byName || n.by} · ${fmtDate(n.date)}</small></span></li>`)}</ul>`, { n: String(spot.length), link: ['spotlight', 'All'] }),
    requests: () => requestsBox(reqs),
    book: () => bookBox(book),
    people: () => peopleBox(people, may('evaluation')),
    week: () => box('week', html`<ul class="tlist">${week.map(w => html`<li class="trow"><span class="tday"><b>${fmtDate(w.day).split(' ')[0]}</b><small>${new Date(w.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</small></span>
            <span class="tt"><b>${w.title}</b><span class="muted">${w.kind}${w.detail ? `, ${w.detail}` : ''}</span></span><a class="btn small ghost" href="#${w.link}">Open</a></li>`)}</ul>`),
    waits: () => box('waits', html`<ul class="tlist">${waits.slice(0, 8).map(i => html`<li class="trow"><span class="tt"><b>${i.title}</b><span class="muted">With ${i.owner}${i.due ? `, due ${fmtDate(i.due)}` : ''}${i.overdue ? ', overdue' : ''}</span></span>${i.overdue ? tag('Overdue', 'high') : ''}</li>`)}</ul>`),
  };
  const rows = rowsOf(has);
  return html`
    <section class="today-head xhead-row">
      <div><h2>${fmtFull(c.today)}</h2><span class="muted">${needs.length ? `${needs.length} thing${needs.length > 1 ? 's' : ''} need${needs.length > 1 ? '' : 's'} you${urgent ? `, ${urgent} urgent` : ''}.` : 'Nothing needs you right now.'}</span></div>
      ${summaries.length > 1 ? html`<div class="seg">${[['', 'All projects'], ...summaries.map(s => [s.project.id, s.project.name])].map(([id, name]) => html`
        <button type="button" class="${only === id ? 'on' : ''}" data-act="only" data-id="${id}">${name}</button>`)}</div>` : ''}
      <button type="button" class="btn small" data-act="present" title="Full screen for a meeting (Esc to leave)">${presenting() ? 'Leave full screen' : 'Present'}</button>
    </section>
    ${kpis.length ? html`<section class="xkpis" style="--n:${kpis.length}">${kpis}</section>` : ''}
    ${rows.map((r, i) => html`<section class="xrow ${i === 0 && r.length === 2 ? 'wide' : ''} n${r.length}">${r.map(k => BOX[k]())}</section>`)}
    ${rows.length ? '' : html`<section class="card"><p class="empty">All clear. Today's photos, requests and alerts show here as they come in.</p></section>`}`;
}

const presenting = () => typeof document !== 'undefined' && document.body.classList.contains('presenting');
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('presenting'); });

const folded = new Set();   // v0.60.0: the "Needs you" groups folded away

export const actions = {
  only(el) { only = el.dataset.id || ''; },
  /** v0.91.0: Present, the Home page alone on the full screen for a meeting. */
  present() {
    const on = !presenting();
    document.body.classList.toggle('presenting', on);
    if (on) document.documentElement.requestFullscreen?.()?.catch?.(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.();
  },
  needFold(el, _c, e) { e?.preventDefault?.(); const k = el.dataset.k; if (folded.has(k)) folded.delete(k); else folded.add(k); },
  /** Open a project (and a page of it) from a card or a line about another project. */
  openProject(el) {
    const to = el.dataset.to || 'dashboard';
    if (el.dataset.id !== store.project?.id) store.switchTo(el.dataset.id);
    location.hash = to;
  },
};
