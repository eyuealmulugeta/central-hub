// New project: three short steps. What kind of project, the contract, then a last look. Everything people
// rarely think about (markups, working week, hours in a day, overtime, activity types) comes from the
// template. A project made here opens on its Setup checklist, which says what is still to do.

import { store } from '../core/store.js';
import { TEMPLATES, templateOf, BILLING_HELP, billingLabel, defaultVat, checkStep, fromWizard } from '../engine/setup.js';
import { METHODS } from '../engine/billing.js';
import { todayISO } from '../core/util.js';
import { html, options } from './dom.js';

let a = {};
let step = 1;
let problems = [];
let bound = false;

const dialog = () => document.getElementById('dlg-project');
const box = () => document.getElementById('wizard');

export function openWizard() {
  const g = store.global;
  const near = store.project;
  const region = g.regions.find(r => r.id === near?.regionId) || g.regions[0];
  a = {
    template: 'container', name: '', regionId: region?.id, currency: near?.currency || region?.currency || g.fx.base,
    client: '', contractValue: '', vat: defaultVat(near?.currency || region?.currency || g.fx.base), vatTouched: false,
    billing: templateOf('container').billing, billingTouched: false, start: todayISO(), standardTasks: false,
  };
  step = 1;
  problems = [];
  bind();
  draw();
  if (!dialog().open) dialog().showModal();
}

function draw() {
  const g = store.global;
  const t = templateOf(a.template);
  const steps = ['The project', 'The contract', 'Check and create'];
  box().innerHTML = String(html`
    <h2>New project</h2>
    <ol class="wiz-steps">${steps.map((s, i) => html`<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'past' : ''}"><span>${i + 1}</span> ${s}</li>`)}</ol>
    ${problems.length ? html`<ul class="plain bad">${problems.map(p => html`<li>${p}</li>`)}</ul>` : ''}
    ${step === 1 ? html`
      <fieldset class="wiz-cards"><legend class="muted">What kind of project is it?</legend>
        ${TEMPLATES.map(x => html`<label class="wiz-card ${x.id === a.template ? 'on' : ''}">
          <input type="radio" name="template" value="${x.id}" data-w="template" ${x.id === a.template ? 'checked' : ''}>
          <b>${x.name}</b><span class="muted">${x.about}</span></label>`)}
      </fieldset>
      <label>Project name <input data-w="name" value="${a.name}" autocomplete="off" placeholder="e.g. Mosestro Israel: container house installation"></label>
      <div class="grid2">
        <label>Country <select data-w="regionId">${options(g.regions.map(r => [r.id, r.name]), a.regionId)}</select></label>
        <label>Currency <select data-w="currency">${options(Object.keys(g.fx.rates).map(k => [k, k]), a.currency)}</select></label>
      </div>
      <span class="muted">Projects in Ethiopia are in ETB, all others in USD. The country sets the price list; you can add a country under Settings.</span>` : ''}
    ${step === 2 ? html`
      <label>Client <input data-w="client" value="${a.client}" autocomplete="off" placeholder="Company or person that pays"></label>
      <div class="grid2">
        <label>Contract value, before VAT, in ${a.currency} <input type="number" min="0" step="any" data-w="contractValue" value="${a.contractValue}"></label>
        <label>VAT % <input type="number" min="0" max="100" step="any" data-w="vat" value="${a.vat}"></label>
      </div>
      <label>How is the client billed?
        <select data-w="billing">${options(METHODS, a.billing)}</select></label>
      <span class="muted">${BILLING_HELP[a.billing] || ''}</span>
      <label>Planned start <input type="date" data-w="start" value="${a.start}"></label>` : ''}
    ${step === 3 ? html`
      <dl class="facts">
        <dt>Project</dt><dd>${a.name}</dd>
        <dt>Kind</dt><dd>${t.name}</dd>
        <dt>Country and currency</dt><dd>${g.regions.find(r => r.id === a.regionId)?.name || ''}, ${a.currency}</dd>
        <dt>Client</dt><dd>${a.client}</dd>
        <dt>Contract value</dt><dd>${Number(a.contractValue).toLocaleString('en-US')} ${a.currency}, before ${a.vat}% VAT</dd>
        <dt>Billing</dt><dd>${billingLabel(a.billing)}</dd>
        <dt>Starts</dt><dd>${a.start}</dd>
      </dl>
      <p class="muted">Working week Monday to Saturday, a 10-hour day and overtime at 1.5 times are set for you; change them under Settings. The next screen is the project's checklist: it shows what is still to do. Tasks are added on the Schedule, one by one or with Import from another project.</p>` : ''}
    <div class="actions">
      <button class="btn ghost" type="button" data-wiz="cancel">Cancel</button>
      ${step > 1 ? html`<button class="btn" type="button" data-wiz="back">Back</button>` : ''}
      ${step < 3 ? html`<button class="btn primary" type="button" data-wiz="next">Next</button>` : html`<button class="btn primary" type="button" data-wiz="create">Create the project</button>`}
    </div>`);
}

function bind() {
  if (bound) return;
  bound = true;
  const d = dialog();
  d.addEventListener('input', e => {
    const f = e.target.closest('[data-w]');
    if (!f || f.tagName === 'SELECT' || f.type === 'radio') return;
    const key = f.dataset.w;
    a[key] = f.type === 'checkbox' ? f.checked : f.value;
    if (key === 'vat') a.vatTouched = true;
  });
  d.addEventListener('change', e => {
    const f = e.target.closest('[data-w]');
    if (!f) return;
    const key = f.dataset.w;
    if (key === 'template') {
      a.template = f.value;
      if (!a.billingTouched) a.billing = templateOf(a.template).billing;
    } else if (key === 'regionId') {
      a.regionId = f.value;
      const region = store.global.regions.find(r => r.id === f.value);
      if (region) { a.currency = region.currency; if (!a.vatTouched) a.vat = defaultVat(a.currency); }
    } else if (key === 'currency') {
      a.currency = f.value;
      if (!a.vatTouched) a.vat = defaultVat(a.currency);
    } else if (key === 'billing') {
      a.billing = f.value;
      a.billingTouched = true;
    } else return;
    draw();
  });
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-wiz]');
    if (!b) return;
    const what = b.dataset.wiz;
    if (what === 'cancel') { d.close(); return; }
    if (what === 'back') { step--; problems = []; draw(); return; }
    if (what === 'next') {
      problems = checkStep(step, a);
      if (!problems.length) step++;
      draw();
      return;
    }
    if (what === 'create') {
      problems = [...checkStep(1, a), ...checkStep(2, a)];
      if (problems.length) { step = checkStep(1, a).length ? 1 : 2; draw(); return; }
      const { project, tasks } = fromWizard(a, todayISO());
      store.addProject(project);
      if (tasks.length) store.update(ws => { ws.tasks = tasks; });
      d.close();
      location.hash = '#setup';
    }
  });
}
