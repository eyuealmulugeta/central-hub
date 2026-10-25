// Evaluation: five tiers, each rating the one directly below it on the same project; the General Manager
// (and the Admin) rates everybody, and nobody rates tier 1. 1 to 5 stars on four pillars, plus feedback
// notes written on the day. What a person wrote is seen by them and by the Admin only, never by the person
// it is about (the database enforces it too).

import { store } from '../core/store.js';
import {
  SCALE, PILLARS, CATEGORIES, rankLabel, levelOf, ratableLevels, raterRank, raterTier, scaleLabel,
  checkEvaluation, checkFeedback, averages, summarise,
} from '../engine/evaluation.js';
import { uid, fmtFull } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { docHead, docSec, footText, signoff } from './print.js';
import { docRef } from '../engine/docref.js';

let selected = null;      // team member id
let mode = 'rate';        // rate | note | view (history only)
let notice = '';
let problems = [];
let paper = null;         // the evaluation open as a page to print
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
  const all = c.company.evaluations;
  const open = paper && all.find(r => r.id === paper);
  if (open) return html`<div class="toolbar no-print"><button class="btn ghost" data-act="paperOff">← Evaluation</button>
      <span class="muted">Confidential: the person rated sees it only when you hand it over</span><span class="grow"></span>
      <button class="btn" data-share title="Send this evaluation as a PDF file">WhatsApp / Telegram</button><button class="btn primary" data-act="printPaper">Print</button></div>
    <section class="card sheet">${evalPaper(open, c)}</section>`;
  const list = people(c);
  const person = list.find(m => m.id === selected) || null;
  const tiers = ratableLevels(ranks).map(tierName).join(', ');
  return html`
    <section class="card">
      <div class="toolbar"><h2>Evaluation</h2><span class="muted">You are tier ${raterTier(ranks)} (${ranks.map(rankLabel).join(', ')}). You rate ${tiers}.</span></div>
      <p class="muted">${store.isAdmin ? 'As Admin you see every evaluation written. ' : 'You see only the evaluations you wrote. '}The person you rate never sees them.</p>
      ${notice ? html`<p class="ok">${notice}</p>` : ''}
      ${list.length ? html`<table class="table">
        <thead><tr><th>Person</th><th>Tier</th><th class="r">Latest score</th><th class="r">Feedback stars</th><th></th></tr></thead>
        <tbody>${list.map(m => {
          const s = summarise(all, m.id);
          return html`<tr class="${m.id === selected ? 'on' : ''}">
            <td><b>${m.name}</b> <span class="muted">${m.role || ''}</span></td>
            <td>${tierName(levelOf(m))}</td>
            <td class="r nowrap">${s.latest ? html`${score(s.latest.overall)} <span class="muted">${scaleLabel(s.latest.overall)}</span>${s.trend != null && s.trend !== 0 ? html` ${chip(`${s.trend > 0 ? '+' : ''}${s.trend.toFixed(1)}`, s.trend > 0 ? 'ok' : 'high')}` : ''}` : html`<span class="muted">Not rated yet</span>`}</td>
            <td class="r nowrap">${s.stars == null ? html`<span class="muted">—</span>` : html`<span title="${s.notes.length} notes">${stars(s.stars)}</span>`}</td>
            <td class="r nowrap">
              <button class="btn small primary" data-act="rate" data-id="${m.id}">Evaluate</button>
              <button class="btn small" data-act="note" data-id="${m.id}">Write feedback</button>
              <button class="btn ghost small" data-act="view" data-id="${m.id}">History</button>
            </td></tr>`;
        })}</tbody>
      </table>` : html`<p class="empty">Nobody on this project's team is in the tier you rate. Add people under Settings, This project, Team, and set their tier.</p>`}
    </section>
    ${person && mode === 'rate' ? rateForm(person) : ''}${person && mode === 'note' ? noteForm(person, c) : ''}
    ${person ? history(person, all) : ''}
    ${everything(all)}`;
}

function problemList() {
  return problems.length ? html`<ul class="plain bad">${problems.map(p => html`<li>${p}</li>`)}</ul>` : '';
}

function rateForm(m) {
  return html`<section class="card">
    <div class="toolbar"><h2>Evaluate ${m.name}</h2><button class="btn ghost small" data-act="close">Close</button></div>
    <details class="setup"><summary>The scale</summary>
      <ul class="plain">${SCALE.map(([n, name, text]) => html`<li><b>${n} ${name}</b>: ${text}</li>`)}</ul></details>
    ${problemList()}
    <form data-form="evaluate" class="star-form">
      ${PILLARS.map(p => html`<h3>${p.name}</h3>${p.criteria.map(([k, label]) => starInput(`s-${k}`, label))}`)}
      <label>Comment (optional) <textarea name="comment" rows="3" placeholder="What to keep doing, what to improve"></textarea></label>
      <div class="actions left"><button class="btn primary">Save evaluation</button></div>
    </form>
  </section>`;
}

function noteForm(m, c) {
  return html`<section class="card">
    <div class="toolbar"><h2>Feedback about ${m.name}</h2><button class="btn ghost small" data-act="close">Close</button></div>
    ${problemList()}
    <form data-form="feedback" class="star-form">
      <div class="grid2">
        <label>Date and time of the occasion <input type="datetime-local" name="at" value="${nowLocal()}" required></label>
        <label>Project <input value="${c.project.name}" disabled></label>
        <label>Occasion <select name="category" required>${options([['', 'Choose…'], ...CATEGORIES.map(x => [x, x])], '')}</select></label>
      </div>
      ${starInput('stars', 'Stars')}
      <label>Feedback <textarea name="notes" rows="4" required placeholder="What happened, and what was done well or wrong"></textarea></label>
      <p class="muted">Written by ${me().name}, ${store.ranks.map(rankLabel).join(' / ')}.</p>
      <div class="actions left"><button class="btn primary">Save feedback</button></div>
    </form>
  </section>`;
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

/** One evaluation as a page (v0.22.4): the score of every criterion by pillar, the comment, and both signatures. */
function evalPaper(r, c) {
  const a = averages(r.scores);
  const ref = docRef({ company: c.global.company, project: { name: r.projectName }, type: 'EV', key: `${r.date}-${String(r.id).slice(-4).toUpperCase()}` });
  return html`<div class="paper dsr doc-paper" data-foot="${footText(c, 'Evaluation', ref, { project: false, note: 'confidential' })}">
    ${docHead(c, { title: 'Performance evaluation', sub: `${r.subjectName} · confidential`, ref, status: `${score(a.overall)} · ${scaleLabel(a.overall)}`, tone: a.overall >= 3 ? 'ok' : 'warn',
      facts: [['Employee', r.subjectName], ['Tier', tierName(r.level)], ['Project', r.projectName || ''], ['Date', fmtFull(r.date)], ['Evaluator', `${r.byName || r.by}${r.byRank ? `, ${rankLabel(r.byRank)}` : ''}`]] })}
    ${PILLARS.map((p, i) => docSec(i + 1, p.name, html`<table class="dsr-t"><thead><tr><th>Criterion</th><th>Rating</th><th class="r">Score</th></tr></thead>
      <tbody>${p.criteria.map(([k, label]) => html`<tr><td>${label}</td><td>${r.scores[k] ? html`${stars(r.scores[k])} <span class="muted">${scaleLabel(r.scores[k])}</span>` : html`<span class="muted">Not rated</span>`}</td><td class="r">${r.scores[k] ?? '—'}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">${p.name}, average</td><td class="r">${score(a.pillars[i].value)}</td></tr></tfoot></table>`))}
    ${docSec(PILLARS.length + 1, 'Overall and comments', html`<p><b>${score(a.overall)} of 5</b> · ${scaleLabel(a.overall)}</p>${r.comment ? html`<p class="pre">${r.comment}</p>` : html`<p class="muted">No comment.</p>`}
      <p class="muted small">Scale: ${SCALE.map(([n, name]) => `${n} ${name}`).join(' · ')}</p>`)}
    ${signoff([{ label: 'Evaluator', name: r.byName || r.by }, { label: 'Employee: seen and discussed', name: r.subjectName }, { label: 'Approved by' }])}
  </div>`;
}

export const actions = {
  paperOn(el) { paper = el.dataset.id; },
  paperOff() { paper = null; },
  printPaper() { print(); },
  rate(el) { selected = el.dataset.id; mode = 'rate'; notice = ''; problems = []; },
  note(el) { selected = el.dataset.id; mode = 'note'; notice = ''; problems = []; },
  view(el) { selected = el.dataset.id; mode = 'view'; notice = ''; problems = []; },
  close() { selected = null; problems = []; },
};

export const changes = {
  filter(el) { filters[el.dataset.f] = el.value; },
};

export const submits = {
  evaluate(fd, c) {
    const m = people(c).find(x => x.id === selected);
    if (!m) return false;
    const scores = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('s-')) scores[k.slice(2)] = +v;
    const rec = {
      id: uid('ev'), type: 'evaluation', projectId: c.project.id, projectName: c.project.name, subjectPersonId: m.personId || '', subjectId: m.id, subjectName: m.name, subjectEmail: emailOf(m), level: levelOf(m),
      by: me().email, byName: me().name, byRank: raterRank(store.ranks, levelOf(m)), date: c.today, scores, comment: String(fd.get('comment') || '').trim(),
    };
    problems = checkEvaluation(rec, me());
    if (problems.length) return false;
    store.updateCompany(co => co.evaluations.push(rec));
    notice = `Evaluation of ${m.name} saved: ${score(averages(scores).overall)} (${scaleLabel(averages(scores).overall)}).`;
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
