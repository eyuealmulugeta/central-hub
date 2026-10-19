// Who may open which page. The Admin (the Owner) opens everything and is the
// only one who may delete records or change settings. Everyone else opens the
// pages the Admin has ticked for them. firestore.rules enforces the same lines
// in the database, so keep the two in step.

/** Pages of one construction project. */
export const PROJECT_PAGES = ['dashboard', 'reports', 'schedule', 'ledger', 'estimator', 'docs', 'evaluation', 'requests', 'cashflow'];
/** Pages of the trading side: buying, shipping, stock and sales. */
export const TRADING_PAGES = ['trade', 'stock'];
/** Pages about the whole company. */
export const COMPANY_PAGES = ['finance', 'contracts'];
/** Admin only, always. */
/** The five Settings pages, in menu order. */
export const SETTINGS_PAGES = ['apps', 'prices', 'access', 'catalog', 'company', 'links'];
export const ADMIN_PAGES = ['hr', 'letters', 'payroll', 'setup', 'owners', ...SETTINGS_PAGES];

/** What the Admin can grant to an Office user. 'trade' covers both trading pages. */
export const GRANTABLE = [
  ['dashboard', 'Overview'], ['reports', 'Daily report'], ['schedule', 'Schedule'], ['ledger', 'Costs'], ['cashflow', 'Cash flow'], ['estimator', 'Estimate'],
  ['docs', 'Invoices and documents'], ['requests', 'Requests'], ['trade', 'Trading'], ['finance', 'Company finance'], ['contracts', 'Contracts'],
];
const ALL = GRANTABLE.map(([k]) => k);
/** What a role opens when the Admin has not chosen pages for the person. Must match firestore.rules. */
export const ROLE_PAGES = { office: ALL, site: ['dashboard', 'reports', 'schedule', 'requests'] };

/** The pages a person (a users/<email> record) may open. A Site user is always limited to the site pages. */
export function pagesOf(user) {
  // Evaluation is not a page the Admin ticks: whoever holds a rank (users/<email>.ranks) has it
  const ranked = user?.ranks?.length ? ['evaluation'] : [];
  if (user?.role === 'site') return [...ROLE_PAGES.site, ...ranked];
  return [...(Array.isArray(user?.pages) ? user.pages.filter(p => ALL.includes(p)) : ROLE_PAGES.office), ...ranked];
}

// A page that is a second way into another screen is allowed by what allows that screen (see core/nav.js).
const PERM = { stock: 'trade', invoices: 'docs', quotations: 'docs', status: 'docs', income: 'ledger', expenses: 'ledger', attendance: 'reports', crewletters: 'letters', employment: 'hr', documentsign: 'contracts', summary: 'finance', tradesummary: 'finance' };
export const permKey = page => PERM[page] || page;
const key = permKey;

/** May someone with `role` and granted `pages` open `page`? */
export function mayOpen(role, pages, page) {
  if (role === 'owner' || page === 'home' || page === 'discuss') return true;   // Home and Discuss show each person only their own sections
  if (page === 'meetings' || page === 'contacts') return role === 'office';   // booked meetings and the address book are the office's, not the site's
  if (ADMIN_PAGES.includes(permKey(page))) return false;
  return pages.includes(key(page));
}

/** Money records (costs, invoices, billing terms) are loaded only for people who have a page that shows them. */
export const MONEY_PAGES = ['ledger', 'cashflow', 'docs', 'finance'];
export const MONEY_SECTIONS = ['ledger', 'docs', 'payStages', 'measure', 'billRates'];
export const seesMoney = (role, pages) => role === 'owner' || (role === 'office' && MONEY_PAGES.some(p => pages.includes(p)));

/** Records of documents sent for signature: they go with the Contracts page. */
const SIGN_SECTIONS = ['signs', 'signkeys', 'signed'];
/** Records of the booking page: the Meetings page of the office. */
const MEET_SECTIONS = ['slots', 'bookings'];

/** Which company-wide sections a person loads. */
export function companySections(role, pages) {
  if (role === 'owner') return ['shipments', 'sales', 'contracts', 'contacts', 'staff', 'letters', 'payroll', 'owners', 'messages', 'evaluations', ...SIGN_SECTIONS, ...MEET_SECTIONS];
  if (role !== 'office') return ['messages'];
  return [
    'messages', 'contacts', ...MEET_SECTIONS,
    ...(pages.includes('trade') || pages.includes('finance') ? ['shipments', 'sales'] : []),
    ...(pages.includes('contracts') ? ['contracts', ...SIGN_SECTIONS] : []),
  ];
}

