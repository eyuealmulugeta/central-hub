// v1.89.0 (owner, 23 Nov, Release C step 2): which Settings page is shown, and the tab a "Do this" button asks for.
// Kept here, not in prices.js, so Settings can load the first time it is opened.
let section = 'prices', want = '';
export const setSection = s => { section = s; };
export const getSection = () => section;
/** Jump to the tab that holds a card (Setup's "Do this" buttons use the card's id). */
const PANEL_TAB = { project: 'basics', deploy: 'site', team: 'team', linked: 'team' };
export const openPanel = id => { if (PANEL_TAB[id]) want = PANEL_TAB[id]; };
export const takePanel = () => { const t = want; want = ''; return t; };
