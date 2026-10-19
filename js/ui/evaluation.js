// Evaluation: each rank rates the one below it (Site Engineer rates the crew, Project
// Manager rates Site Engineers, General Manager rates Project Managers), 1 to 5 on four
// pillars, plus feedback notes written on the day. What a person wrote is seen by them and
// by the Admin only, never by the person it is about (the database enforces it too).

import { store } from '../core/store.js';
import {
  SCALE, PILLARS, CATEGORIES, rankLabel, levelLabel, levelOf, ratableLevels, raterRank, scaleLabel,
  checkEvaluation, checkFeedback, averages, summarise,
} from '../engine/evaluation.js';
import { uid, fmtFull } from '../core/util.js';
import { html, options, chip } from './dom.js';

let selected = null;      // team member id
let mode = 'rate';        // rate | note | view (history only)
let notice = '';
let problems = [];

const stars = n => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));
const score = n => (n == null ? '—' : n.toFixed(1));
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const me = () => ({ email: (store.user?.email || '').toLowerCase(), name: store.profile.name || store.user?.name || 'Admin' });
const emailOf = m => (String(m?.contact || '').match(/[^\s,;]+@[^\s,;]+/) || [''])[0].toLowerCase();

/** Whom this person may rate on the open project: the level below each of their ranks, never themselves. */
function people(c) {
  const levels = ratableLevels(store.ranks);
  return c.ws.team.filter(m => levels.includes(levelOf(m)) && !(emailOf(m) && emailOf(m) === me().email));
}

export function render(c) {
  const ranks = store.ranks;
  if (!ranks.length) {
    return html`<section class="card"><h2>Evaluation</h2>
      <p class="empty">You have not been given a rank yet. The Admin sets it under Settings, People and access (Site Engineer, Project Manager or General Manager).</p></section>`;
  }
  const list = people(c);
  const person = list.find(m => m.id === selected) || null;
  const records = c.company.evaluations.filter(r => r.projectId === c.project.id);
  const levelNames = ratableLevels(ranks).map(levelLabel).join(' and ');
  return html`
    <section class="card">
      <div class="toolbar"><h2>Evaluation</h2><span class="muted">You hold: ${ranks.map(rankLabel).join(', ')}. You rate ${levelNames}.</span></div>
      <p class="muted">${store.isAdmin ? 'As Admin you see every evaluation written. ' : 'You see only the evaluations you wrote. '}The person you rate never sees them.</p>
      ${notice ? html`<p class="ok">${notice}</p>` : ''}
      ${list.length ? html`<table class="table">
        <thead><tr><th>Person</th><th>Level</th><th class="r">Latest score</th><th class="r">Feedback stars</th><th></th></tr></thead>
        <tbody>${list.map(m => {
          const s = summarise(records, m.id);
          return html`<tr class="${m.id === selected ? 'on' : ''}">
            <td><b>${m.name}</b> <span class="muted">${m.role || ''}</span></td>
            <td>${levelLabel(levelOf(m))}</td>
            <td class="r nowrap">${s.latest ? html`${score(s.latest.overall)} <span class="muted">${scaleLabel(s.latest.overall)}</span>${s.trend != null && s.trend !== 0 ? html` ${chip(`${s.trend > 0 ? '+' : ''}${s.trend.toFixed(1)}`, s.trend > 0 ? 'ok' : 'high')}` : ''}` : html`<span class="muted">Not rated yet</span>`}</td>
            <td class="r nowrap">${s.stars == null ? html`<span class="muted">—</span>` : html`<span title="${s.notes.length} notes">${stars(s.stars)}</span>`}</td>
            <td class="r nowrap">
              <button class="btn small primary" data-act="rate" data-id="${m.id}">Evaluate</button>
              <button class="btn small" data-act="note" data-id="${m.id}">Write feedback</button>
              <button class="btn ghost small" data-act="view" data-id="${m.id}">History</button>
            </td></tr>`;
        })}</tbody>
      </table>` : html`<p class="empty">Nobody on this project's team is at the level you rate. Add people under Settings, This project, Team, and set their evaluation level.</p>`}
    </section>
    ${person && mode === 'rate' ? rateForm(person) : ''}${person && mode === 'note' ? noteForm(person, c) : ''}
    ${person ? history(person, records) : ''}`;
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
    <form data-form="evaluate">
      ${PILLARS.map(p => html`
        <h3>${p.name}</h3>
        <div class="grid2">${p.criteria.map(([k, label]) => html`
          <label>${label} <select name="s-${k}" required><option value="">Score…</option>${options(SCALE.map(([n, name]) => [String(n), `${n} ${name}`]), '')}</select></label>`)}</div>`)}
      <label>Comment (optional) <textarea name="comment" rows="3" placeholder="What to keep doing, what to improve"></textarea></label>
      <div class="actions left"><button class="btn primary">Save evaluation</button></div>
    </form>
  </section>`;
}

