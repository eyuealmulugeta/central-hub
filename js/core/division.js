// Installation and Trading are two separate businesses under one roof. A record that belongs to one of them
// carries `division`; a record with none belongs to Installation (everything made before the two were kept apart).
// A shipment needs no stamp: one for a project is Installation, one with no project is Trading. Sales are Trading.
//
// Every page is given a view of the company that holds only the open division's records (scopedCompany), so a page
// cannot mix the two by accident. This separates what people see: the database rules do not enforce it.

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
export const stamp = () => (current === TRADING ? { division: TRADING } : {});

/** The company records of one division. Owners, signatures' keys, slots and everything shared are left whole. */
export function scopedCompany(company, division) {
  const mine = r => divOf(r) === division;
  // a request to sign belongs to the division of its contract
  const contractDivision = new Map((company.contracts || []).map(k => [k.id, divOf(k)]));
  const sales = division === TRADING ? company.sales || [] : [];
  return {
    ...company,
    staff: (company.staff || []).filter(mine),
    letters: (company.letters || []).filter(mine),
    payroll: (company.payroll || []).filter(mine),
    contracts: (company.contracts || []).filter(mine),
    signs: (company.signs || []).filter(r => (contractDivision.get(r.contractId) || INSTALLATION) === division),
    bookings: (company.bookings || []).filter(mine),
    shipments: (company.shipments || []).filter(s => shipmentDivision(s) === division),
    sales,
  };
}
