// Company owners: the people who own the company, kept apart from the employees. An owner has no pay, no
// agreement, no attendance and no payroll: only who they are, what share they hold, how to reach them and
// their papers. Pure functions; the screen is ui/owners.js.

/** An owner record from an employee record (Move to company owners). Nothing about pay or agreements is kept. */
export function ownerFromStaff(person, newId) {
  return {
    id: newId(), name: person.name || '', title: person.title || '', sharePct: 0, since: person.started || '',
    status: 'active', email: person.email || person.privateEmail || '', phone: person.phone || person.privatePhone || '',
    address: person.privateAddress || '', nationality: person.nationality || '', idNumber: person.idNumber || '',
    passportNumber: person.passportNumber || '', passportExpiry: (person.documents || []).find(d => d.kind === 'Passport')?.expiry || '',
    photo: person.photo || '', passportImage: person.passportImage || '',
    documents: structuredClone(person.documents || []), notes: person.notes || '', fromStaffId: person.id,
  };
}

export const blankOwner = (newId, today) => ({
  id: newId(), name: '', title: '', sharePct: 0, since: today, status: 'active', email: '', phone: '', address: '',
  nationality: '', idNumber: '', passportNumber: '', passportExpiry: '', photo: '', passportImage: '', documents: [], notes: '',
});

/** The shares the active owners hold, and whether they add up to the whole company. */
export function shareSummary(owners) {
  const active = owners.filter(o => o.status !== 'former');
  const total = Math.round(active.reduce((n, o) => n + (+o.sharePct || 0), 0) * 100) / 100;
  const stated = active.some(o => +o.sharePct > 0);
  return { active: active.length, total, whole: stated && Math.abs(total - 100) < 0.005, over: total > 100.005, stated };
}