function noteForm(m, c) {
  return html`<section class="card">
    <div class="toolbar"><h2>Feedback about ${m.name}</h2><button class="btn ghost small" data-act="close">Close</button></div>
    ${problemList()}
    <form data-form="feedback">
      <div class="grid2">
        <label>Date and time of the occasion <input type="datetime-local" name="at" value="${nowLocal()}" required></label>
        <label>Project <input value="${c.project.name}" disabled></label>
        <label>Occasion <select name="category" required>${options([['', 'Choose…'], ...CATEGORIES.map(x => [x, x])], '')}</select></label>
        <label>Stars <select name="stars" required><option value="">Choose…</option>${options(SCALE.map(([n, name]) => [String(n), `${'★'.repeat(n)} ${name}`]), '')}</select></label>
      </div>
      <label>Feedback <textarea name="notes" rows="4" required placeholder="What happened, and what was done well or wrong"></textarea></label>
      <p class="muted">Written by ${me().name}, ${store.ranks.map(rankLabel).join(' / ')}.</p>
      <div class="actions left"><button class="btn primary">Save feedback</button></div>
    </form>
  </section>`;
}

function history(m, records) {
  const s = summarise(records, m.id);
  const rows = [
    ...s.evals.map(e => ({ when: e.date, kind: 'Evaluation', by: e, text: e.comment, value: html`${score(averages(e.scores).overall)} <span class="muted">${scaleLabel(averages(e.scores).overall)}</span>`, detail: averages(e.scores).pillars.map(p => `${p.name} ${score(p.value)}`).join(' · ') })),
    ...s.notes.map(n => ({ when: n.at.slice(0, 10), kind: n.category, by: n, text: n.notes, value: html`<span title="${scaleLabel(n.stars)}">${stars(n.stars)}</span>`, detail: '' })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  return html`<section class="card">
    <h2>History of ${m.name}</h2>
    ${rows.length ? html`<table class="table">
      <thead><tr><th>Date</th><th>What</th><th>Score</th><th>Written by</th><th>Notes</th></tr></thead>
      <tbody>${rows.map(r => html`<tr>
        <td class="nowrap">${fmtFull(r.when)}</td><td>${r.kind}</td><td class="nowrap">${r.value}</td>
        <td>${r.by.byName || r.by.by}<span class="muted note">${rankLabel(r.by.byRank)}</span></td>
        <td>${r.detail ? html`<span class="muted">${r.detail}</span><br>` : ''}${r.text || ''}</td></tr>`)}</tbody>
    </table>` : html`<p class="empty">Nothing written about ${m.name} yet.</p>`}
  </section>`;
}

export const actions = {
  rate(el) { selected = el.dataset.id; mode = 'rate'; notice = ''; problems = []; },
  note(el) { selected = el.dataset.id; mode = 'note'; notice = ''; problems = []; },
  view(el) { selected = el.dataset.id; mode = 'view'; notice = ''; problems = []; },
  close() { selected = null; problems = []; },
};

export const submits = {
  evaluate(fd, c) {
    const m = c.ws.team.find(x => x.id === selected);
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
    const m = c.ws.team.find(x => x.id === selected);
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
