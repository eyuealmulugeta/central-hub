// Tiny templating layer: html`` escapes every interpolated value unless it is
// itself the result of html`` (or an array of them).

import { clamp } from '../core/util.js';
import { MARKS } from './icons.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESCAPES[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const render = v => (v == null || v === false ? ''
  : v instanceof Safe ? v.s
  : Array.isArray(v) ? v.map(render).join('')
  : esc(v));

export const html = (strings, ...values) =>
  new Safe(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''));

/** options([[value, label], ...], selectedValue) */
export const options = (list, selected) => list.map(([value, label]) =>
  html`<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`);

/** Typed value of a form control. */
export const field = el => (el.type === 'checkbox' ? el.checked
  : el.type === 'number' ? (el.value === '' ? 0 : +el.value)
  : el.value);

export const meter = (pct, cls = '') =>
  html`<div class="meter ${cls}"><i style="width:${clamp(pct || 0, 0, 100)}%"></i></div>`;

export const chip = (text, cls = '') => html`<span class="chip ${cls}">${text}</span>`;

/** An app icon by name, in the brand tones (see icons.js). `size` is in pixels. */
export const icon = (name, size = 22) =>
  new Safe(`<svg class="ico" viewBox="0 0 24 24" width="${+size}" height="${+size}" aria-hidden="true">${MARKS[name] || ''}</svg>`);
