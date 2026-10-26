// Data model. Everything is plain JSON so it can live in localStorage today
// and move to a server database later without reshaping (see docs/ARCHITECTURE.md).

/**
 * Shared by every project (key `sf:global`).
 * @typedef {Object} Global
 * @property {{base: string, rates: Object<string, number>}} fx   units of each currency per 1 base unit
 * @property {Region[]} regions
 * @property {Material[]} materials
 * @property {Object<string, Object<string, {price: number, currency: string}>>} prices  [regionId][materialId]
 *
 * @typedef {{id: string, name: string, currency: string}} Region
 * @typedef {{id: string, name: string, unit: string, category: string, waste: number, leadDays: number}} Material
 */

/**
 * Project index (key `sf:meta`). Holds settings only, never operational data.
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {'steel'|'container'} type
 * @property {string} regionId      selects the price column
 * @property {string} currency      reporting currency for ledger, BOQ and dashboard
 * @property {number[]} workDays    weekday numbers worked, 0 = Sunday
 * @property {number} budget
 * @property {number} contractValue
 * @property {{overhead: number, contingency: number, profit: number, vat: number}} markups  percentages
 * @property {{name: string, address: string, contact: string, taxId: string}} [client]
 * @property {{method: string, retention: number, paymentDays: number, otMultiplier: number, hoursPerDay: number}} [billing]
 *           see engine/billing.js METHODS
 */

/**
 * One project's operational data (key `sf:ws:<projectId>`). Nothing in here
 * references another project, which is what keeps workspaces isolated.
 * @typedef {Object} Workspace
 * @property {Task[]} tasks
 * @property {Report[]} reports
 * @property {LedgerEntry[]} ledger
 * @property {Assembly[]} assemblies
 * @property {ActionItem[]} items
 * @property {Object<string, {status: 'not_ordered'|'ordered'|'delivered', eta?: string, taskId?: string, ledgerId?: string}>} procurement
 *           by materialId; taskId overrides which task the material is needed for; ledgerId links the posted cost
 * @property {Object<string, number>} laborRates  day rate per trade, in project currency
 * @property {{id: string, name: string, role: string, contact: string}[]} team  people on this project
 * @property {Object[]} trash  the recycle bin: deleted field reports kept 30 days (see engine/trash.js)
 * @property {Request[]} requests  material, manpower and equipment asked for by the site (see engine/requests.js)
 * @property {Doc[]} docs            invoices, quotations and purchase orders (frozen snapshots)
 * @property {{id: string, name: string, taskId: string, value: number}[]} payStages  milestone billing: value is a % or an amount
 * @property {{id: string, description: string, unit: string, contractQty: number, rate: number, doneQty: number}[]} measure  admeasurement items
 * @property {Object<string, number>} billRates   client day rate per trade (day-rate billing)
 *
 * @typedef {Object} Doc
 * @property {string} id
 * @property {'invoice'|'quote'|'po'|'report'} type   'report' = client progress report: kind, data (snapshot), remarks, approvedBy, approvedAt
 * @property {string} number         e.g. INV-MOD-001
 * @property {string} date
 * @property {string} due            due date, validity date or delivery date
 * @property {string} status         draft, sent, then paid / accepted / delivered; a report goes draft, issued
 * @property {{name: string, address: string, contact: string, taxId: string}} party  client or supplier
 * @property {{description: string, qty: number, unit: string, rate: number, amount: number, stageId?: string, measureId?: string, materialId?: string, group?: string}[]} lines
 * @property {{from: string, to: string}|null} period   day-rate invoices only
 * @property {number} subtotal
 * @property {number} vat
 * @property {number} total
 * @property {number} retention
 * @property {number} amountDue
 * @property {string} [ledgerId]     the "payment received" entry once paid
 *
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} name
 * @property {string} start          planned earliest start (ISO date)
 * @property {number} duration       working days
 * @property {boolean} [milestone]
 * @property {string} [assigneeId]   id of a team member
 * @property {number} [totalQty]     total work volume; when set, progress = installed quantity / totalQty
 * @property {string} [unit]         unit of that volume (pcs, m², t)
 * @property {{id: string, lag?: number}[]} deps   finish-to-start predecessors, lag in working days
 *
 * @typedef {Object} Report
 * @property {string} id
 * @property {string} date
 * @property {string} by
 * @property {string} weather
 * @property {{trade: string, count: number}[]} manpower
 * @property {{taskId: string, progress: number|null, qty?: number, delayDays: number, note: string}[]} entries
 *           qty = units installed that day, for tasks with a total quantity
 * @property {string} [issue]
 *
 * @typedef {Object} LedgerEntry
 * @property {string} id
 * @property {string} date
 * @property {'expense'|'income'} type
 * @property {string} category
 * @property {string} description
 * @property {number} amount
 * @property {string} currency
 * @property {string} [vendor]
 *
 * @typedef {Object} Assembly
 * @property {string} id
 * @property {string} templateId     key into engine/bom.js TEMPLATES
 * @property {string} name
 * @property {Object} params
 * @property {string} [taskId]       task that needs this material on site
 *
 * @typedef {Object} ActionItem
 * @property {string} id
 * @property {'approval'|'site_request'|'material'|'other'} type
 * @property {string} title
 * @property {string} owner
 * @property {string} created
 * @property {string} [due]
 * @property {'open'|'closed'} status
 * @property {number} remindEvery    days between reminders, 0 = never
 * @property {string} [lastReminded]
 */

