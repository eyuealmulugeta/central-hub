// BOM engine: a library of parametric component templates. Each template turns
// a handful of primary dimensions into bill-of-materials lines.
//
// The quantities are ESTIMATING take-offs built on rules of thumb (section
// weights picked by span, percentage allowances for bracing and connections).
// They are for budgeting and procurement planning, not structural design: the
// engineer's member schedule replaces them once the design is done. Every
// coefficient lives in the constants below so it can be tuned to your own
// historical tonnages.

const rad = deg => deg * Math.PI / 180;

// ---- steel portal frame ----

// Primary frame section by clear span: [max span m, label, kg per metre]
const FRAME_SECTIONS = [
  [12, 'IPE 240', 30.7],
  [18, 'IPE 300', 42.2],
  [24, 'IPE 360', 57.1],
  [30, 'IPE 450', 77.6],
  [Infinity, 'IPE 550', 106],
];
const PURLIN_KGM = 6.0;        // Z/C 200 x 2.0 cold-formed
const BRACING_PCT = 0.06;      // of primary frame steel
const CONNECTION_PCT = 0.08;   // plates, cleats, haunches
const PAINT_M2_PER_T = 28;     // painted surface per tonne of hot-rolled steel
const PAINT_M2_PER_L = 8;      // coverage per coat
const PAINT_COATS = 2;
const REBAR_T_PER_M3 = 0.08;
const ANCHORS_PER_COLUMN = 4;
const BOLTS_PER_FRAME = 24;

function portalFrame(p) {
  const half = (p.span / 2) / Math.cos(rad(p.pitch)); // one rafter, eave to ridge
  const rise = (p.span / 2) * Math.tan(rad(p.pitch));
  const frames = Math.ceil(p.length / p.bay) + 1;
  const [, section, kgm] = FRAME_SECTIONS.find(([max]) => p.span <= max);

  const columns = frames * 2 * p.eave * kgm / 1000;
  const rafters = frames * 2 * half * kgm / 1000;
  const primary = columns + rafters;
  const bracing = primary * BRACING_PCT;
  const connections = primary * CONNECTION_PCT;

  const purlinRows = (Math.ceil(half / p.purlinSpacing) + 1) * 2;
  const purlins = purlinRows * p.length * PURLIN_KGM / 1000;
  const perimeter = 2 * (p.span + p.length);
  const girtRows = p.clad ? Math.ceil(p.eave / p.girtSpacing) : 0;
  const girts = girtRows * perimeter * PURLIN_KGM / 1000;

  const roofArea = 2 * half * p.length;
  const wallArea = p.clad ? perimeter * p.eave + p.span * rise : 0; // walls + two gable triangles
  const hotRolled = primary + bracing + connections;
  const concrete = frames * 2 * p.footing;

  return {
    lines: [
      { element: 'Columns', materialId: 'steel_hr', qty: columns, note: `${frames * 2} × ${p.eave} m ${section}` },
      { element: 'Rafters', materialId: 'steel_hr', qty: rafters, note: `${frames * 2} × ${half.toFixed(2)} m ${section}` },
      { element: 'Bracing', materialId: 'steel_hr', qty: bracing, note: `${BRACING_PCT * 100}% of frames` },
      { element: 'Connections & plates', materialId: 'steel_hr', qty: connections, note: `${CONNECTION_PCT * 100}% of frames` },
      { element: 'Purlins', materialId: 'steel_cf', qty: purlins, note: `${purlinRows} rows × ${p.length} m` },
      { element: 'Wall girts', materialId: 'steel_cf', qty: girts, note: `${girtRows} rows × ${perimeter} m` },
      { element: 'Roof sheeting', materialId: 'roof_sheet', qty: roofArea },
      { element: 'Wall cladding', materialId: 'wall_sheet', qty: wallArea },
      { element: 'Anchor bolts', materialId: 'anchor_bolt', qty: frames * 2 * ANCHORS_PER_COLUMN },
      { element: 'Structural bolts', materialId: 'hs_bolt', qty: frames * BOLTS_PER_FRAME },
      { element: 'Footings', materialId: 'concrete', qty: concrete, note: `${frames * 2} pads × ${p.footing} m³` },
      { element: 'Footing reinforcement', materialId: 'rebar', qty: concrete * REBAR_T_PER_M3 },
      { element: 'Paint system', materialId: 'paint', qty: hotRolled * PAINT_M2_PER_T / PAINT_M2_PER_L * PAINT_COATS },
    ],
    metrics: {
      Frames: frames,
      'Frame section': section,
      'Steel (t)': hotRolled + purlins + girts,
      'Floor area (m²)': p.span * p.length,
      'kg per m²': (hotRolled + purlins + girts) * 1000 / (p.span * p.length),
    },
  };
}

// ---- container unit ----

const CONTAINERS = {
  '20ft': { L: 6.058, W: 2.438, H: 2.591, materialId: 'container_20', piers: 4 },
  '40ft': { L: 12.192, W: 2.438, H: 2.591, materialId: 'container_40', piers: 6 },
  '40hc': { L: 12.192, W: 2.438, H: 2.896, materialId: 'container_40hc', piers: 6 },
};
const WINDOW = { area: 1.2 * 1.0, frame: 4.4 };  // m², metres of framing per opening
const DOOR = { area: 0.9 * 2.1, frame: 5.1 };
const RHS_KGM = 4.25;          // RHS 50x50x3 opening frame
const CABLE_M_PER_POINT = 8;

