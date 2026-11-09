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
  summary: { view: 'finance', title: 'Summary report', preset: { part: 'construction' } },
  tradesummary: { view: 'finance', title: 'Trading dashboard', preset: { part: 'trading' } },   // v1.23.0 (G10 T5)
  employment: { view: 'employment', title: 'Agreement' },
  documentsign: { view: 'signatures', title: 'Document sign' },
  attendance: { view: 'attendance', title: 'Attendance sheet', switch: 'reports' },
  spotlight: { view: 'reports', title: 'Spotlight', preset: { spot: true }, switch: 'reports' },   // v0.31.0; v0.50.1 the Admin and HR
  officeatt: { view: 'attendance', title: 'Office attendance', preset: { office: true } },   // v0.50.1: office staff, the Admin and HR
};

/** Old addresses (links, alerts, bookmarks) that now belong to a page of the new menu. */
// v1.39.0 (owner, 9 Nov: "remove them"): Income and Expenses are the In / Out switch of the Ledger, Crew letters is
// Letters, Engagement is in Sign-in history and Activity, holidays are the company calendar, Currency is in Company details
export const REDIRECT = { docs: 'invoices', finance: 'summary', income: 'ledger', expenses: 'ledger', crewletters: 'letters', engagement: 'activity', weather: 'reports', catalog: 'company' };

/**
 * v1.40.0 (owner, 9 Nov, R1): pages that do one job share one tab. The first page of a group is its tab in the row
 * along the top; the others are opened from a switch at the top of the page. Access is unchanged: each page keeps its own.
 */
export const GROUPS = {
  invoices: { label: 'Invoices & quotations', pages: [['invoices', 'Invoices'], ['quotations', 'Quotations']] },
  summary: { label: 'Money reports', pages: [['summary', 'Summary'], ['cashflow', 'Cash flow']] },
  contracts: { label: 'Agreements', pages: [['contracts', 'Agreements'], ['documentsign', 'Document sign']] },
};
/** The group a page belongs to ('' for none). */
export const groupOf = page => Object.keys(GROUPS).find(k => GROUPS[k].pages.some(([p]) => p === page)) || '';
/** The tabs drawn in a section's row: a page of a group is left out when its group's first page is there. */
export const rowTabs = tabs => tabs.filter(t => { const g = groupOf(t); return !g || g === t || !tabs.includes(g); });

export const baseOf = page => ALIASES[page]?.view || page;
/** The project page that a project switches off to hide this page. */
export const switchOf = page => ALIASES[page]?.switch || baseOf(page);
export const resolve = page => REDIRECT[page] || page;

// v0.22.0 (Hub 2, docs/plan-hub-makeover.md): the menu by job, not by department. Today first, then the open
// project's work, and the Team pages (Discuss, Meetings, Settings) at the foot of the menu (`team: true`).
const today = { id: 'home', label: 'Dashboard', icon: 'home', tabs: ['home', 'notifications', 'signins', 'activity', 'outgoing', 'datafeed'] };   // signins: v0.98.0; engagement: v1.7.0; activity: v0.99.0; outgoing: v1.1.0
// v0.92.0 (owner, 5 Nov, R2): Quick moved out of Today's tabs into the main menu
const quickHub = { id: 'quick', label: 'Quick', icon: 'apps', tabs: ['quick'] };   // quick: v0.35.0, the + tab   // v0.23.0: Notifications, the Admin's
const team = [
  { id: 'discuss', label: 'Discuss', icon: 'discuss', tabs: ['discuss'], team: true },
  { id: 'meetings', label: 'Meetings', icon: 'meetings', tabs: ['meetings'], team: true },
  { id: 'settings', label: 'Settings', icon: 'prices', tabs: ['mine', 'apps', 'prices', 'access', 'company', 'links', 'bin'], team: true },
];

// v1.22.2 (owner, 8 Nov: "in trading, installation settings, apps and features not related to trading should not be seen")
export const INSTALL_SETTINGS = ['prices', 'links'];   // This project; Field Report and import
const tradingTeam = team.map(h => (h.id === 'settings' ? { ...h, tabs: h.tabs.filter(t => !INSTALL_SETTINGS.includes(t)) } : h));

export const MENUS = {
  // Today > the open project: Project, Reports, People, Money, Documents > Team
  installation: [
    today,
    quickHub,
    { id: 'projects', label: 'Project', icon: 'dashboard', tabs: ['dashboard', 'schedule', 'setup'] },
    { id: 'report', label: 'Reports', icon: 'reports', tabs: ['reports', 'status', 'attendance', 'spotlight', 'siteinstr', 'sitestore', 'usage', 'workphotos'] },   // workphotos: v1.8.0   // siteinstr: v0.77.0
    { id: 'crew', label: 'People', icon: 'hr', tabs: ['hr', 'crewforms', 'employment', 'evaluation', 'directory', 'officeatt', 'payroll'] },   // crewforms: v0.33.0
    { id: 'finance', label: 'Money', icon: 'finance', tabs: ['ledger', 'invoices', 'quotations', 'payments', 'purchases', 'cashflow', 'summary', 'excel', 'zoho'] },   // excel: v1.9.0 (G7); zoho: v1.18.0 (G9)
    { id: 'admin', label: 'Documents', icon: 'contracts', tabs: ['contracts', 'documentsign', 'letters', 'logsheet', 'requests', 'contacts', 'owners'] },   // logsheet: v0.51.0
    ...team,
  ],
  trading: [
    today,
    quickHub,
    { id: 'trading', label: 'Trading', icon: 'trade', tabs: ['deals', 'trade', 'stock', 'products', 'partners'] },   // deals: v1.21.0 (G10 T3)   // products: v1.19.0 (G10 T1)
    { id: 'crew', label: 'People', icon: 'hr', tabs: ['hr', 'crewforms', 'employment', 'payroll'] },
    { id: 'finance', label: 'Money', icon: 'finance', tabs: ['tradesummary'] },
    { id: 'admin', label: 'Documents', icon: 'contracts', tabs: ['contracts', 'documentsign', 'letters', 'contacts', 'owners'] },
    ...tradingTeam,
  ],
};

/** The phone's five tabs (v0.22.0): Today, Project (Trading in the trading division), Reports, Money, and More for everything else. */
export const PHONE_TABS = [['home', 'Dashboard'], ['projects', 'Project'], ['trading', 'Trading'], ['report', 'Reports'], ['finance', 'Money']];

export const hubsOf = division => MENUS[division] || MENUS.installation;

/** v0.92.0: where each person keeps their own order of the menu (ids, comma separated; follows them to every device). */
export const MENU_ORDER = 'sf:menuOrder';
/** The menu in the person's order: the main items as they arranged them (new ones at the end), the Team items stay at the foot. */
export function arranged(list, order = []) {
  const main = list.filter(h => !h.team), pos = id => { const i = order.indexOf(id); return i < 0 ? 999 + main.findIndex(h => h.id === id) : i; };
  return [...[...main].sort((a, b) => pos(a.id) - pos(b.id)), ...list.filter(h => h.team)];
}
export const orderOf = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
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
