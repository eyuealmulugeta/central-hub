// Single derivation step. Raw state goes in; every module's view of it comes
// out. Views never store computed values, so a change anywhere (a daily report,
// a unit price, an exchange rate) is reflected everywhere on the next render.

import { schedule } from '../engine/gantt.js';
import { buildBOM } from '../engine/bom.js';
import { priceBOM } from '../engine/pricing.js';
import { summarize } from '../engine/ledger.js';
import { billingState } from '../engine/billing.js';
import { buildFlags } from '../engine/followups.js';
import { calendarOf } from '../engine/calendar.js';

export function derive(project, ws, global, today) {
  const sched = schedule(ws.tasks, ws.reports, { today, workDays: calendarOf(project, ws.reports) });
  const bom = buildBOM(ws.assemblies);
  const boq = priceBOM(bom, project, global);
  const led = summarize(ws, project, global, sched);
  const bill = billingState({ project, ws, sched });
  const flags = buildFlags({ project, ws, sched, boq, led, bill, today });
  return { project, ws, global, today, sched, bom, boq, led, bill, flags };
}
