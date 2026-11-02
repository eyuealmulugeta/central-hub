// Slice 3: equipment, materials received, safety and delays, and today's photos. Each list is kept on the report
// and turned into the fields Central Hub already imports (equipment, received, safety, delays, delayItems).

import { uid, num, sum, plural } from '../core/util.js';

export const EQUIPMENT = ['Crane', 'Truck', 'Generator', 'Welding machine', 'Mixer', 'Vibrator', 'Pump', 'Excavator', 'Forklift', 'Scaffolding'];
export const EQUIP_STATES = ['Active', 'Idle', 'Breakdown'];
export const MATERIAL_UNITS = ['pcs', 'kg', 't', 'm', 'm²', 'm³', 'bags', 'lot'];
export const DELAY_CAUSES = ['Weather', 'Material', 'Equipment', 'Inspection', 'Client instruction', 'Access', 'Rework', 'Power', 'Other'];
export const PARTIES = ['Client', 'Contractor', 'Supplier', 'Subcontractor', 'Authority', 'Weather'];
export const INCIDENTS = ['Near miss', 'First aid', 'Injury, lost time', 'Damage', 'Other'];

/** Yesterday's equipment carried to today: same machines and counts, hours from today's working day, status Active. */
export const carryEquipment = (prev, hours = 8) => (prev && prev.equipment || [])
  .filter(e => e && e.name && e.qty > 0)
  .map(e => ({ id: uid(), name: e.name, qty: e.qty, hrs: hours, status: 'Active' }));

export const newEquipment = (name, hours = 8) => ({ id: uid(), name, qty: 1, hrs: hours, status: 'Active' });
export const newReceived = time => ({ id: uid(), at: time, name: '', qty: null, unit: 'pcs', note: '', photos: [] });
export const newDelay = (time, cause = '') => ({ id: uid(), at: time, cause, party: cause === 'Weather' ? 'Weather' : '', hours: 1, idlePeople: 0, idleEquipment: '', taskId: '', note: '' });

/** Equipment the office's list names first, then the usual machines, without the ones already on today's list. */
export const equipmentChoices = (setup, list) => [...new Set([...(setup && setup.equipment || []), ...EQUIPMENT])]
  .filter(n => !list.some(e => e.name.toLowerCase() === String(n).toLowerCase()));

/** Materials to pick from: the project's list, then what was received before on this phone. */
export const materialChoices = (setup, seen = []) => [...new Set([...(setup && setup.materials || []), ...seen].map(x => String(x || '').trim()).filter(Boolean))];

/** A photo without a caption and not tied to a work item says nothing in the report. */
export const photoNeedsCaption = p => !String(p.caption || '').trim() && !p.itemId;

/** The line under each step on Today, and whether it is ticked. */
export function dayStatus(r, id) {
  switch (id) {
    case 'equipment': {
      const list = r.equipment || [];
      if (!list.length) return { state: r.done.equipment ? 'ok' : 'no', line: r.done.equipment ? 'No equipment today' : 'Machines on site' };
      const down = list.filter(e => e.status === 'Breakdown').length;
      return { state: r.done.equipment ? 'ok' : 'half', count: list.length, line: `${plural(sum(list, e => e.qty), 'machine')}${down ? ` · ${down} broken down` : ''}` };
    }
    case 'materials': {
      const list = r.received || [];
      if (!list.length) return { state: r.done.materials ? 'ok' : 'no', line: r.done.materials ? 'Nothing received' : 'Deliveries as they come' };
      return { state: r.done.materials ? 'ok' : 'half', count: list.length, line: plural(list.length, 'delivery', 'deliveries') };
    }
    case 'safety': {
      const s = r.safety || {}, d = r.delays || [];
      const parts = [s.incident ? s.kind || 'Incident' : 'No incidents', d.length ? `${plural(d.length, 'delay')}, ${sum(d, x => x.hours)} h` : 'no delays'];
      if (!s.done && !s.incident && !d.length) return { state: 'no', line: 'Incidents, toolbox talk, delays' };
      return { state: s.done ? 'ok' : 'half', count: d.length || 1, line: parts.join(' · ') };
    }
    case 'photos': {
      const list = r.photos || [];
      if (!list.length) return { state: r.done.photos ? 'ok' : 'no', line: 'Taken with +' };
      const missing = list.filter(photoNeedsCaption).length;
      return { state: r.done.photos ? 'ok' : 'half', count: list.length, line: `${list.length} taken${missing ? ` · ${missing} without a caption` : ''}` };
    }
    default: return null;
  }
}

/** The fields of the report file that Central Hub reads (schema 4), from slice 3's lists. */
export function dayMeta(r) {
  const s = r.safety || {};
  const delays = (r.delays || []).filter(d => d.cause);
  return {
    equipment: (r.equipment || []).filter(e => e.name && e.qty > 0).map(e => ({ name: e.name, qty: e.qty, hrs: num(e.hrs) ?? 0, status: e.status })),
    received: (r.received || []).filter(x => String(x.name || '').trim()).map(x => ({ name: x.name.trim(), qty: num(x.qty) ?? 0, unit: x.unit || '', note: String(x.note || '').trim() })),
    attention: (r.attention || []).map(x => String(x.text || '').trim()).filter(Boolean),   // 2.7.0
    safety: { status: s.incident ? s.kind || 'Incident' : 'None', toolboxTalk: !!s.toolbox, ppe: [...((r.start || {}).ppe || [])], notes: s.incident && String(s.note || '').trim() ? [s.note.trim()] : [] },
    delays: delays.map(d => ({ k: d.cause, h: num(d.hours) ?? 0 })),
    delayItems: delays.map(d => ({
      cause: d.cause, party: d.party || '', ...(d.taskId ? { taskId: d.taskId } : {}), hours: num(d.hours) ?? 0,
      idlePeople: num(d.idlePeople) ?? 0, idleEquipment: String(d.idleEquipment || '').trim(), note: String(d.note || '').trim(),
    })),
  };
}
