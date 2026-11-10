// Who may open which page. The Admin (the Owner) opens everything and is the
// only one who may delete records or change settings. Everyone else opens the
// pages the Admin has ticked for them. firestore.rules enforces the same lines
// in the database, so keep the two in step.

/** Pages of one construction project. */
export const PROJECT_PAGES = ['dashboard', 'reports', 'schedule', 'ledger', 'docs', 'evaluation', 'requests', 'cashflow', 'payments'];
/** Pages of the trading side: buying, shipping, stock and sales. */
export const TRADING_PAGES = ['trade', 'stock', 'products', 'partners', 'deals'];   // deals: v1.21.0 (G10 T3)   // partners: v1.20.0 (G10 T2)   // products: v1.19.0 (G10 T1)
/** Pages about the whole company. */
export const COMPANY_PAGES = ['finance', 'contracts'];
/** Admin only, always. */
/** The five Settings pages, in menu order. */
export const SETTINGS_PAGES = ['mine', 'apps', 'prices', 'access', 'company', 'links', 'bin'];   // v1.39.0: Currency is in Company details
/** v0.24.0: Settings in two: My settings (everyone) and the Admin settings (the rest). */
export const MY_SETTINGS = ['mine'];
export const ADMIN_PAGES = ['hr', 'letters', 'payroll', 'setup', 'owners', 'notifications', 'spotlight', ...SETTINGS_PAGES.filter(k => !MY_SETTINGS.includes(k))];   // notifications: v0.23.0

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
/** v1.48.0 (owner R2): the GM (Office, rank general_manager) opens Payments, Employee data, Salary and Letters by default. */
export const GM_PAGES = ['payments', 'hr', 'payroll', 'letters'];
export const isGMRanks = (role, ranks = []) => role === 'office' && ranks.includes('general_manager');
export const ROLE_PAGES = { office: ALL.filter(k => k !== 'evaluation' && k !== 'payments'), site: ['dashboard', 'reports', 'schedule', 'requests', 'directory'] };
// Pages that came with the role, not with a tick, before every role had ticks (v0.15.0): an older record keeps them.
const CAME_WITH_OFFICE = ['meetings', 'contacts', 'directory'];

/** A person who signs in to Installation works on the projects only: the Trading pages are never theirs. */
const inInstallation = user => user?.role !== 'owner' && (user?.divisions || [])[0] === 'installation';
/** The pages the Admin can tick for this person. */
export const grantableFor = user => GRANTABLE.filter(([k]) => !(inInstallation(user) && TRADING_PAGES.includes(k)) && !(user?.role === 'site' && k === 'payments'));

/** v1.48.0 (owner R1): a NEW Office person starts without the money pages; the Admin ticks them. People already in keep theirs. */
export const newOfficePages = (ranks = []) => [...ROLE_PAGES.office.filter(k => !['ledger', 'cashflow', 'docs', 'finance', 'payments'].includes(k)), ...(ranks.length ? ['evaluation'] : [])];

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
const PERM = { workphotos: 'reports', weather: 'reports', usage: 'reports', purchases: 'ledger', sitestore: 'requests', siteinstr: 'reports', stock: 'trade', products: 'trade', partners: 'trade', deals: 'trade', invoices: 'docs', quotations: 'docs', status: 'docs', income: 'ledger', expenses: 'ledger', attendance: 'reports', crewletters: 'letters', employment: 'hr', documentsign: 'contracts', summary: 'finance', tradesummary: 'trade' };   // v1.23.0 (G10 T5, owner): everyone with Trading
export const permKey = page => PERM[page] || page;
const key = permKey;