/**
 * Every app of Central Hub, grouped the way the menu is. The Admin switches whole apps on or off
 * for the company under Settings, Apps. `page` is the app's page; an app that is off is hidden
 * from everyone, and its records are kept.
 */
export const APPS = [
  { group: 'Communication', about: 'Talking to each other', apps: [
    { page: 'discuss', name: 'Discuss', does: 'Messages between the people of Amistad: one channel for everyone and one per project' },
    { page: 'contacts', name: 'Contacts', does: 'Email addresses and phone numbers saved once, found by name, and who each project\'s documents go to' },
    { page: 'meetings', name: 'Meetings', does: 'A booking page for clients and suppliers: they pick a free time, you see it here' },
  ] },
  { group: 'Projects', about: 'Running each construction job', apps: [
    { page: 'dashboard', name: 'Overview', does: 'Progress, forecast finish, alerts and follow-ups for one project', fixed: true },
    { page: 'reports', name: 'Daily report', does: 'Site reports from Field Report or typed here, confirmed by the office' },
    { page: 'schedule', name: 'Schedule', does: 'Tasks, dependencies and a plan that moves with the daily reports' },
    { page: 'estimator', name: 'Estimate', does: 'Quantities, material prices by country, and what to order when' },
    { page: 'requests', name: 'Requests', does: 'Material, manpower and equipment asked for by the site, approved by the office, with a follow-up when approved' },
    { page: 'evaluation', name: 'Evaluation', does: 'Each rank rates the one below it, 1 to 5, and writes feedback on the day. Seen only by who wrote it and the Admin' },
  ] },
  { group: 'Trading', about: 'Buying, shipping and selling goods', apps: [
    { page: 'trade', name: 'Shipments', does: 'Orders on the way, freight and duties, landed cost per unit' },
    { page: 'stock', name: 'Stock and sales', does: 'What is in stock, what was sold, and the profit on each sale' },
  ] },
  { group: 'Finance', about: 'Money in and out', apps: [
    { page: 'ledger', name: 'Costs', does: 'What each project has spent and received, with labour from the reports' },
    { page: 'cashflow', name: 'Cash flow', does: 'Money in and out month by month, and the next months forecast from invoices still to be paid and payroll' },
    { page: 'docs', name: 'Invoices and documents', does: 'Invoices, quotations, purchase orders and client reports, by email as PDF' },
    { page: 'finance', name: 'Company finance', does: 'Every project and the trading side in one currency' },
  ] },
  { group: 'People and contracts', about: 'Agreements and staff', apps: [
    { page: 'contracts', name: 'Contracts', does: 'Client and supplier agreements, with the dates that must not be missed' },
    { page: 'hr', name: 'HR', does: 'Staff, their agreements and papers, work history and ratings, and a printable profile sheet. Admin only' },
    { page: 'owners', name: 'Company owners', does: 'The owners of the company, their shares, passports and papers, kept apart from the employees. Admin only' },
    { page: 'payroll', name: 'Payroll', does: 'A run each month from the HR pay and the attendance on site: payroll sheet, payslips, CSV for the accountant. Admin only' },
    { page: 'letters', name: 'Letters', does: 'Employment and salary confirmations, experience certificates, warnings and introductions, printed or emailed as PDF. Admin only' },
  ] },
];
/** Is the app switched on for the company? Settings pages and Home cannot be switched off. */
export const appOn = (global, page) => !(global?.appsOff || []).includes(page);

/** Pages a project can switch off because they do not apply to it. Home always stays. */
export const SWITCHABLE = PROJECT_PAGES.filter(p => p !== 'dashboard');
export const pageOn = (project, page) => !(project?.off || []).includes(page);

// Things only the Admin may do, wherever the button or field is. Deleting is matched by name.
const DELETES = /^(remove|drop|delete)/;
const NOT_A_DELETE = new Set(['dropPack']);
const ADMIN_ONLY = {
  // billing terms are settings of the contract
  docs: new Set(['client', 'billing', 'contract', 'vat', 'stage', 'measure', 'billRate', 'copyMeasure']),
  reports: new Set(['clearField']),
};
/** True when `name` (a data-act, data-chg or data-form value on `page`) is reserved for the Admin. */
export const adminOnly = (page, name) => (DELETES.test(name) && !NOT_A_DELETE.has(name)) || !!ADMIN_ONLY[key(page)]?.has(name);
