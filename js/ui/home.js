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
import { healthOf, projectLine, needsYou, needGroups } from '../engine/today.js';
import { tradeSummary, stockAndSales, shipmentState, stageLabel } from '../engine/trade.js';
import { fieldVideos, fieldDayPhotos, fieldPhoto, fieldVideoKeep } from '../sync/fieldreport.js';
import { fillPhotos } from './photos.js';
import { rowsOf, rowsFor, HOME_ORDER, todayMedia, weekDays, livePhotos, viewerItems, stepIn, requestBoard, requestedAmount, moneySplit, bookLog, onSite } from '../engine/exechome.js';
import { titleOf } from '../engine/requests.js';
import { expenseTitle, isExpense } from '../engine/expenses.js';
import { siNo, SI_STATUS, SI_TONE } from '../engine/siteinstr.js';
import { topicLabel } from '../engine/spotlight.js';
import { prefs } from '../core/prefs.js';
import { orderOf } from '../core/nav.js';
import { openArrange } from './quick.js';
import { siteVisits, loadSiteNotes } from './reports.js';

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
  people: ['#2f5d8a', 'hr', 'On site now'], 
};
const box = (k, body, { n = '', link = null } = {}) => {
  const [hue, ic, title] = HEADS[k];
  return html`<section class="card xbox xbox-${k}"><div class="xhead" style="--xh:${hue}">${icon(ic, 17)}<h3>${title}</h3>${n !== '' ? html`<span class="xn">${n}</span>` : ''}<span class="grow"></span>${link ? html`<a class="xlink" href="#${link[0]}">${link[1]}</a>` : ''}</div><div class="xbody">${body}</div></section>`;
};
const pctOf = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const starsOf = v => html`<span class="xstars" title="${v} of 5">${'★'.repeat(Math.round(v))}<s>${'★'.repeat(5 - Math.round(v))}</s></span>`;

