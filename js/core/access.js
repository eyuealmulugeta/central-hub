// Who may open which page. The Admin (the Owner) opens everything and is the
// only one who may delete records or change settings. Everyone else opens the
// pages the Admin has ticked for them. firestore.rules enforces the same lines
// in the database, so keep the two in step.

/** Pages of one construction project. */
export const PROJECT_PAGES = ['dashboard', 'reports', 'schedule', 'ledger', 'docs', 'evaluation', 'requests', 'cashflow', 'payments'];
/** Pages of the trading side: buying, shipping, stock and sales. */
export const TRADING_PAGES = ['trade', 'stock'];
/** Pages about the whole company. */
export const COMPANY_PAGES = ['finance', 'contracts'];
/** Admin only, always. */
/** The five Settings pages, in menu order. */
export const SETTINGS_PAGES = ['apps', 'prices', 'access', 'catalog', 'company', 'links'];
export const ADMIN_PAGES = ['hr', 'letters', 'payroll', 'setup', 'owners', 'notifications', ...SETTINGS_PAGES];   // notifications: v0.23.0

/** What the Admin can grant to anyone but the Admin (Office and Site alike), in groups. 'trade' covers both trading pages. */
export const GRANT_GROUPS = [
  ['Projects', [['dashboard', 'Overview'], ['reports', 'Daily report'], ['schedule', 'Schedule'], ['requests', 'Requests'], ['evaluation', 'Evaluation'], ['directory', 'Staff directory']]],
  ['Communication', [['meetings', 'Meetings'], ['contacts', 'Contacts']]],
  ['Money', [['ledger', 'Costs'], ['cashflow', 'Cash flow'], ['payments', 'Payments'], ['docs', 'Invoices and documents'], ['finance', 'Company finance']]],
  ['Contracts and trading', [['contracts', 'Contracts'], ['trade', 'Trading']]],
];
export const GRANTABLE = GRANT_GROUPS.flatMap(([, list]) => list);
const ALL = GRANTABLE.map(([k]) => k);
/** What a role opens until the Admin ticks pages for the person. Must match pages() in firestore.rules. */
// Payments (pay of the crew) is never there by default: the Admin ticks it for the people who handle it.
export const ROLE_PAGES = { office: ALL.filter(k => k !== 'evaluation' && k !== 'payments'), site: ['dashboard', 'reports', 'schedule', 'requests', 'directory'] };
// Pages that came with the role, not with a tick, before every role had ticks (v0.15.0): an older record keeps them.
const CAME_WITH_OFFICE = ['meetings', 'contacts', 'directory'];

/** A person who signs in to Installation works on the projects only: the Trading pages are never theirs. */
const inInstallation = user => user?.role !== 'owner' && (user?.divisions || [])[0] === 'installation';
/** The pages the Admin can tick for this person. */
export const grantableFor = user => GRANTABLE.filter(([k]) => !(inInstallation(user) && TRADING_PAGES.includes(k)) && !(user?.role === 'site' && k === 'payments'));

/** What a person starts with: the pages of their role, and Evaluation when their title rates someone. */
export const defaultPages = user => [...ROLE_PAGES[user?.role === 'office' ? 'office' : 'site'], ...(user?.ranks?.length ? ['evaluation'] : [])];

/**
 * The pages a person (a users/<email> record) may open. Once the Admin ticks pages for someone the record holds
 * them all (`pages` with `pagesV: 2`); an older record is read the way it was meant before.
 */
export function pagesOf(user) {
  const ranked = user?.ranks?.length ? ['evaluation'] : [];
  const list = user?.pagesV === 2 && Array.isArray(user.pages) ? user.pages
    : user?.role === 'site' ? defaultPages(user)
    : Array.isArray(user?.pages) ? [...user.pages, ...CAME_WITH_OFFICE, ...ranked]
    : defaultPages(user);
  return grantableFor(user).map(([k]) => k).filter(k => list.includes(k));
}
/** The record change that ticks (on) or unticks one page for a person. */
export function tickPage(user, page, on) {
  const now = pagesOf(user).filter(k => k !== page);
  if (on) now.push(page);
  return { pages: grantableFor(user).map(([k]) => k).filter(k => now.includes(k)), pagesV: 2 };
}