/** May someone with `role` and granted `pages` open `page`? */
export function mayOpen(role, pages, page, ranks = []) {
  // v0.50.1: HR opens Spotlight and the office staff's attendance (names and positions only, never Employee data)
  if (page === 'spotlight' || page === 'officeatt') return role === 'owner' || ranks.includes('hr_assistant');
  if (page === 'excel' || page === 'zoho') return role === 'owner' || ranks.includes('general_manager');   // v1.18.0: and the Zoho export (G9)
  if (page === 'excel') return role === 'owner' || ranks.includes('general_manager');   // v1.9.0 (G7): the Admin and the GM (owner)
  if (page === 'engagement') return role === 'owner' || ranks.includes('general_manager');   // v1.7.0 (G3): the Admin and the GM only (owner)
  if (page === 'signins' || page === 'activity') return role === 'owner' || ['general_manager', 'owner', 'ceo', 'board_member'].some(r => ranks.includes(r));   // v0.98.0 (G2): the Admin and Tier 1
  if (page === 'datafeed') return role === 'owner' || role === 'office';   // v1.2.0 (G5): the Admin and Tier 1 all projects, the others their own
  if (page === 'outgoing') return role === 'owner' || role === 'office';   // v1.1.0 (G4): everyone in the office; each sees their own, Tier 1 all
  if (page === 'crewforms') return role === 'owner' || ranks.includes('general_manager');   // v0.41.0: crew form links: the Admin and the GM only
  if (page === 'logsheet') return role === 'owner' || (role === 'office' && pages.includes('docs'));   // v0.51.0: Office with Invoices and documents; Site never loads it
  if (page === 'master') return role === 'owner' || isGMRanks(role, ranks) || (role === 'office' && pages.includes('master'));   // v1.48.0 (M1–M4): Admin, GM, Executive (never ticked for others)
  if (isGMRanks(role, ranks) && GM_PAGES.includes(permKey(page))) return true;   // v1.48.0 (owner R2)
  if (page === 'peopleaccess') return role === 'owner' || (role === 'office' && ranks.includes('general_manager'));   // v1.47.0: People & Access, the Admin and the GM
  if (page === 'directory') return role === 'owner' || isGMRanks(role, ranks) || pages.includes('directory');   // v1.50.0: the GM manages access there   // v0.45.0: the Admin sees the Manpower Directory there, the others the staff directory
  if (role === 'owner' || page === 'home' || page === 'quick' || page === 'discuss' || MY_SETTINGS.includes(page)) return true;   // Home and Discuss show each person only their own sections
  if (ADMIN_PAGES.includes(permKey(page))) return false;
  return pages.includes(key(page));
}