/** @returns {Workspace} */
export const emptyWorkspace = () => ({
  tasks: [], reports: [], ledger: [], assemblies: [], items: [], procurement: {}, laborRates: {}, team: [],
  // pay kept apart so only those who see pay read it (0.18.0): day rate per team member, the labour cost of each crew payment
  crewRates: [], paycosts: [],
  docs: [], payStages: [], measure: [], billRates: {}, requests: [], trash: [],
  attendance: [],   // the office's corrections of the attendance sheet (see engine/attendance.js)
  payruns: [],      // Payments: one record per pay period that was worked on, approved or paid (see engine/crewpay.js)
  payments: [],     // Payments: what was paid to whom, for which period (each is also a labour cost in ledger)
  reportfiles: [],  // the Drive ids of each Field Report PDF ({ id: report id, pdfId, folderId }); never read by Site (v0.22.6)
});

/**
 * Records that belong to the company rather than to one project.
 * Stored like a workspace: one document per record under company/main/<section>.
 */
export const emptyCompany = () => ({
  shipments: [],
  sales: [],      // goods sold out of stock shipments
  staff: [],      // HR records: Owner only
  contracts: [],  // agreements with clients, suppliers and subcontractors
  messages: [],   // Discuss: { id, channel, by, name, text, at }
  signs: [],      // documents sent for signature (see engine/sign.js)
  signkeys: [],   // the signers' keys, for the office to hand out the links again
  signed: [],     // the signatures: written by the signer's page, never changed
  slots: [],      // times taken on the booking page (see engine/booking.js): no names, anyone reads them
  bookings: [],   // who booked a meeting: written by the booking page, read by the office
  meetings: [],   // meetings with colleagues: { id, title, start, minutes, where, note, invitees: [{ email, name }], by, byName, status, division }
  contacts: [],   // email addresses and phone numbers documents are sent to (see engine/contacts.js): the office and the Admin
  owners: [],     // the owners of the company (see engine/owners.js): kept apart from the employees, Admin only
  payroll: [],    // one run a month (see engine/payroll.js): Admin only, built from HR pay
  letters: [],    // letters of the office (see engine/letters.js): Admin only, built from HR records
  evaluations: [], // crew evaluations and feedback notes (see engine/evaluation.js): read only by their author and the Admin
});
/** Company sections only the Owner may read or write. Must match firestore.rules. */
export const OWNER_SECTIONS = ['staff', 'letters', 'payroll', 'owners'];
/** Sections whose records are also written by people who are not signed in (a signer, a visitor booking a meeting). The office never re-stamps them. */
export const PUBLIC_SECTIONS = ['signed', 'slots', 'bookings'];

export const DEFAULT_MARKUPS = { overhead: 8, contingency: 5, profit: 12, vat: 15 };