function containerUnit(p) {
  const c = CONTAINERS[p.size];
  const n = p.count;
  const openings = p.windows * WINDOW.area + p.doors * DOOR.area;
  const walls = Math.max(0, n * 2 * (c.L + c.W) * c.H - openings);
  const floor = n * c.L * c.W;
  const partitions = p.partitions * c.H;
  const exterior = n * (2 * (c.L + c.W) * c.H + c.L * c.W);

  return {
    lines: [
      { element: 'Container shells', materialId: c.materialId, qty: n },
      { element: 'Foundation piers', materialId: 'pier', qty: n * c.piers },
      { element: 'Opening frames', materialId: 'steel_rhs', qty: (p.windows * WINDOW.frame + p.doors * DOOR.frame) * RHS_KGM / 1000, note: 'RHS 50×50×3' },
      { element: 'Insulation', materialId: 'insulation', qty: p.insulated ? walls + floor : 0, note: 'walls + ceiling' },
      { element: 'Interior lining', materialId: 'lining', qty: walls + floor + partitions * 2, note: 'walls, ceiling, both faces of partitions' },
      { element: 'Flooring', materialId: 'flooring', qty: floor },
      { element: 'Windows', materialId: 'window', qty: p.windows },
      { element: 'Doors', materialId: 'door', qty: p.doors },
      { element: 'Electrical points', materialId: 'elec_point', qty: p.points },
      { element: 'Cable', materialId: 'cable', qty: p.points * CABLE_M_PER_POINT },
      { element: 'Distribution boards', materialId: 'db_board', qty: p.points > 0 ? Math.ceil(n / 2) : 0 },
      { element: 'Bathroom sets', materialId: 'plumb_set', qty: p.wetUnits },
      { element: 'Exterior paint', materialId: 'paint', qty: exterior / PAINT_M2_PER_L * PAINT_COATS },
    ],
    metrics: { 'Floor area (m²)': floor, 'Wall area (m²)': walls, Openings: p.windows + p.doors },
  };
}

// ---- library ----

export const TEMPLATES = {
  portal_frame: {
    name: 'Steel portal frame building',
    params: [
      { key: 'span', label: 'Span', unit: 'm', default: 20, min: 4 },
      { key: 'length', label: 'Length', unit: 'm', default: 40, min: 4 },
      { key: 'eave', label: 'Eave height', unit: 'm', default: 6, min: 2 },
      { key: 'bay', label: 'Bay spacing', unit: 'm', default: 6, min: 2 },
      { key: 'pitch', label: 'Roof pitch', unit: '°', default: 10, min: 0, max: 45 },
      { key: 'purlinSpacing', label: 'Purlin spacing', unit: 'm', default: 1.5, min: 0.5 },
      { key: 'girtSpacing', label: 'Girt spacing', unit: 'm', default: 1.8, min: 0.5 },
      { key: 'footing', label: 'Footing volume', unit: 'm³ each', default: 0.72, min: 0 },
      { key: 'clad', label: 'Wall cladding', type: 'bool', default: true },
    ],
    calc: portalFrame,
  },
  container_unit: {
    name: 'Container house / office',
    params: [
      { key: 'size', label: 'Container', type: 'select', default: '40hc', options: [['20ft', '20 ft'], ['40ft', '40 ft'], ['40hc', '40 ft high cube']] },
      { key: 'count', label: 'Containers', unit: 'pcs', default: 2, min: 1 },
      { key: 'windows', label: 'Windows (total)', unit: 'pcs', default: 4, min: 0 },
      { key: 'doors', label: 'Doors (total)', unit: 'pcs', default: 2, min: 0 },
      { key: 'partitions', label: 'Partition walls', unit: 'm', default: 6, min: 0 },
      { key: 'points', label: 'Electrical points', unit: 'pcs', default: 16, min: 0 },
      { key: 'wetUnits', label: 'Bathrooms', unit: 'pcs', default: 1, min: 0 },
      { key: 'insulated', label: 'Insulated', type: 'bool', default: true },
    ],
    calc: containerUnit,
  },
  custom: {
    name: 'Custom line item',
    params: [
      { key: 'materialId', label: 'Material', type: 'material', default: 'steel_hr' },
      { key: 'qty', label: 'Quantity', default: 1, min: 0 },
    ],
    calc: p => ({ lines: [{ element: 'Custom item', materialId: p.materialId, qty: p.qty }], metrics: {} }),
  },
};

export const defaultParams = templateId =>
  Object.fromEntries(TEMPLATES[templateId].params.map(d => [d.key, d.default]));

/** Expand every assembly in a workspace into flat BOM lines. */
export function buildBOM(assemblies) {
  const lines = [];
  const metrics = {};
  for (const a of assemblies) {
    const tpl = TEMPLATES[a.templateId];
    if (!tpl) continue;
    const out = tpl.calc({ ...defaultParams(a.templateId), ...a.params });
    metrics[a.id] = out.metrics;
    for (const l of out.lines) {
      if (l.qty > 0) lines.push({ ...l, assemblyId: a.id, assemblyName: a.name, taskId: a.taskId || null });
    }
  }
  return { lines, metrics };
}
