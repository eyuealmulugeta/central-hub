// Letters: the standard letters of the office, written from a template and the person's record.
// A template is plain text with {{placeholders}}; `fill` swaps them in and `unfilled` lists what is
// still waiting to be written (a {{placeholder}} nobody could fill, or a [bracket] to complete), so a
// letter is never issued with a gap in it. Pure functions; the screen is ui/letters.js.

import { fmtFull } from '../core/util.js';

export const TEMPLATES = [
  {
    id: 'employment', name: 'Employment confirmation', subject: 'Confirmation of employment', staff: true,
    body: `To whom it may concern,

This is to confirm that {{name}} is employed by {{company}} as {{title}}, since {{started}}.{{project_line}}

This letter is issued at the request of the employee for whatever lawful purpose it may serve. It does not state salary or any other term of employment.`,
  },
  {
    id: 'salary', name: 'Salary confirmation', subject: 'Confirmation of employment and salary', staff: true,
    body: `To whom it may concern,

This is to confirm that {{name}} is employed by {{company}} as {{title}}, since {{started}}, with a gross pay of {{pay}} {{per}}.

This letter is issued at the request of the employee, to be presented to {{to}}.`,
  },
  {
    id: 'experience', name: 'Experience certificate', subject: 'Experience certificate', staff: true,
    body: `To whom it may concern,

This is to certify that {{name}} worked with {{company}} as {{title}} from {{started}} to {{left}}.{{project_line}}

[Describe the work done and the person's conduct, in your own words.]

We wish {{name}} well in future work.`,
  },
  {
    id: 'warning', name: 'Written warning', subject: 'Written warning', staff: true,
    body: `Dear {{name}},

This is a written warning, issued on {{date}}.

[Describe what happened: the date, the place, and which rule or instruction was not followed.]

[State what must change, and by when.]

If this is repeated, further action may follow, up to the end of your employment. You may reply in writing within [number] days, and your reply will be kept with this letter.`,
  },
  {
    id: 'introduction', name: 'Introduction of the crew to a client or site', subject: 'Introduction of our site team, {{project}}', staff: false,
    body: `Dear {{to}},

{{company}} introduces the following people who will work on {{project}}:

{{crew_list}}

Please allow them access to the site and the support they need to carry out the work.`,
  },
  { id: 'blank', name: 'Blank letter', subject: '', staff: false, body: '' },
];

export const templateOf = id => TEMPLATES.find(t => t.id === id) || TEMPLATES.at(-1);

const PER = { month: 'per month', day: 'per day', hour: 'per hour' };

/** What the placeholders stand for, for one employee (or none) on one project. */
export function valuesFor({ staff, project, company, today, to = '', crew = [], assignedProject = '' }) {
  const agreement = staff?.agreement || {};
  const passport = (staff?.documents || []).find(d => d.kind === 'Passport')?.number || staff?.passportNumber || '';
  return {
    name: staff?.name || '', title: staff?.title || '', company: company?.name || 'Amistad Prefab',
    started: staff?.started ? fmtFull(staff.started) : '', left: staff?.leftOn ? fmtFull(staff.leftOn) : '',
    nationality: staff?.nationality || '', passport,
    pay: agreement.pay ? `${Number(agreement.pay).toLocaleString('en-US')} ${agreement.currency || ''}`.trim() : '', per: PER[agreement.payPer] || '',
    project: project?.name || '', date: today ? fmtFull(today) : '', to,
    project_line: assignedProject ? ` They are currently assigned to ${assignedProject}.` : '',
    crew_list: crew.length ? crew.map(m => `- ${m.name}${m.role ? `, ${m.role}` : ''}`).join('\n') : '',
  };
}

/** Swap every {{key}} that has a value. A key with no value is left in place so it shows as unfinished. */
export const fill = (text, values) => String(text || '').replace(/\{\{(\w+)\}\}/g, (all, key) => (values[key] ? String(values[key]) : all));

/** What is still unfinished in a letter: {{placeholders}} nobody filled and [brackets] still to write. */
export function unfilled(...texts) {
  const found = [];
  for (const t of texts) {
    for (const m of String(t || '').matchAll(/\{\{(\w+)\}\}|\[[^\]\n]{3,}\]/g)) found.push(m[0]);
  }
  return [...new Set(found)];
}

/** LTR-2026-001, LTR-2026-002, ... numbered within the year of the letter. */
export function nextNumber(letters, date) {
  const year = String(date || '').slice(0, 4) || String(new Date().getFullYear());
  const last = Math.max(0, ...letters.map(l => (String(l.number || '').startsWith(`LTR-${year}-`) ? +String(l.number).slice(-3) : 0)));
  return `LTR-${year}-${String(last + 1).padStart(3, '0')}`;
}