// v0.94.0 (owner, 5 Nov): a tap opens the photo or video on the full screen, with previous and next
let viewList = [], viewAt = -1, mediaKind = '';   // the items the viewer steps through; '' = photos and videos
function todayBox(m, c) {
  const all = viewerItems(c.project.fieldCode || '', m.photos, m.videos);
  const list = all.filter(x => !mediaKind || x.kind === mediaKind);
  if (viewAt < 0) viewList = list;   // a redraw while the viewer is open keeps its list
  const shown = list.slice(0, 9), more = list.length - shown.length;
  const nPh = m.photos.length, nV = m.videos.length;
  const when = m.day === c.today ? (m.live ? 'Today · live from site' : 'Today') : fmtDate(m.day);
  // v0.95.0 (owner, 5 Nov): a tab per day of this week; a day opens its photos and videos
  const tabs = html`<div class="xdays">${m.week.map(d => html`<button type="button" class="${d === m.day ? 'on' : ''} ${d === c.today ? 'today' : ''}" data-act="mediaDay" data-d="${d}" ${d > c.today ? 'disabled' : ''}>
      <b>${new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</b><small>${d === c.today ? 'Today' : d.slice(8)}</small>${m.counts[d] ? html`<i>${m.counts[d]}</i>` : ''}</button>`)}</div>`;
  const tile = (x, i) => html`<button type="button" class="xm ${i === 0 ? 'big' : ''} ${x.kind}" data-act="mediaOpen" data-i="${i}" title="Open on the full screen"><figure>${x.kind === 'video'
    ? html`<img src="https://drive.google.com/thumbnail?id=${x.fileId}&sz=w600" alt="Site video" loading="lazy"><span class="xplay" aria-hidden="true">▶</span>`
    : html`<img src="data:," alt="Site photo" data-fphoto="${x.key}">`}<figcaption>${x.label}</figcaption></figure></button>`;
  return box('today', html`${tabs}${nV ? html`<div class="seg xseg">${[['', 'All'], ['photo', `Photos ${nPh}`], ['video', `Videos ${nV}`]].map(([k, l]) => html`<button type="button" class="${mediaKind === k ? 'on' : ''}" data-act="mediaKind" data-k="${k}">${l}</button>`)}</div>` : ''}
    ${shown.length ? html`<div class="xmedia">${shown.map(tile)}
      ${more > 0 ? html`<button type="button" class="xm xmore" data-act="mediaOpen" data-i="9"><b>+${more}</b><span>more</span></button>` : ''}</div>`
    : html`<p class="empty">${!c.project.fieldCode ? 'This project is not linked to Field Report yet.' : m.busy ? 'Getting the photos from the site…' : m.day === c.today ? 'No photos from the site yet today. Each one shows here as soon as it is taken.' : 'No photos or videos on this day.'}</p>`}
    <p class="xfoot">All photos are taken live with the Field Report camera, not uploaded. Videos are recorded live too and kept 30 days, then deleted.</p>`,
  { n: [when, `${nPh} photo${nPh === 1 ? '' : 's'}`, nV ? `${nV} video${nV === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '), link: ['reports', 'Open reports'] });
}

/** The full-screen viewer, drawn over the page (and over Present); arrows or the keys ← → step, Esc closes. */
function viewer() {
  let el = document.getElementById('xviewer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'xviewer'; el.className = 'xviewer'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Site photos and videos');
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (b) {
        e.stopPropagation();
        if (b.dataset.v === 'x') closeView();
        else if (b.dataset.v === 'dl') downloadOriginal(viewList[viewAt], b);
        else if (b.dataset.v === 'save') saveVideo(viewList[viewAt], b);
        else showAt(stepIn(viewAt, +b.dataset.v, viewList.length));
      }
      else if (e.target === el) closeView();
    });
    document.body.append(el);
  }
  return el;
}
function showAt(i) {
  const el = viewer(), x = viewList[i];
  if (!x) return closeView();
  viewAt = i;
  el.innerHTML = String(html`<button type="button" class="xv-x" data-v="x" title="Close (Esc)">✕</button>
    ${viewList.length > 1 ? html`<button type="button" class="xv-nav prev" data-v="-1" title="Previous (←)">‹</button><button type="button" class="xv-nav next" data-v="1" title="Next (→)">›</button>` : ''}
    <figure class="xv-fig">${x.kind === 'video'
      ? html`<iframe src="https://drive.google.com/file/d/${x.fileId}/preview" title="Site video" allow="autoplay; fullscreen" allowfullscreen></iframe>`
      : html`<img src="data:," alt="Site photo" data-fphoto="${x.key}">`}
      <figcaption>${x.label}<span>${i + 1} of ${viewList.length}</span>${x.kind === 'video'
        ? html`<button type="button" class="xv-act" data-v="save">${x.kept ? 'Kept ✓ · Download' : 'Save'}</button>`
        : html`<button type="button" class="xv-act" data-v="dl">Download original</button>`}</figcaption></figure>`);
  el.hidden = false;
  document.body.classList.add('viewing');
  fillPhotos(el);
}
/** v0.95.0: the camera original of a photo, full size and quality, saved on this computer. */
async function downloadOriginal(x, b) {
  if (!x || x.kind !== 'photo') return;
  const [proj, report, id] = x.key.split('|');
  b.disabled = true; b.textContent = 'Getting the original…';
  try {
    const data = await fieldPhoto(proj, report, id, true);
    const a = Object.assign(document.createElement('a'), { href: `data:image/jpeg;base64,${data}`, download: `${report.replace(/\.pdf$/, '')}_${id}.jpg` });
    document.body.append(a); a.click(); a.remove();
    b.textContent = 'Downloaded ✓';
  } catch (e) { b.textContent = `Could not get it: ${e.message || e}`; }
  finally { b.disabled = false; }
}
/** v0.95.0: Save a video: kept for good (never deleted after 30 days) and downloaded from Drive. */
async function saveVideo(x, b) {
  if (!x || x.kind !== 'video') return;
  if (!x.kept) {
    b.disabled = true; b.textContent = 'Saving…';
    try {
      await fieldVideoKeep(x.proj, x.id);
      x.kept = true;
      const v = vids.list.find(y => y.id === x.id); if (v) v.kept = true;
      b.textContent = 'Kept ✓ · Download';
    } catch (e) { b.textContent = `Could not save: ${e.message || e}`; b.disabled = false; return; }
    b.disabled = false;
  }
  window.open(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(x.fileId)}`, '_blank', 'noopener');
}

function closeView() {
  const el = document.getElementById('xviewer');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  viewAt = -1;
  document.body.classList.remove('viewing');
}
if (typeof document !== 'undefined') document.addEventListener('keydown', e => {
  if (viewAt < 0) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeView(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showAt(stepIn(viewAt, e.key === 'ArrowRight' ? 1 : -1, viewList.length)); }
}, true);

// v0.95.0: the photos of a day not posted yet, straight from the site (script dayPhotos); today's are read again after 2 minutes
const live = new Map();   // "CODE|date" -> { list, at, busy }
let mediaDay = '';        // the day tab chosen; '' = today
function loadLive(code, date, today) {
  const k = `${code}|${date}`, x = live.get(k);
  if (!store.cloud || (x && (x.busy || date !== today || Date.now() - x.at < 120e3))) return;
  live.set(k, { list: x?.list || [], at: Date.now(), busy: true });
  fieldDayPhotos(code, date).then(l => { live.set(k, { list: l, at: Date.now(), busy: false }); store.notify(); })
    .catch(() => { live.set(k, { list: x?.list || [], at: Date.now(), busy: false }); });
}

// v0.94.0 (R4): the project's site videos, read once per project and page visit
const vids = { code: '', list: [], busy: false, err: '' };
function loadVideos(c) {
  const code = String(c.project.fieldCode || '').toUpperCase();
  if (vids.code !== code) Object.assign(vids, { code, list: [], busy: false, err: '', done: false });
  if (!code || vids.busy || vids.done || !(store.cloud)) return;
  vids.busy = true;
  fieldVideos(code).then(l => { vids.list = l; }).catch(e => { vids.err = String(e.message || e); })
    .finally(() => { vids.busy = false; vids.done = true; if (vids.list.length) store.notify(); });
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
    ${rows.some(s => pctOf(s.money.spent, s.budget) > Math.round(s.progress || 0)) ? html`<p class="xnote">Red bar: paid ahead of the work done.</p>` : ''}
    ${split || rows.length ? '' : html`<p class="empty">No budget set yet. The budget, what is paid and what is asked for show here.</p>`}`,
  { n: split ? c.project.name : '', link: ['ledger', 'Ledger'] });
}

function requestsBox(b) {
  const title = r => (isExpense(r) ? expenseTitle(r) : titleOf(r));
  return box('requests', html`<div class="xcnt"><div class="p"><b>${b.pending}</b><small>Pending</small></div><div class="a"><b>${b.approved}</b><small>Approved</small></div><div class="t"><b>${b.transit}</b><small>In transit</small></div></div>
    ${b.lines.length ? '' : html`<p class="empty">No open site requests.</p>`}<ul class="xlist">${b.lines.slice(0, 3).map(({ r, stage }) => html`<li><i class="xdot ${stage}"></i><span class="xt"><b>${title(r)}</b>${r.neededBy ? html` <small>needed ${fmtDate(r.neededBy)}</small>` : ''}</span></li>`)}</ul>`,
  { n: `${b.open} open`, link: ['requests', 'Open'] });
}

function bookBox(list) {
  return box('book', html`${list.length ? '' : html`<p class="empty">No site instruction sent to the consultant yet.</p>`}<ul class="xlist">${list.map(x => html`<li><span class="xt"><b>${siNo(x.no)} · ${x.subject || '(no subject)'}</b><br><small>${[x.consultant?.name || x.from, fmtDate(String(x.consultant?.at || x.date || '').slice(0, 10))].filter(Boolean).join(' · ')}</small></span>
      ${x.consultant?.image ? html`<img class="xsig" src="${x.consultant.image}" alt="Signature of ${x.consultant.name || 'the consultant'}">` : ''}<span class="tag ${SI_TONE[x.status] || ''}">${SI_STATUS[x.status] || x.status}</span></li>`)}</ul>`,
  { n: String(list.length), link: ['siteinstr', 'Site book'] });
}

function peopleBox(list, rated) {
  const shown = list.slice(0, 6);
  return box('people', html`${list.length ? '' : html`<p class="empty">No one marked present in today's report yet.</p>`}<ul class="xlist xpeople">${shown.map(p => html`<li>${p.photo ? html`<img class="xav" src="${p.photo}" alt="">` : html`<span class="xav">${initials(p.name)}</span>`}
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
  const urgent = needs.filter(n => n.sev === 'high').length;

  // v0.94.0 (owner, 5 Nov): a fixed layout; every box the person may see is drawn, empty or not
  const may = page => (c.can ? c.can(page) : true);
  const own = summaries.find(s => s.project.id === c.project.id) || {};
  if (c.project.fieldCode && may('reports')) loadVideos(c);
  const media = mediaFor(c, may('reports'));
  const reqs = may('requests') ? requestBoard(c.ws.requests || []) : { open: 0 };
  const book = may('siteinstr') ? bookLog(c.ws.siteInstr || []) : [];
  const since = fromDay(toDay(c.today) - 14);
  // v0.93.0 (R3): with the visitors logged on site (Field Report Spotlight > Visitors)
  if (may('spotlight') && (store.isAdmin || (store.ranks || []).includes('hr_assistant'))) loadSiteNotes(c);
  const visits = may('spotlight') ? siteVisits().filter(x => String(x.at).slice(0, 10) >= since).map(x => ({ visit: x.visit, at: x.at, date: String(x.at).slice(0, 10), byName: x.byName || x.by, note: x.note })) : [];
  const spot = may('spotlight') ? [...(c.company.spotlight || []).filter(n => n.kind === 'project' && n.projectId === c.project.id && n.date >= since), ...visits]
    .sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date))).slice(0, 4) : [];
  const people = onSite({ reports: c.ws.reports || [], team: c.ws.team || [], staff: c.company.staff || [], evaluations: may('evaluation') ? c.company.evaluations || [] : null, today: c.today });
  const split = c.money && c.led ? moneySplit({ budget: c.led.budget, spent: c.led.spent, requested: requestedAmount(c.ws.requests || [], c.project.currency, c.global.fx) }) : null;
  const bars = c.money ? summaries.filter(s => s.money && +s.budget > 0) : [];
  const has = { today: true, money: !!c.money, action: true, spot: may('spotlight'), requests: may('requests'), book: may('siteinstr'), people: true };

  const kpi = (tone, label, value, hint, bar = null) => html`<div class="xkpi" style="--c:${tone}"><span class="lab">${label}</span><b>${value}</b><small>${hint}</small>${bar != null ? html`<span class="bar"><i style="width:${Math.min(100, Math.max(0, bar))}%"></i></span>` : ''}</div>`;
  const health = healthOf(own);
  const basis = own.basis && own.basis !== 'none';
  const kpis = [   // v0.94.0: always the same five (Budget paid only for those who see money); '–' when there is nothing yet
    kpi('#2563eb', own.basis === 'billed' ? 'Invoiced' : 'Progress', basis ? `${Math.round(own.progress || 0)}%` : '–', basis ? `${c.project.name} · ${health.label}` : 'No progress measured yet', basis ? own.progress || 0 : 0),
    c.money ? kpi('#0d9488', 'Budget paid', split ? `${split.paidPct}%` : '–', split ? `${money(split.paid, c.project.currency)} of ${money(split.budget, c.project.currency)}` : 'No budget set yet', split ? split.paidPct : 0) : '',
    kpi('#d97706', 'Requests open', reqs.open || 0, `${reqs.pending || 0} pending · ${reqs.transit || 0} in transit`),
    kpi('#e11d48', 'Needs your action', needs.length, urgent ? `${urgent} urgent` : 'none urgent'),
    kpi('#7c3aed', 'On site today', people.length, c.project.name),
  ].filter(Boolean);

  const BOX = {
    today: () => todayBox(media, c),
    money: () => moneyBox(split, c, bars),
    action: () => box('action', needGroups(needs).map(g => html`<details class="ngroup" ${folded.has(g.kind) ? '' : 'open'}>
          <summary data-act="needFold" data-k="${g.kind}"><b>${g.kind}</b> <em class="count-q">${g.items.length}</em>${g.high ? html` <span class="tag ${SEV_TONE.high}">${g.high} ${SEV_LABEL.high.toLowerCase()}</span>` : ''}</summary>
          <ul class="tlist">${g.items.map(n => needRow(n, c))}</ul></details>`).concat(needs.length ? [] : [html`<p class="empty">All clear. Nothing needs you right now.</p>`]), { n: String(needs.length) }),
    spot: () => box('spot', html`${spot.length ? '' : html`<p class="empty">No Spotlight note or visitor in the last 14 days.</p>`}<ul class="xlist">${spot.map(n => n.visit ? html`<li><span class="tag xvis">Visitor</span><span class="xt"><b>${n.visit.type} · ${n.visit.name}${n.visit.org ? `, ${n.visit.org}` : ''}</b><br><small>${[n.visit.purpose, `${n.visit.tin}–${n.visit.tout || 'on site'}`, fmtDate(n.date)].filter(Boolean).join(' · ')}</small></span></li>`
      : html`<li><span class="tag info">${topicLabel(n.topic)}</span><span class="xt"><b>${n.note}</b><br><small>${n.byName || n.by} · ${fmtDate(n.date)}</small></span></li>`)}</ul>`, { n: String(spot.length), link: ['spotlight', 'All'] }),
    requests: () => requestsBox(reqs),
    book: () => bookBox(book),
    people: () => peopleBox(people, may('evaluation')),
  };
  const rows = rowsOf(has, rowsFor(orderOf(prefs.get(HOME_ORDER))));   // v0.92.0: in the person's order
  return html`
    <section class="today-head xhead-row">
      <div><h2>${fmtFull(c.today)}</h2><span class="muted">${needs.length ? `${needs.length} thing${needs.length > 1 ? 's' : ''} need${needs.length > 1 ? '' : 's'} you${urgent ? `, ${urgent} urgent` : ''}.` : 'Nothing needs you right now.'}</span></div>
      ${summaries.length > 1 ? html`<div class="seg">${[['', 'All projects'], ...summaries.map(s => [s.project.id, s.project.name])].map(([id, name]) => html`
        <button type="button" class="${only === id ? 'on' : ''}" data-act="only" data-id="${id}">${name}</button>`)}</div>` : ''}
      <a class="btn small ghost" href="#quick" data-act="arrangeOpen" title="Change the order of the menu and of these boxes">Arrange</a>
      <button type="button" class="btn small" data-act="present" title="Full screen for a meeting (Esc to leave)">${presenting() ? 'Leave full screen' : 'Present'}</button>
    </section>
    <section class="xkpis" style="--n:${kpis.length}">${kpis}</section>
    ${rows.map((r, i) => html`<section class="xrow ${i === 0 && r.length === 2 ? 'wide' : ''} n${r.length}">${r.map(k => BOX[k]())}</section>`)}`;
}

/**
 * v0.95.0 (owner, 5 Nov): the photos and videos of the day chosen in this week's tabs. A day with a posted report shows
 * the report's photos; today (or a day not posted yet) shows what the site has sent so far, live.
 */
function mediaFor(c, mayRead) {
  const code = String(c.project.fieldCode || '').toUpperCase(), week = weekDays(c.today), reports = c.ws.reports || [];
  const day = week.includes(mediaDay) && mediaDay <= c.today ? mediaDay : c.today;
  const videos = code && vids.code === code ? vids.list : [];
  const counts = {};
  for (const d of week) {
    const n = todayMedia(reports, d).length || (live.get(`${code}|${d}`)?.list || []).length;
    counts[d] = n + videos.filter(v => v.date === d).length;
  }
  if (!code) return { day, week, counts, photos: [], videos: [] };
  let photos = todayMedia(reports, day), isLive = false;
  if (!photos.length && mayRead) { loadLive(code, day, c.today); photos = livePhotos(live.get(`${code}|${day}`)?.list); isLive = photos.length > 0; }
  return { day, week, counts, photos, videos: videos.filter(v => v.date === day).sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))), live: isLive, busy: !!live.get(`${code}|${day}`)?.busy };
}

const presenting = () => typeof document !== 'undefined' && document.body.classList.contains('presenting');
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('presenting'); });

const folded = new Set();   // v0.60.0: the "Needs you" groups folded away

export const actions = {
  only(el) { only = el.dataset.id || ''; },
  mediaDay(el) { mediaDay = el.dataset.d || ''; },
  mediaOpen(el) { showAt(Math.min(+el.dataset.i || 0, viewList.length - 1)); },
  mediaKind(el) { mediaKind = el.dataset.k || ''; },
  arrangeOpen() { openArrange(); },
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
