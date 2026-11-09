// Evaluation: five tiers, each rating the one directly below it on the same project; the General Manager
// (and the Admin) rates everybody, and nobody rates tier 1. 1 to 5 stars on four pillars, plus feedback
// notes written on the day. What a person wrote is seen by them and by the Admin only, never by the person
// it is about (the database enforces it too).

import { store } from '../core/store.js';
import {
  SCALE, PILLARS, CATEGORIES, rankLabel, levelOf, ratableLevels, raterRank, raterTier, scaleLabel,
  checkEvaluation, checkFeedback, averages, summarise,
  criteriaFor, ENGAGEMENT, ENGAGE_WORDS, evalPeriod, checkForm, lastOverall, salaryFlag, engagementAvg, factsOf, oldRows,
} from '../engine/evaluation.js';
import { toCSV, downloadText } from '../core/util.js';
import { personForm, savePerson } from './spotnotes.js';
import { spotNotes } from './reports.js';
import { catLabel } from '../engine/spotlight.js';
import { uid, fmtFull } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { docHead, docSec, footText, signoff } from './print.js';
import { docRef } from '../engine/docref.js';
import { monthRating, monthTable, PARTS } from '../engine/crewratings.js';

let selected = null;      // team member id
let mode = 'rate';        // rate | note | view (history only)
let notice = '';
let problems = [];
let paper = null;         // the evaluation open as a page to print
let oldOpen = false;      // v0.49.0: the old evaluations as one page to print (the Admin's PDF copy)
const filters = { search: '', project: '', by: '', kind: '' };   // the table of every evaluation

const stars = n => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));
const score = n => (n == null ? '—' : n.toFixed(1));
const tierName = id => `Tier ${String(id).slice(1)}`;
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const me = () => ({ email: (store.user?.email || '').toLowerCase(), name: store.profile.name || store.user?.name || 'Admin' });
const emailOf = m => (String(m?.contact || '').match(/[^\s,;]+@[^\s,;]+/) || [''])[0].toLowerCase();
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Whom this person may rate on the open project: the tier below theirs, never themselves, never the Admin or an owner. */
export function ratable(team, { ranks, email, name, owners = [] }) {
  const levels = ratableLevels(ranks);
  const owner = owners.map(o => o.toLowerCase());
  return team.filter(m => m.active !== false && levels.includes(levelOf(m))
    && !(emailOf(m) && (emailOf(m) === email || owner.includes(emailOf(m))))
    && !(name && same(m.name, name)));
}
const people = c => ratable(c.ws.team, { ranks: store.ranks, email: me().email, name: store.profile.name, owners: store.owners });

/** Five clickable stars for one score. Drawn right to left so a chosen star lights those before it (css .stars-in). */
const starInput = (name, label) => html`<div class="star-row"><span>${label}</span><span class="stars-in" role="radiogroup" aria-label="${label}">
  ${[5, 4, 3, 2, 1].map(n => html`<input type="radio" id="${name}-${n}" name="${name}" value="${n}"><label for="${name}-${n}" title="${n} ${scaleLabel(n)}">★</label>`)}</span></div>`;