// A page that is a second way into another screen is allowed by what allows that screen (see core/nav.js).
const PERM = { stock: 'trade', invoices: 'docs', quotations: 'docs', status: 'docs', income: 'ledger', expenses: 'ledger', attendance: 'reports', crewletters: 'letters', employment: 'hr', documentsign: 'contracts', summary: 'finance', tradesummary: 'finance' };
export const permKey = page => PERM[page] || page;
const key = permKey;

/** May someone with `role` and granted `pages` open `page`? */
export function mayOpen(role, pages, page) {
  if (page === 'directory') return role !== 'owner' && pages.includes('directory');   // the staff directory is for those without the employee records
  if (role === 'owner' || page === 'home' || page === 'discuss') return true;   // Home and Discuss show each person only their own sections
  if (ADMIN_PAGES.includes(permKey(page))) return false;
  return pages.includes(key(page));
}

/** Money records (costs, invoices, billing terms) are loaded only for people who have a page that shows them. */
export const MONEY_PAGES = ['ledger', 'cashflow', 'payments', 'docs', 'finance'];
export const MONEY_SECTIONS = ['ledger', 'docs', 'payStages', 'measure', 'billRates', 'payruns', 'payments', 'paycosts', 'crewRates', 'laborRates'];
export const seesMoney = (role, pages) => role === 'owner' || ((role === 'office' || role === 'site') && MONEY_PAGES.some(p => pages.includes(p)));
/**
 * Pay of named people: day rates, trade rates, pay runs, payments and their labour costs. The Admin, and Office people
 * with Costs or Payments ticked; never Site, whatever is ticked. Must match isPay() in firestore.rules.
 */
export const PAY_SECTIONS = ['payruns', 'payments', 'paycosts', 'crewRates', 'laborRates'];
export const PAY_PAGES = ['ledger', 'payments'];
export const seesPay = (role, pages) => role === 'owner' || (role === 'office' && PAY_PAGES.some(p => pages.includes(p)));

/** Records of documents sent for signature: they go with the Contracts page. */
const SIGN_SECTIONS = ['signs', 'signkeys', 'signed'];
/** Records of the booking page: the Meetings page of the office. */
const MEET_SECTIONS = ['slots', 'bookings', 'meetings'];

/** Which company-wide sections a person loads. */
export function companySections(role, pages) {
  if (role === 'owner') return ['shipments', 'sales', 'contracts', 'contacts', 'staff', 'letters', 'payroll', 'owners', 'messages', 'evaluations', ...SIGN_SECTIONS, ...MEET_SECTIONS];
  if (role !== 'office' && role !== 'site') return ['messages'];
  return [
    'messages', ...(pages.includes('contacts') ? ['contacts'] : []), ...(pages.includes('meetings') ? MEET_SECTIONS : []),
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
    { page: 'meetings', name: 'Meetings', does: 'Meetings with colleagues, scheduled here, and the booking page where clients and suppliers pick a free time' },
  ] },
  { group: 'Projects', about: 'Running each construction job', apps: [
    { page: 'dashboard', name: 'Overview', does: 'Progress, forecast finish, alerts and follow-ups for one project', fixed: true },
    { page: 'reports', name: 'Daily report', does: 'Site reports from Field Report or typed here, confirmed by the office' },
    { page: 'schedule', name: 'Schedule', does: 'Tasks, dependencies and a plan that moves with the daily reports' },
    { page: 'requests', name: 'Requests', does: 'Material, manpower and equipment asked for by the site, approved by the office, with a follow-up when approved' },
    { page: 'evaluation', name: 'Evaluation', does: 'Each rank rates the one below it, 1 to 5, and writes feedback on the day. Seen only by who wrote it and the Admin' },
  ] },
  { group: 'Trading', about: 'Buying, shipping and selling goods', apps: [
    { page: 'trade', name: 'Shipments', does: 'Orders on the way, freight and duties, landed cost per unit' },
    { page: 'stock', name: 'Stock and sales', does: 'What is in stock, what was sold, and the profit on each sale' },
  ] },
  { group: 'Finance', about: 'Money in and out', apps: [
    { page: 'ledger', name: 'Costs', does: 'What each project has spent and received, with labour from the reports' },
    { page: 'payments', name: 'Payments', does: 'Pay of the site crew per week, two weeks or month from the Attendance sheet: earned, paid and still owed; each payment is a labour cost' },
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
