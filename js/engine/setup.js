// Setting up a project: the templates the New project wizard offers, the checks on its answers, and the
// checklist of what a project still needs before it runs smoothly. Pure functions; the screens are
// ui/wizard.js and ui/setup.js.

import { METHODS } from './billing.js';
import { TASK_TEMPLATES } from '../core/seed.js';

/** What the wizard offers to start from. Each fills in the settings people rarely think about. */
export const TEMPLATES = [
  { id: 'container', name: 'Container house installation', type: 'container', billing: 'daily', about: 'Crews install container houses and are billed by the person-day. Daily attendance drives the invoice.' },
  { id: 'steel', name: 'Steel structure work', type: 'steel', billing: 'milestone_fixed', about: 'Steel erection and cladding, paid in stages tied to milestones. Progress is counted in quantities.' },
  { id: 'mixed', name: 'Steel structure and containers', type: 'mixed', billing: 'milestone_pct', about: 'Both kinds of work on one site, paid in stages as a share of the contract.' },
  { id: 'blank', name: 'Something else', type: 'steel', billing: 'milestone_pct', about: 'Start empty and set everything yourself.' },
];
export const templateOf = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

/** Each way of billing, said plainly. */
export const BILLING_HELP = {
  milestone_pct: 'In stages. Each stage is a percentage of the contract value, paid when its milestone is reached.',
  milestone_fixed: 'In stages. Each stage is a fixed amount from the contract, paid when its milestone is reached.',
  progress: 'By work done. Each invoice is the percentage of the contract that is finished.',
  measured: 'By measured quantities. Each invoice is what was measured on site, at the contract rates.',
  daily: 'By the person-day. Each invoice is days worked by each crew at the day rates, with overtime.',
  advance: 'All paid in advance, before the work.',
};
export const billingLabel = id => METHODS.find(([k]) => k === id)?.[1] || id;

/** VAT is 15% in Ethiopia, and 0 where there is none: a starting point the person can change. */
export const defaultVat = currency => (currency === 'ETB' ? 15 : 0);

/** Problems with the answers of one step of the wizard, in plain words (none = go on). */
export function checkStep(step, a) {
  const problems = [];
  if (step === 1) {
    if (!String(a.name || '').trim()) problems.push('Give the project a name.');
    if (!a.currency) problems.push('Choose the currency.');
  }
  if (step === 2) {
    if (!String(a.client || '').trim()) problems.push('Name the client.');
    if (!(+a.contractValue > 0)) problems.push('Enter the contract value, before VAT.');
    if (a.vat !== '' && !(+a.vat >= 0 && +a.vat <= 100)) problems.push('VAT is a percentage between 0 and 100.');
  }
  return problems;
}

/** The project record and the starting tasks the wizard's answers make. */
export function fromWizard(a, today) {
  const t = templateOf(a.template);
  const start = a.start || today;
  const project = {
    name: String(a.name).trim(), type: t.type, regionId: a.regionId, currency: a.currency,
    contractValue: Math.max(0, +a.contractValue || 0),
    client: { name: String(a.client).trim(), address: '', contact: '', taxId: '' },
    billing: { method: a.billing || t.billing, retention: 0, paymentDays: 30, otMultiplier: 1.5, hoursPerDay: 10 },
    markups: { overhead: 8, contingency: 5, profit: 12, vat: a.vat === '' || a.vat == null ? defaultVat(a.currency) : Math.max(0, +a.vat) },
    start,
  };
  const list = a.standardTasks ? TASK_TEMPLATES[t.type] || [] : [];
  const tasks = list.map(([id, name, duration, deps]) => ({ id, name, start, duration, milestone: duration === 0, deps: deps.map(d => ({ ...d })) }));
  return { project, tasks };
}

// ---- the checklist

const positive = obj => Object.values(obj || {}).some(v => +v > 0);

/**
 * What a project needs, in groups. Each item: { id, group, label, why, done, required, go }.
 * `go` says where to do it: { page, focus (a selector to scroll to), click (a selector to press) }.
 */