/** Money records (costs, invoices, billing terms) are loaded only for people who have a page that shows them. */
export const MONEY_PAGES = ['ledger', 'cashflow', 'payments', 'docs', 'finance'];
export const MONEY_SECTIONS = ['ledger', 'docs', 'payStages', 'measure', 'billRates', 'payruns', 'payments', 'paycosts', 'crewRates', 'laborRates', 'bills'];
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
  if (role === 'owner') return ['shipments', 'sales', 'products', 'partners', 'deals', 'contracts', 'contacts', 'staff', 'letters', 'payroll', 'owners', 'logsheet', 'seals', 'sealLog', 'messages', 'evaluations', 'spotlight', 'officeAttendance', 'officeStaff', 'crewlinks', 'crewforms', ...SIGN_SECTIONS, ...MEET_SECTIONS];
  if (role !== 'office' && role !== 'site') return ['messages'];
  return [
    'messages', ...(role === 'office' ? ['seals'] : []),   // v0.53.0: Office adds the company stamp to what it prints
    ...(pages.includes('contacts') ? ['contacts'] : []), ...(pages.includes('meetings') ? MEET_SECTIONS : []),
    ...(pages.includes('trade') || pages.includes('finance') ? ['shipments', 'sales', 'products', 'partners', 'deals'] : []),
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
    { page: 'discuss', name: 'Discuss', does: 'Messages between the people of Amistad: one channel for everyone and one per project. Off here is off on the phones too' },
    { page: 'contacts', name: 'Contacts', does: 'Email addresses and phone numbers saved once, found by name, and who each project\'s documents go to' },
    { page: 'meetings', name: 'Meetings', does: 'Meetings with colleagues, scheduled here, and the booking page where clients and suppliers pick a free time' },
  ] },
  { group: 'Projects', about: 'Running each construction job', apps: [
    { page: 'dashboard', name: 'Follow-ups', does: 'Progress, forecast finish, alerts and follow-ups for one project', fixed: true },
    { page: 'reports', name: 'Daily report', does: 'Site reports from Field Report or typed here, confirmed by the office' },
    { page: 'schedule', name: 'Schedule', does: 'Tasks, dependencies and a plan that moves with the daily reports' },
    { page: 'requests', name: 'Requests', does: 'Material, manpower and equipment asked for by the site, approved by the office, with a follow-up when approved' },
    { page: 'evaluation', name: 'Evaluation', does: 'Tiers 1, 2 and 3 rate the tier below on the Excel form, 1 to 5, and write Spotlight notes. Seen only by who wrote it and the Admin' },
  ] },
  { group: 'Trading', about: 'Buying, shipping and selling goods', apps: [
    { page: 'trade', name: 'Shipments', does: 'Orders on the way, freight and duties, landed cost per unit' },
    { page: 'stock', name: 'Stock and sales', does: 'What is in stock, what was sold, and the profit on each sale' },
    { page: 'deals', name: 'Deals', does: 'Enquiry, quotation (GM approves), order, delivery, invoice and payment for each sale' },   // v1.21.0 (G10 T3)
    { page: 'partners', name: 'Partners', does: 'Customers and suppliers: what each bought or sold, what is owed both ways, statements' },   // v1.20.0 (G10 T2)
    { page: 'products', name: 'Products', does: 'The trading catalogue: what each product cost landed and sold for (no warehouse)' },   // v1.19.0 (G10 T1)
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
  // v1.14.0 (owner, 8 Nov): every page of the menu has its own switch, and so has every Field Report feature
  { group: 'Dashboard pages', about: 'The tabs of the Dashboard', apps: [
    { page: 'notifications', name: 'Notifications', does: 'Who is told what, by email and on the phone. Admin' },
    { page: 'signins', name: 'Sign-ins', does: 'Who signed in, when and on which device' },
    { page: 'activity', name: 'Activity', does: 'What each person did in Central Hub' },
    { page: 'outgoing', name: 'Outgoing', does: 'Emails and documents sent out' },
    { page: 'datafeed', name: 'Data tracker', does: 'Which project data is late, and who answers for it' },
  ] },
  { group: 'Project and report pages', about: 'The pages of Project and Reports', apps: [
    { page: 'setup', name: 'Project setup', does: 'Create and set up projects' },
    { page: 'status', name: 'Status report', does: 'The client status report' },
    { page: 'attendance', name: 'Attendance sheet', does: 'The crew attendance of the project' },
    { page: 'spotlight', name: 'Spotlight', does: 'Photos, videos and notes from site for Central Hub only' },
    { page: 'siteinstr', name: 'Site instructions', does: 'Instructions to the site, signed' },
    { page: 'sitestore', name: 'Site store', does: 'The store kept on Field Report, read only, Excel' },
    { page: 'usage', name: 'Materials used', does: 'Materials used against work done' },
    { page: 'workphotos', name: 'Work photos', does: 'Technicians\' photos from Field Report' },
  ] },
  { group: 'People pages', about: 'The pages of People', apps: [
    { page: 'crewforms', name: 'Crew forms', does: 'Links for new crew to fill in their details' },
    { page: 'employment', name: 'Agreement', does: 'Employment agreements' },
    { page: 'master', name: 'Master', does: 'The whole company on one read-only page: the Admin, the GM and the Executive', fixed: true },   // v1.48.0
    { page: 'directory', name: 'Manpower Directory', does: 'The one source of every person, with their Central Hub and Field Report ticks (the Admin and the GM): always on', fixed: true },
    { page: 'officeatt', name: 'Office attendance', does: 'Attendance of the office staff' },
  ] },
  { group: 'Money and document pages', about: 'The pages of Money and Documents', apps: [
    { page: 'invoices', name: 'Invoices', does: 'Invoices to clients' },
    { page: 'quotations', name: 'Quotations', does: 'Quotations to clients' },
    { page: 'purchases', name: 'Purchases', does: 'Purchase orders and the three-way check' },
    { page: 'summary', name: 'Summary report', does: 'The construction summary' },
    { page: 'excel', name: 'Excel link', does: 'Data to and from Excel' },
    { page: 'zoho', name: 'Zoho export', does: 'The UAE company\'s month for Zoho Books' },   // v1.18.0 (G9)
    { page: 'tradesummary', name: 'Trading summary', does: 'The trading summary' },
    { page: 'documentsign', name: 'Document sign', does: 'Documents sent for signature' },
    { page: 'logsheet', name: 'Log sheet', does: 'Equipment and vehicle log sheets' },
  ] },
  { group: 'Field Report', about: 'Features on the phones: off hides them on every phone within seconds', fr: true, apps: [
    { page: 'fr_report', name: 'Daily report', does: 'Write the daily report' },
    { page: 'fr_approve', name: 'Approve', does: 'Approve or send back a report on the phone' },
    { page: 'fr_crewphoto', name: 'Attendance and crew photo', does: 'The morning crew photo' },
    { page: 'fr_crew', name: 'Crew list', does: 'Names and trades sent from site' },
    { page: 'fr_spot', name: 'Spotlight', does: 'Photos, videos and notes for Central Hub' },
    { page: 'fr_requests', name: 'Requests', does: 'Materials, manpower, equipment' },
    { page: 'fr_hours', name: 'Crew and hours', does: 'Working hours and reminder' },
    { page: 'fr_review', name: 'Review tab', does: 'Reports and requests of the project' },
    { page: 'fr_penalty', name: 'Penalties', does: 'Penalties given on site' },
    { page: 'fr_quick', name: 'Quick tab', does: 'The + tab' },
    { page: 'fr_media', name: 'FR Dashboard', does: 'Photos and videos of all projects (GM)' },
    { page: 'fr_store', name: 'Store', does: 'The site store' },
    { page: 'fr_shots', name: 'Share work', does: 'Technicians\' work photos' },
    { page: 'fr_chat', name: 'Discuss', does: 'The Discuss tab on the phone; switches with Discuss in Central Hub' },
  ] },
];
/** v1.14.0: the Field Report features switched off, for the phones (public/fieldFeatures). */
export const frOff = global => (global?.appsOff || []).filter(k => k.startsWith('fr_'));
/** Is the app switched on for the company? Settings pages and Home cannot be switched off. */
export const appOn = (global, page) => !(global?.appsOff || []).includes(page);
/** v1.44.0 (owner, 9 Nov): one app in both places switches as one: Discuss in Central Hub is Discuss on the phones. */
export const TWINS = { discuss: 'fr_chat', fr_chat: 'discuss' };
/** Discuss is on only when neither half is switched off (the database and the server check the same). */
export const chatOn = global => appOn(global, 'discuss') && appOn(global, 'fr_chat');

/** Pages a project can switch off because they do not apply to it. Home always stays. */
export const SWITCHABLE = PROJECT_PAGES.filter(p => p !== 'dashboard');
// v0.25.0: "Pages this project uses" is gone from Settings: every project shows every page its people may open
export const pageOn = () => true;

// Things only the Admin may do, wherever the button or field is. Deleting is matched by name.
const DELETES = /^(remove|drop|delete)/;
const NOT_A_DELETE = new Set(['dropPack']);
const ADMIN_ONLY = {
  // billing terms are settings of the contract
  docs: new Set(['client', 'billing', 'contract', 'vat', 'stage', 'measure', 'billRate', 'copyMeasure']),
  reports: new Set(['clearField']),
  crewforms: new Set(['cfClose', 'cfAccept', 'cfReject', 'cfEditOn', 'cfEdit']),   // v0.34.0: edit and Add to pool too   // v0.33.0: reviewing forms is HR, the Admin's
};
/** True when `name` (a data-act, data-chg or data-form value on `page`) is reserved for the Admin. */
/** v0.26.0: is this handler a delete? Then what it takes away goes to the recycle bin. */
export const isDelete = name => DELETES.test(name) && !NOT_A_DELETE.has(name) && !BIN_ITSELF.has(name);
const BIN_ITSELF = new Set(['removeForGood', 'removeBin', 'removeBinAll']);
export const adminOnly = (page, name) => (DELETES.test(name) && !NOT_A_DELETE.has(name)) || !!ADMIN_ONLY[key(page)]?.has(name);
