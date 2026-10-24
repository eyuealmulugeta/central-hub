// Installation and Trading are two separate businesses under one roof. A record that belongs to one of them
// carries `division`; a record with none belongs to Installation (everything made before the two were kept apart).
// A shipment needs no stamp: one for a project is Installation, one with no project is Trading. Sales are Trading.
//
// Every page is given a view of the company that holds only the open division's records (scopedCompany), so a page
// cannot mix the two by accident. Since 1D the database enforces it too: every record of a divided section carries
// its division explicitly (stampPlan gives the old ones theirs), an Office user's app asks only for its own division,
// and firestore.rules refuses the other division's records.

export const INSTALLATION = 'installation';
export const TRADING = 'trading';

let current = INSTALLATION;
export const currentDivision = () => current;
export const setCurrentDivision = d => { current = d === TRADING ? TRADING : INSTALLATION; };

/** The division of a record that carries `division`. */
export const divOf = record => (record?.division === TRADING ? TRADING : INSTALLATION);
/** The division of a shipment: by whether it is for a project. */
export const shipmentDivision = s => (s?.projectId ? INSTALLATION : TRADING);

/** The fields to put on a new record so that it belongs to the open division. */
export const stamp = () => ({ division: current });

/** Company sections whose records belong to one division. Owners, slots, messages and settings stay shared. */
export const DIVIDED = ['contracts', 'contacts', 'shipments', 'sales', 'bookings', 'meetings', 'signs', 'signkeys', 'staff', 'letters', 'payroll'];

/** The division a record of `section` belongs to, from what it says, or what it was before 1D. Pure. */
export function divisionOfRecord(section, r, company = {}) {
  if (r?.division === TRADING || r?.division === INSTALLATION) return r.division;
  if (section === 'shipments') return shipmentDivision(r);
  if (section === 'sales') return TRADING;
  if (section === 'signs' || section === 'signkeys') {
    const req = section === 'signs' ? r : (company.signs || []).find(s => s.id === r?.id);
    const contract = (company.contracts || []).find(k => k.id === req?.contractId);
    return contract ? divOf(contract) : INSTALLATION;
  }
  return INSTALLATION;
}

/** The records that do not say their division yet, with the division they get. Pure. */
export function stampPlan(company) {
  const out = [];
  for (const section of DIVIDED) {
    for (const r of company[section] || []) {
      if (!r?.id || r.division === TRADING || r.division === INSTALLATION) continue;
      out.push({ section, id: r.id, data: { ...r, division: divisionOfRecord(section, r, company) } });
    }
  }
  return out;
}

/** The company records of one division. Owners, signatures' keys, slots and everything shared are left whole. */
export function scopedCompany(company, division) {
  const mine = r => divOf(r) === division;
  // a request to sign belongs to the division of its contract
  const contractDivision = new Map((company.contracts || []).map(k => [k.id, divOf(k)]));
  const sales = (company.sales || []).filter(r => divisionOfRecord('sales', r) === division);
  return {
    ...company,
    staff: (company.staff || []).filter(mine),
    letters: (company.letters || []).filter(mine),
    payroll: (company.payroll || []).filter(mine),
    contracts: (company.contracts || []).filter(mine),
    signs: (company.signs || []).filter(r => (r.division || contractDivision.get(r.contractId) || INSTALLATION) === division),
    contacts: (company.contacts || []).filter(mine),
    bookings: (company.bookings || []).filter(mine),
    meetings: (company.meetings || []).filter(mine),
    shipments: (company.shipments || []).filter(s => divisionOfRecord('shipments', s) === division),
    sales,
  };
}