export function checklist({ project: p, ws, company, users = [], cloud = false }) {
  const method = p.billing?.method;
  const items = [];
  const add = (id, group, label, why, done, required, go) => items.push({ id, group, label, why, done: !!done, required, go });

  add('contract', 'Basics', 'Enter the contract value', 'Everything about money is measured against it.', p.contractValue > 0, true, { page: 'prices', focus: '#panel-project' });
  add('client', 'Basics', 'Name the client', 'It is printed on every invoice and report.', p.client?.name, true, { page: 'invoices', click: '[data-act=tab][data-t=terms]' });
  add('billing', 'Basics', 'Choose how the client is billed', 'It decides how invoices are worked out.', p.billing?.method, true, { page: 'invoices', click: '[data-act=tab][data-t=terms]' });
  add('budget', 'Basics', 'Set the cost budget', 'Without it there is no profit against budget.', p.budget > 0, false, { page: 'prices', focus: '#panel-project' });

  add('tasks', 'Plan', 'Add the schedule', 'Progress, the forecast finish and alerts come from it.', ws.tasks.length > 0, true, { page: 'schedule' });

  add('team', 'People', 'Add the people on this project', 'Attendance, tasks and Field Report lists use them.', ws.team.length > 0, true, { page: 'prices', focus: '#panel-team' });
  add('rates', 'People', 'Set the day rates', 'Labour cost and the pay sheet need them.', positive(ws.laborRates) || (ws.crewRates || []).some(r => +r.dayRate > 0), method === 'daily', { page: 'payments', click: '[data-act=payView][data-v=rates]' });
  if (cloud) add('linked', 'People', 'Link the site engineers to the project', 'A project appears for a Site user only when their email is linked.', users.some(u => (u.projects || []).includes(p.id)), false, { page: 'prices', focus: '#panel-linked' });

  if (method === 'milestone_pct' || method === 'milestone_fixed') add('stages', 'Money', 'Enter the payment stages', 'A milestone that is reached becomes ready to invoice.', ws.payStages.length > 0, true, { page: 'invoices', click: '[data-act=tab][data-t=terms]' });
  if (method === 'measured') add('measure', 'Money', 'Enter the measured items', 'Invoices are made from what is measured.', ws.measure.length > 0, true, { page: 'invoices', click: '[data-act=tab][data-t=terms]' });
  if (method === 'daily') add('billrates', 'Money', 'Set the client day rates', 'Invoices are days worked at these rates.', positive(ws.billRates), true, { page: 'invoices', click: '[data-act=tab][data-t=terms]' });
  add('agreement', 'Money', 'Record the contract under Agreements', 'Keeps its dates, payment terms and signed copy together.', company.contracts.some(c => c.projectId === p.id && c.kind === 'client'), false, { page: 'contracts' });

  add('location', 'Site', 'Add the site location and scope', 'Goes to Field Report with the activity types.', p.location || p.scope, false, { page: 'prices', focus: '#panel-deploy' });
  add('field', 'Site', 'Connect Field Report', 'Site reports arrive here by themselves.', p.fieldCode && p.fieldLabel, false, { page: 'links', focus: '#panel-field' });
  if (p.fieldCode) add('lists', 'Site', 'Send the lists to Field Report', 'The site then picks tasks, crew and activities from lists.', p.fieldSetupAt, false, { page: 'links', focus: '#panel-field' });
  add('report', 'Site', 'Receive the first daily report', 'Then the schedule moves with the work.', ws.reports.length > 0, false, { page: 'reports' });
  return items;
}

/** How far along: the essentials, and the extras. */
export function progress(items) {
  const req = items.filter(i => i.required), extra = items.filter(i => !i.required);
  return {
    essentials: req.filter(i => i.done).length, essentialsTotal: req.length, remaining: req.filter(i => !i.done).length,
    extras: extra.filter(i => i.done).length, extrasTotal: extra.length,
    complete: req.every(i => i.done),
  };
}