export function render(c) {
  const ranks = store.ranks;
  if (!raterTier(ranks)) {
    return html`<section class="card"><h2>Evaluation</h2>
      <p class="empty">Your title does not rate anybody yet. The Admin sets it under Settings, People and access.</p></section>`;
  }
  if (store.profile?.evaluate === false && !store.isAdmin) return html`<section class="card"><h2>Evaluation</h2><p class="empty">The Admin has not allowed you to evaluate.</p></section>`;
  const all = c.company.evaluations;
  if (oldOpen && store.isAdmin) return oldPage(c);
  const open = paper && all.find(r => r.id === paper);
  if (open) return html`<div class="toolbar no-print"><button class="btn ghost" data-act="paperOff">← Evaluation</button>
      <span class="muted">Confidential: the person rated sees it only when you hand it over</span><span class="grow"></span>
      <button class="btn" data-share title="Send this evaluation as a PDF file">WhatsApp / Telegram</button><button class="btn primary" data-act="printPaper">Print</button></div>
    <section class="card sheet">${evalPaper(open, c)}</section>`;
  const list = people(c);
  const person = list.find(m => m.id === selected) || null;
  const tiers = ratableLevels(ranks).map(tierName).join(', ');
  return html`
    ${store.isAdmin ? adminBox(c) : ''}
    <section class="card">
      <div class="toolbar"><h2>Evaluation</h2><span class="muted">Period ${evalPeriod(c.today, store.global?.evalMonths).label}. You are tier ${raterTier(ranks)} (${ranks.map(rankLabel).join(', ')}). You rate ${tiers}.</span></div>
      <p class="muted">${store.isAdmin ? 'As Admin you see every evaluation written. ' : 'You see only the evaluations you wrote. '}The person you rate never sees them.</p>
      ${notice ? html`<p class="ok">${notice}</p>` : ''}
      ${list.length ? html`<table class="table">
        <thead><tr><th>Person</th><th>Tier</th><th class="r">Latest score</th><th class="r">Feedback stars</th><th class="r" title="Field Report's rating of the daily reports they wrote this month">Report rating</th><th></th></tr></thead>
        <tbody>${list.map(m => {
          const s = summarise(all, m.id);
          return html`<tr class="${m.id === selected ? 'on' : ''}">
            <td><b>${m.name}</b> <span class="muted">${m.role || ''}</span></td>
            <td>${tierName(levelOf(m))}</td>
            <td class="r nowrap">${s.latest ? html`${score(s.latest.overall)} <span class="muted">${scaleLabel(s.latest.overall)}</span>${s.trend != null && s.trend !== 0 ? html` ${chip(`${s.trend > 0 ? '+' : ''}${s.trend.toFixed(1)}`, s.trend > 0 ? 'ok' : 'high')}` : ''}` : html`<span class="muted">Not rated yet</span>`}</td>
            <td class="r nowrap">${s.stars == null ? html`<span class="muted">—</span>` : html`<span title="${s.notes.length} notes">${stars(s.stars)}</span>`}</td>
            <td class="r nowrap">${rateCell(monthRating(c.ws.reports, { name: m.name, email: emailOf(m) }, c.today.slice(0, 7)))}</td>
            <td class="r nowrap">
              <button class="btn small primary" data-act="rate" data-id="${m.id}">Evaluate</button>
              <button class="btn small" data-act="note" data-id="${m.id}" title="A note for the day: evidence in the evaluation">Spotlight note</button>
              <button class="btn ghost small" data-act="view" data-id="${m.id}">History</button>
            </td></tr>`;
        })}</tbody>
      </table>` : html`<p class="empty">Nobody on this project's team is in the tier you rate. Add people under Settings, This project, Team, and set their tier.</p>`}
    </section>
    ${person && mode === 'rate' ? rateForm(person, c) : ''}${person && mode === 'note' ? personForm(person, c.project) : ''}
    ${person ? history(person, all) : ''}
    ${crewBox(c)}
    ${everything(all)}`;
}

/** v0.67.0 (Phase D2): a month's Field Report rating, with the change against the month before. */
const rateCell = x => (x ? html`<span title="${x.days} day${x.days === 1 ? '' : 's'} rated">${x.v.toFixed(1)}/5</span>${x.trend ? html` ${chip(`${x.trend > 0 ? '+' : ''}${x.trend.toFixed(1)}`, x.trend > 0 ? 'ok' : 'high')}` : ''}` : html`<span class="muted">—</span>`);
const partsLine = x => Object.entries(PARTS).map(([k, w]) => `${w} ${x.parts[k] ?? '—'}`).join(' · ');

/** v0.67.0: everyone who wrote reports on this project this month and last, to compare the crews. A hint only. */
function crewBox(c) {
  const month = c.today.slice(0, 7);
  const rows = monthTable(c.ws.reports, month);
  return html`<section class="card"><div class="toolbar"><h3>Field Report ratings, ${month}</h3><span class="muted">From the approved daily reports of ${c.project.name}. A hint for the evaluation; it is never filled in from it.</span></div>
    ${rows.length ? html`<table class="table compact"><thead><tr><th>Reports written by</th><th class="r">This month</th><th class="r">Days rated</th><th class="r">Last month</th><th>Parts (out of 5)</th></tr></thead>
      <tbody>${rows.map(x => html`<tr><td>${x.name}</td><td class="r nowrap">${rateCell(x)}</td><td class="r">${x.days}</td><td class="r">${x.prev == null ? '—' : x.prev.toFixed(1)}</td><td class="muted small">${partsLine(x)}</td></tr>`)}</tbody></table>`
      : html`<p class="muted">No rated report this month yet. Field Report rates each report from version 2.18.0.</p>`}</section>`;
}

function problemList() {
  return problems.length ? html`<ul class="plain bad">${problems.map(p => html`<li>${p}</li>`)}</ul>` : '';
}

/** v0.49.0: Field Report's notes (once loaded on the Spotlight page) and Central Hub's, for the facts. */
const spotAll = c => [...(c.company.spotlight || []), ...spotNotes(c.project.name)];
const periodNow = c => evalPeriod(c.today, store.global?.evalMonths);

/** v0.49.0: the facts of the period beside the form, and the person's notes as evidence. */
function factsBox(m, c) {
  const period = periodNow(c);
  const f = factsOf({ reports: c.ws.reports, spotlight: spotAll(c), person: m, period });
  const fr = monthRating(c.ws.reports, { name: m.name, email: emailOf(m) }, c.today.slice(0, 7));
  return html`<aside class="field-note"><div><b>Facts for ${period.label}</b>
    ${fr ? html`<span>Field Report rating this month ${fr.v.toFixed(1)}/5 from ${fr.days} day${fr.days === 1 ? '' : 's'}${fr.prev != null ? ` (last month ${fr.prev.toFixed(1)})` : ''} · ${partsLine(fr)}</span>` : ''}
    <span>Attendance ${f.attendance == null ? '—' : `${f.attendance}%`} (${f.present} present, ${f.absent} absent) · Late days ${f.late} · Reports sent by 17:30: ${f.onTime} of ${f.reports} · Spotlight ${f.positive} positive, ${f.negative} negative · Safety notes ${f.safety}</span>
    ${f.notes.length ? html`<ul class="plain small">${f.notes.slice(0, 12).map(n => html`<li class="${n.tone === 'positive' ? 'ok' : 'bad'}">${n.date} · ${catLabel(n.category)} · ${n.note}</li>`)}</ul>` : ''}</div></aside>`;
}

function rateForm(m, c) {
  const period = periodNow(c);
  const eng = engagementAvg(c.ws.reports, { name: m.name, email: emailOf(m) }, period, c.project.crewStart);
  const list = criteriaFor(levelOf(m));
  return html`<section class="card">
    <div class="toolbar"><h2>Evaluate ${m.name} · ${period.label}</h2><button class="btn ghost small" data-act="close">Close</button></div>
    ${factsBox(m, c)}
    <details class="setup"><summary>The scale</summary>
      <ul class="plain">${SCALE.map(([n, name, text]) => html`<li><b>${n} ${name}</b>: ${text}</li>`)}</ul></details>
    ${problemList()}
    <form data-form="evaluate" class="star-form">
      <h3>${tierName(levelOf(m))}: 10 criteria</h3>
      ${list.map(k => html`${starInput(`s-${k.id}`, k.label)}<input name="r-${k.id}" class="wide small" placeholder="Reason (needed for a 1 or a 5)" aria-label="Reason for ${k.label}">`)}
      ${eng ? html`<p><b>11. ${ENGAGEMENT.label}: ${eng.v} of 5</b> <span class="muted">from ${eng.reports} report${eng.reports === 1 ? '' : 's'}; 1 point each: ${Object.values(ENGAGE_WORDS).join(', ')}.</span></p>` : ''}
      <label>Comment (optional) <textarea name="comment" rows="3" placeholder="What to keep doing, what to improve"></textarea></label>
      <div class="actions left"><button class="btn primary">Save evaluation</button></div>
    </form>
  </section>`;
}

/** v0.49.0: the Admin's settings: the period, who may evaluate, salary reviews, and the old evaluations. */
function adminBox(c) {
  const all = c.company.evaluations, old = all.filter(r => r.form !== 2);
  const raters = (store.users || []).filter(u => [1, 2, 3].includes(raterTier(u.ranks)));
  const reviews = all.filter(r => r.salaryReview && !r.salaryDone);
  return html`<section class="card"><h2>Evaluation settings</h2>
    <div class="grid2"><label>Evaluation period <select data-chg="evMonths">${options([['6', 'Every 6 months (Jan–Jun, Jul–Dec)'], ['3', 'Every 3 months (quarters)']], String(store.global?.evalMonths || 6))}</select></label></div>
    <details class="setup"><summary>Who may evaluate (Tiers 1, 2 and 3): ${raters.filter(u => u.evaluate !== false).length} of ${raters.length}</summary>
      ${raters.length ? html`<ul class="plain">${raters.map(u => html`<li><label><input type="checkbox" data-chg="evMay" data-id="${u.email}" ${u.evaluate === false ? '' : 'checked'}> ${u.name || u.email} <span class="muted">${(u.ranks || []).map(rankLabel).join(', ')}</span></label></li>`)}</ul>` : html`<p class="muted">Nobody with a Tier 1, 2 or 3 title has a sign-in yet.</p>`}</details>
    ${reviews.length ? html`<h3>Salary reviews for the General Manager</h3><ul class="plain">${reviews.map(r => html`<li><b>${r.subjectName}</b>: ${score(r.prevOverall)} → ${score(averages(r.scores).overall)} (${r.period?.label || r.date}) <button type="button" class="btn small" data-act="salaryDone" data-id="${r.id}">Reviewed</button></li>`)}</ul>` : ''}
  </section>`;
}

/** v0.49.0: every old evaluation and note on one page, to print or save as PDF. */
function oldPage(c) {
  const rows = oldRows(c.company.evaluations);
  return html`<div class="toolbar no-print"><button class="btn ghost" data-act="oldOff">← Evaluation</button><span class="grow"></span><button class="btn primary" data-act="printPaper">Print or save as PDF</button></div>
    <section class="card sheet"><div class="paper dsr doc-paper">${docHead(c, { title: 'Old evaluations', sub: `The only copy · exported ${fmtFull(c.today)}`, facts: [['Records', rows.length - 1]] })}
      <table class="dsr-t small"><thead><tr>${rows[0].map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows.slice(1).map(r => html`<tr>${r.map(x => html`<td>${x}</td>`)}</tr>`)}</tbody></table></div></section>`;
}

/** One line per evaluation or feedback note, newest first. */
export const historyRows = records => records.map(r => {
  const a = r.type === 'evaluation' ? averages(r.scores) : null;
  return {
    id: r.id, when: r.type === 'evaluation' ? r.date : String(r.at || '').slice(0, 10), kind: r.type === 'evaluation' ? 'Evaluation' : r.category,
    who: r.subjectName, project: r.projectName || '', by: r.byName || r.by, byEmail: r.by, rank: r.byRank,
    value: a ? a.overall : r.stars, stars: !a, detail: a ? a.pillars.map(p => `${p.name} ${score(p.value)}`).join(' · ') : '', text: a ? r.comment : r.notes,
  };
}).sort((a, b) => b.when.localeCompare(a.when));

const resultCell = r => (r.stars ? html`<span title="${scaleLabel(r.value)}">${stars(r.value)}</span>` : html`${score(r.value)} <span class="muted">${scaleLabel(r.value)}</span>`);

function history(m, records) {
  const rows = historyRows(records.filter(r => r.subjectId === m.id || (m.personId && r.subjectPersonId === m.personId)));
  return html`<section class="card">
    <h2>History of ${m.name}</h2>
    ${rows.length ? html`<table class="table">
      <thead><tr><th>Date</th><th>What</th><th>Result</th><th>Project</th><th>Evaluator</th><th>Comments</th><th></th></tr></thead>
      <tbody>${rows.map(r => html`<tr>
        <td class="nowrap">${fmtFull(r.when)}</td><td>${r.kind}</td><td class="nowrap">${resultCell(r)}</td><td>${r.project}</td>
        <td>${r.by}<span class="muted note">${rankLabel(r.rank)}</span></td>
        <td>${r.detail ? html`<span class="muted">${r.detail}</span><br>` : ''}${r.text || ''}</td>
        <td class="r">${r.kind === 'Evaluation' ? html`<button class="btn ghost small" data-act="paperOn" data-id="${r.id}" title="The evaluation as a page with both signatures">Print</button>` : ''}</td></tr>`)}</tbody>
    </table>` : html`<p class="empty">Nothing written about ${m.name} yet.</p>`}
  </section>`;
}

/** Every evaluation and note that this person may see, on every project, with filters. */
function everything(records) {
  const rows = historyRows(records);
  if (!rows.length) return '';
  const pick = (list, key) => [...new Set(list.map(r => r[key]).filter(Boolean))].sort();
  const q = filters.search.trim().toLowerCase();
  const shown = rows.filter(r => (!q || `${r.who} ${r.text} ${r.detail}`.toLowerCase().includes(q))
    && (!filters.project || r.project === filters.project) && (!filters.by || r.by === filters.by)
    && (!filters.kind || (filters.kind === 'Evaluation' ? r.kind === 'Evaluation' : r.kind !== 'Evaluation')));
  return html`<section class="card">
    <div class="toolbar"><h2>All evaluations</h2><span class="muted">${shown.length} of ${rows.length}</span></div>
    <div class="toolbar">
      <input type="search" placeholder="Search a name or a word" value="${filters.search}" data-chg="filter" data-f="search" data-fk="ev-search">
      <select data-chg="filter" data-f="project" data-fk="ev-project">${options([['', 'Every project'], ...pick(rows, 'project').map(x => [x, x])], filters.project)}</select>
      <select data-chg="filter" data-f="by" data-fk="ev-by">${options([['', 'Every evaluator'], ...pick(rows, 'by').map(x => [x, x])], filters.by)}</select>
      <select data-chg="filter" data-f="kind" data-fk="ev-kind">${options([['', 'Evaluations and feedback'], ['Evaluation', 'Evaluations'], ['note', 'Feedback notes']], filters.kind)}</select>
    </div>
    <table class="table">
      <thead><tr><th>Date</th><th>Person</th><th>Project</th><th>What</th><th>Result</th><th>Evaluator</th><th>Comments</th><th></th></tr></thead>
      <tbody>${shown.map(r => html`<tr>
        <td class="nowrap">${fmtFull(r.when)}</td><td><b>${r.who}</b></td><td>${r.project}</td><td>${r.kind}</td><td class="nowrap">${resultCell(r)}</td>
        <td>${r.by}<span class="muted note">${rankLabel(r.rank)}</span></td><td>${r.text || ''}</td>
        <td class="r">${r.kind === 'Evaluation' ? html`<button class="btn ghost small" data-act="paperOn" data-id="${r.id}" title="The evaluation as a page with both signatures">Print</button>` : ''}</td></tr>`)}</tbody>
    </table>
  </section>`;
}

/** v0.49.0: the criteria of the Excel form, with the reasons written for a 1 or a 5. */
const newCriteria = r => docSec(1, 'Criteria', html`<table class="dsr-t"><thead><tr><th>Criterion</th><th>Rating</th><th class="r">Score</th></tr></thead>
  <tbody>${[...criteriaFor(r.level), ...(r.scores?.engagement != null ? [ENGAGEMENT] : [])].map((k, i) => html`<tr><td>${i + 1}. ${k.label}${r.reasons?.[k.id] ? html`<br><span class="muted small">Reason: ${r.reasons[k.id]}</span>` : ''}</td>
    <td>${r.scores[k.id] != null ? html`${stars(r.scores[k.id])} <span class="muted">${scaleLabel(r.scores[k.id])}</span>` : html`<span class="muted">Not rated</span>`}</td><td class="r">${r.scores[k.id] ?? '—'}</td></tr>`)}</tbody></table>`);

/** One evaluation as a page (v0.22.4): the score of every criterion by pillar, the comment, and both signatures. */
function evalPaper(r, c) {
  const a = averages(r.scores);
  const ref = docRef({ company: c.global.company, project: { name: r.projectName }, type: 'EV', key: `${r.date}-${String(r.id).slice(-4).toUpperCase()}` });
  return html`<div class="paper dsr doc-paper" data-foot="${footText(c, 'Evaluation', ref, { project: false, note: 'confidential' })}">
    ${docHead(c, { title: 'Performance evaluation', sub: `${r.subjectName} · confidential`, ref, status: `${score(a.overall)} · ${scaleLabel(a.overall)}`, tone: a.overall >= 3 ? 'ok' : 'warn',
      facts: [['Employee', r.subjectName], ['Tier', tierName(r.level)], ...(r.period ? [['Period', r.period.label]] : []), ['Project', r.projectName || ''], ['Date', fmtFull(r.date)], ['Evaluator', `${r.byName || r.by}${r.byRank ? `, ${rankLabel(r.byRank)}` : ''}`]] })}
    ${r.form === 2 ? newCriteria(r) : PILLARS.map((p, i) => docSec(i + 1, p.name, html`<table class="dsr-t"><thead><tr><th>Criterion</th><th>Rating</th><th class="r">Score</th></tr></thead>
      <tbody>${p.criteria.map(([k, label]) => html`<tr><td>${label}</td><td>${r.scores[k] ? html`${stars(r.scores[k])} <span class="muted">${scaleLabel(r.scores[k])}</span>` : html`<span class="muted">Not rated</span>`}</td><td class="r">${r.scores[k] ?? '—'}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">${p.name}, average</td><td class="r">${score(a.pillars[i].value)}</td></tr></tfoot></table>`))}
    ${docSec(r.form === 2 ? 2 : PILLARS.length + 1, 'Overall and comments', html`<p><b>${score(a.overall)} of 5</b> · ${scaleLabel(a.overall)}</p>${r.comment ? html`<p class="pre">${r.comment}</p>` : html`<p class="muted">No comment.</p>`}
      <p class="muted small">Scale: ${SCALE.map(([n, name]) => `${n} ${name}`).join(' · ')}</p>`)}
    ${signoff([{ label: 'Evaluator', name: r.byName || r.by }, { label: 'Employee: seen and discussed', name: r.subjectName }, { label: 'Approved by' }])}
  </div>`;
}

export const actions = {
  paperOn(el) { paper = el.dataset.id; },
  paperOff() { paper = null; },
  oldOff() { oldOpen = false; },
  oldCsv(el, c) { downloadText(`Old evaluations ${c.today}.csv`, toCSV(oldRows(c.company.evaluations))); store.updateGlobal(g => { g.oldEvalsExported = c.today; }); },
  oldPdf(el, c) { oldOpen = true; store.updateGlobal(g => { g.oldEvalsExported = c.today; }); },
  oldRemove(el, c) {
    const n = c.company.evaluations.filter(r => r.form !== 2).length;
    if (!confirm(`Remove the ${n} old evaluations and notes from the app? Keep the exported CSV or PDF: it will be the only copy.`) || !confirm('Sure? This cannot be undone.')) return;
    store.updateCompany(co => { co.evaluations = co.evaluations.filter(r => r.form === 2); });
    notice = `${n} old evaluations removed.`;
  },
  salaryDone(el, c) { store.updateCompany(co => { const r = co.evaluations.find(x => x.id === el.dataset.id); if (r) { r.salaryDone = c.today; r.salaryBy = me().email; } }); },
  printPaper() { print(); },
  rate(el) { selected = el.dataset.id; mode = 'rate'; notice = ''; problems = []; },
  note(el) { selected = el.dataset.id; mode = 'note'; notice = ''; problems = []; },
  view(el) { selected = el.dataset.id; mode = 'view'; notice = ''; problems = []; },
  close() { selected = null; problems = []; },
};

export const changes = {
  filter(el) { filters[el.dataset.f] = el.value; },
  evMonths(el) { store.updateGlobal(g => { g.evalMonths = +el.value === 3 ? 3 : 6; }); },
  evMay(el) { store.setUser(el.dataset.id, { evaluate: el.checked }); },
};

export const submits = {
  evaluate(fd, c) {
    const m = people(c).find(x => x.id === selected);
    if (!m) return false;
    const scores = {}, reasons = {}, period = periodNow(c);
    for (const [k, v] of fd.entries()) {
      if (k.startsWith('s-')) scores[k.slice(2)] = +v;
      if (k.startsWith('r-') && String(v).trim()) reasons[k.slice(2)] = String(v).trim();
    }
    const eng = engagementAvg(c.ws.reports, { name: m.name, email: emailOf(m) }, period, c.project.crewStart);
    if (eng) scores.engagement = eng.v;   // the 11th score: worked out, never typed
    const rec = {
      id: uid('ev'), type: 'evaluation', form: 2, period: { from: period.from, to: period.to, label: period.label }, reasons, projectId: c.project.id, projectName: c.project.name, subjectPersonId: m.personId || '', subjectId: m.id, subjectName: m.name, subjectEmail: emailOf(m), level: levelOf(m),
      by: me().email, byName: me().name, byRank: raterRank(store.ranks, levelOf(m)), date: c.today, scores, comment: String(fd.get('comment') || '').trim(),
    };
    problems = checkForm(rec, me(), c.company.evaluations);
    if (problems.length) return false;
    const prev = lastOverall(c.company.evaluations, rec), now = averages(scores).overall;
    if (salaryFlag(prev, now)) Object.assign(rec, { salaryReview: true, prevOverall: prev });   // one point higher: the GM reviews the salary
    store.updateCompany(co => co.evaluations.push(rec));
    notice = `Evaluation of ${m.name} saved: ${score(now)} (${scaleLabel(now)}).${rec.salaryReview ? ' One point higher than last time: the General Manager is asked to review the salary.' : ''}`;
    mode = 'view';
  },
  spotPerson(fd, c) {
    const m = people(c).find(x => x.id === selected);
    if (!m || savePerson(fd, c, m, levelOf(m), emailOf(m)) === false) return false;
    notice = `Spotlight note about ${m.name} saved.`;
    mode = 'view';
  },
  feedback(fd, c) {
    const m = people(c).find(x => x.id === selected);
    if (!m) return false;
    const rec = {
      id: uid('fb'), type: 'feedback', projectId: c.project.id, projectName: c.project.name, subjectPersonId: m.personId || '', subjectId: m.id, subjectName: m.name, subjectEmail: emailOf(m), level: levelOf(m),
      by: me().email, byName: me().name, byRank: raterRank(store.ranks, levelOf(m)), at: String(fd.get('at') || nowLocal()),
      category: fd.get('category'), stars: +fd.get('stars'), notes: String(fd.get('notes') || '').trim(),
    };
    problems = checkFeedback(rec, me());
    if (problems.length) return false;
    store.updateCompany(co => co.evaluations.push(rec));
    notice = `Feedback about ${m.name} saved.`;
    mode = 'view';
  },
};
