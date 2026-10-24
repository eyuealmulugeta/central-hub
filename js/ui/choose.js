// Drop-down lists whose values are chosen, not typed. The one way out is "Other...": it asks for a new value once and
// the value then stays in the list. Used wherever a job position or department is set.

import { html, options } from './dom.js';

export const OTHER = '__other';

/** The options of a choose-list: a blank first, every value, then Other... */
export const chooseOptions = (values, current, blank = 'Choose…') =>
  options([['', blank], ...values.map(v => [v, v]), [OTHER, 'Other…']], current || '');

/** Options in groups: [[label, values]], each value its own label. */
export const groupOptions = (groups, current) => groups.map(([label, values]) => html`<optgroup label="${label}">${options(values.map(v => [v, v]), current)}</optgroup>`);

/** A choose-list in groups: a blank first, the groups, then Other... */
export const chooseGroups = (groups, current, blank = 'Choose…') =>
  html`${options([['', blank]], current || '')}${groupOptions(groups, current || '')}${options([[OTHER, 'Other…']], current || '')}`;

/** The value of a changed choose-list; null when "Other..." was chosen and nothing was typed (the list then snaps back). */
export function chosenValue(el, what = 'value') {
  if (el.value !== OTHER) return el.value.trim();
  const typed = (typeof prompt === 'function' ? prompt(`Type the new ${what}:`) : '') || '';
  return typed.trim() || null;
}
