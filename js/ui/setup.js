// Setup: what the open project still needs before it runs smoothly, in order, each with a button that
// opens the right screen and scrolls to the right place. The Admin's page: setting a project up is the
// Admin's job. The same count shows on the Overview until the essentials are done.
//
// Laid out in two parts: on the left a summary (a ring of the essentials, the extras, and the next step),
// on the right the steps in groups. Every button is always visible.

import { store } from '../core/store.js';
import { checklist, progress } from '../engine/setup.js';
import { html, chip, meter } from './dom.js';
import { openPanel } from './prices.js';

const GROUPS = [
  ['Basics', 'The contract and how it is billed'],
  ['Plan', 'The schedule everything else follows'],
  ['People', 'Who works on the project, and what they cost'],
  ['Money', 'What the client pays, and when'],
  ['Site', 'Reports from the field'],
];
const CIRCUMFERENCE = 2 * Math.PI * 42;

/** The items, and how far along, for the open project. Shared with the Overview banner. */
export function itemsOf(c) {
  const items = checklist({ project: c.project, ws: c.ws, company: c.company, users: store.users, cloud: store.cloud });
  return { items, ...progress(items) };
}

/** A ring that fills as the essentials get done. */
function ring(done, total, complete) {
  const share = total ? done / total : 1;
  return html`<svg class="setup-ring" viewBox="0 0 100 100" role="img" aria-label="${done} of ${total} essentials done">
    <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
    <circle class="ring-fg ${complete ? 'ok' : ''}" cx="50" cy="50" r="42" stroke-dasharray="${(share * CIRCUMFERENCE).toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}" transform="rotate(-90 50 50)"></circle>
    <text x="50" y="49" text-anchor="middle" class="ring-big">${done} / ${total}</text>
    <text x="50" y="65" text-anchor="middle" class="ring-small">essentials</text>
  </svg>`;
}

const doThis = (i, c) => (i.done ? chip('Done', 'ok')
  : c.can(i.go.page)
    ? html`<button class="btn small ${i.required ? 'primary' : ''}" data-act="go" data-page="${i.go.page}" data-focus="${i.go.focus || ''}" data-click="${i.go.click || ''}">Do this</button>`
    : html`<span class="muted nowrap">Ask the Admin</span>`);

export function render(c) {
  const { items, essentials, essentialsTotal, extras, extrasTotal, complete } = itemsOf(c);
  const p = c.project;
  const next = items.find(i => i.required && !i.done) || items.find(i => !i.done);
  return html`
    <aside class="setup-side">
      <section class="card setup-hero">
        ${ring(essentials, essentialsTotal, complete)}
        <h2>${p.name}</h2>
        <p class="muted">${complete ? 'The essentials are done. Everything below is optional.' : `${essentialsTotal - essentials} essential${essentialsTotal - essentials === 1 ? '' : 's'} to do before the invoices, the schedule and the reports can work.`}</p>
        <div class="setup-extra"><span class="muted">Worth doing too</span><b>${extras} of ${extrasTotal}</b></div>
        ${meter(extrasTotal ? extras / extrasTotal * 100 : 100, '')}
        <label class="check"><input type="checkbox" data-chg="hideBanner" ${p.setupHidden ? 'checked' : ''}> Do not remind me on the Overview</label>
      </section>
      ${next ? html`<section class="card setup-next">
        <span class="muted">${next.required ? 'Next step' : 'Next, if you like'}</span>
        <b>${next.label}</b>
        <span class="muted">${next.why}</span>
        ${next.done ? '' : doThis(next, c)}
      </section>` : html`<section class="card setup-next setup-allset"><b>Everything is set up.</b><span class="muted">Nothing is left on the checklist.</span></section>`}
    </aside>
    <div class="setup-main">
      ${GROUPS.map(([group, about]) => {
        const list = items.filter(i => i.group === group);
        if (!list.length) return '';
        const done = list.filter(i => i.done).length;
        return html`<section class="card setup-group">
          <header><div><h3>${group}</h3><span class="muted">${about}</span></div>${chip(`${done} of ${list.length}`, done === list.length ? 'ok' : '')}</header>
          <div class="setup-rows">${list.map(i => html`
            <div class="setup-row ${i.done ? 'setup-done' : ''}">
              <span class="setup-mark ${!i.done && i.required ? 'need' : ''}" aria-hidden="true">${i.done ? '✓' : ''}</span>
              <span class="setup-text"><span class="setup-title"><b>${i.label}</b>${i.required ? '' : html`<span class="setup-tag">optional</span>`}</span><span class="muted">${i.why}</span></span>
              <span class="setup-act">${doThis(i, c)}</span>
            </div>`)}</div>
        </section>`;
      })}
    </div>`;
}

export const actions = {
  /** Open the screen, then scroll to the place or press the tab the item needs. */
  go(el) {
    const { page, focus, click } = el.dataset;
    if (focus?.startsWith('#panel-')) openPanel(focus.slice(7));   // open the tab that holds the card
    location.hash = `#${page}`;
    let tries = 0;
    const settle = () => {
      const target = (focus && document.querySelector(focus)) || (click && document.querySelector(click));
      if (target) {
        if (click && !focus) target.click();
        else target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (++tries < 12 && (focus || click)) setTimeout(settle, 150);
    };
    if (focus || click) setTimeout(settle, 250);
  },
};

export const changes = {
  hideBanner(el) { store.updateProject(p => { p.setupHidden = el.checked; }); },
};
