// The menu. Two divisions, Installation and Trading, each with its own sections. In Installation the sections
// work on the open project (Project, Reports, People, Money, Documents); in Trading they cover buying,
// shipping and selling. A section is one row of pages along the top.
//
// A page id normally names one screen. An ALIAS is a second way into a screen that is already there, opened
// with a preset (for example Invoices is the documents screen showing only invoices), so a screen can appear
// wherever the menu wants it. Pure data and functions; main.js draws it and access.js decides who may open what.

export const DIVISIONS = [['installation', 'Installation'], ['trading', 'Trading']];
export const divisionLabel = id => DIVISIONS.find(([k]) => k === id)?.[1] || id;

/**
 * alias id -> { view: the screen that draws it, title, preset: what it is opened with, switch: the project page
 * a project can switch off to take it away }. A page with no entry here is its own screen.
 */
export const ALIASES = {
  status: { view: 'docs', title: 'Status report', preset: { mode: 'status' }, switch: 'docs' },
  invoices: { view: 'docs', title: 'Invoices', preset: { mode: 'invoices' }, switch: 'docs' },
  quotations: { view: 'docs', title: 'Quotations', preset: { mode: 'quotations' }, switch: 'docs' },
  income: { view: 'ledger', title: 'Income', preset: { only: 'income' }, switch: 'ledger' },
  expenses: { view: 'ledger', title: 'Expenses', preset: { only: 'expense' }, switch: 'ledger' },
  summary: { view: 'finance', title: 'Summary report', preset: { part: 'construction' } },
  tradesummary: { view: 'finance', title: 'Trading summary', preset: { part: 'trading' } },
  crewletters: { view: 'letters', title: 'Letters' },
  employment: { view: 'employment', title: 'Agreement' },
  documentsign: { view: 'signatures', title: 'Document sign' },
  attendance: { view: 'attendance', title: 'Attendance sheet', switch: 'reports' },
};

/** Old addresses (links, alerts, bookmarks) that now belong to a page of the new menu. */
export const REDIRECT = { docs: 'invoices', finance: 'summary' };

export const baseOf = page => ALIASES[page]?.view || page;
/** The project page that a project switches off to hide this page. */
export const switchOf = page => ALIASES[page]?.switch || baseOf(page);
export const resolve = page => REDIRECT[page] || page;

// v0.22.0 (Hub 2, docs/plan-hub-makeover.md): the menu by job, not by department. Today first, then the open
// project's work, and the Team pages (Discuss, Meetings, Settings) at the foot of the menu (`team: true`).
const today = { id: 'home', label: 'Today', icon: 'home', tabs: ['home', 'notifications'] };   // v0.23.0: Notifications, the Admin's
const team = [
  { id: 'discuss', label: 'Discuss', icon: 'discuss', tabs: ['discuss'], team: true },
  { id: 'meetings', label: 'Meetings', icon: 'meetings', tabs: ['meetings'], team: true },
  { id: 'settings', label: 'Settings', icon: 'prices', tabs: ['mine', 'apps', 'prices', 'access', 'catalog', 'company', 'links', 'bin'], team: true },
];

export const MENUS = {
  // Today > the open project: Project, Reports, People, Money, Documents > Team
  installation: [
    today,
    { id: 'projects', label: 'Project', icon: 'dashboard', tabs: ['dashboard', 'schedule', 'setup'] },
    { id: 'report', label: 'Reports', icon: 'reports', tabs: ['reports', 'status', 'attendance'] },
    { id: 'crew', label: 'People', icon: 'hr', tabs: ['hr', 'employment', 'crewletters', 'evaluation', 'directory', 'payroll'] },
    { id: 'finance', label: 'Money', icon: 'finance', tabs: ['ledger', 'invoices', 'quotations', 'payments', 'cashflow', 'income', 'expenses', 'summary'] },
    { id: 'admin', label: 'Documents', icon: 'contracts', tabs: ['contracts', 'documentsign', 'letters', 'requests', 'contacts', 'owners'] },
    ...team,
  ],
  trading: [
    today,
    { id: 'trading', label: 'Trading', icon: 'trade', tabs: ['trade', 'stock'] },
    { id: 'crew', label: 'People', icon: 'hr', tabs: ['hr', 'employment', 'crewletters', 'payroll'] },
    { id: 'finance', label: 'Money', icon: 'finance', tabs: ['tradesummary'] },
    { id: 'admin', label: 'Documents', icon: 'contracts', tabs: ['contracts', 'documentsign', 'letters', 'contacts', 'owners'] },
    ...team,
  ],
};

/** The phone's five tabs (v0.22.0): Today, Project (Trading in the trading division), Reports, Money, and More for everything else. */
export const PHONE_TABS = [['home', 'Today'], ['projects', 'Project'], ['trading', 'Trading'], ['report', 'Reports'], ['finance', 'Money']];

export const hubsOf = division => MENUS[division] || MENUS.installation;
export const pagesIn = division => hubsOf(division).flatMap(h => h.tabs);

/**
 * The divisions a person works in. The Admin and the co-owners see both. Everyone else signs in to one department:
 * the one the Admin chose (the first, if an older record lists two). With none chosen the list is empty, and
 * nobody comes in until the Admin assigns one.
 */
export const divisionsOf = user => {
  if (!user?.role || user.role === 'owner') return DIVISIONS.map(([k]) => k);
  return (user.divisions || []).filter(d => DIVISIONS.some(([k]) => k === d)).slice(0, 1);
};

/**
 * Which division a page belongs to for this person: the current one when it is there, otherwise the first of
 * their divisions that has it. Null when none of their divisions has the page.
 */
export function divisionFor(page, current, mine) {
  if (mine.includes(current) && pagesIn(current).includes(page)) return current;
  return mine.find(d => pagesIn(d).includes(page)) || null;
}
