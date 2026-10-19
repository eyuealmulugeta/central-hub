// Demo data so the app opens with four live projects. Every price, exchange
// rate and day rate below is a SAMPLE VALUE: replace them on the Settings screen
// before using an estimate for anything real.

import { toDay, fromDay, addWork, nextWork, DEFAULT_WEEK } from './util.js';
import { emptyWorkspace, DEFAULT_MARKUPS } from './schema.js';
import { buildBOM } from '../engine/bom.js';
import { priceBOM } from '../engine/pricing.js';
import { DEFAULT_BILLING, makeDoc, measureFromBOQ } from '../engine/billing.js';

const FX = { base: 'USD', rates: { USD: 1, ETB: 155, CDF: 2850, SCR: 14.2, AED: 3.6725, EUR: 0.9 } };

// factor = rough cost level relative to the reference USD price
const REGIONS = [
  { id: 'ET', name: 'Ethiopia', currency: 'ETB', factor: 1.0 },
  { id: 'CD', name: 'DR Congo', currency: 'USD', factor: 1.35 },
  { id: 'SC', name: 'Seychelles', currency: 'SCR', factor: 1.5 },
  { id: 'AE', name: 'UAE', currency: 'AED', factor: 0.95 },
];

// [id, name, unit, category, waste %, lead days, reference USD price]
const MATERIALS = [
  ['steel_hr', 'Structural steel sections', 't', 'Steel', 3, 30, 1100],
  ['steel_cf', 'Cold-formed purlins and girts', 't', 'Steel', 3, 21, 1250],
  ['steel_rhs', 'Hollow sections (RHS/SHS)', 't', 'Steel', 5, 14, 1200],
  ['roof_sheet', 'Roof sheeting 0.5 mm', 'm²', 'Cladding', 5, 14, 9],
  ['wall_sheet', 'Wall cladding 0.45 mm', 'm²', 'Cladding', 5, 14, 8],
  ['anchor_bolt', 'Anchor bolt set M24', 'pcs', 'Fixings', 2, 10, 14],
  ['hs_bolt', 'Structural bolt set M20 gr 8.8', 'pcs', 'Fixings', 5, 10, 2.2],
  ['concrete', 'Concrete C25/30', 'm³', 'Civil', 5, 2, 120],
  ['rebar', 'Reinforcing steel', 't', 'Civil', 5, 7, 900],
  ['pier', 'Precast foundation pier', 'pcs', 'Civil', 0, 5, 35],
  ['paint', 'Primer and topcoat paint', 'L', 'Finishes', 10, 7, 6.5],
  ['container_20', 'Container 20 ft', 'pcs', 'Containers', 0, 28, 2400],
  ['container_40', 'Container 40 ft', 'pcs', 'Containers', 0, 28, 3600],
  ['container_40hc', 'Container 40 ft high cube', 'pcs', 'Containers', 0, 28, 4200],
  ['insulation', 'Rockwool insulation 50 mm', 'm²', 'Fit-out', 8, 10, 5.5],
  ['lining', 'Interior lining board', 'm²', 'Fit-out', 10, 7, 7],
  ['flooring', 'Vinyl flooring', 'm²', 'Fit-out', 8, 7, 11],
  ['window', 'Aluminium window 1.2 × 1.0 m', 'pcs', 'Fit-out', 0, 14, 140],
  ['door', 'Steel door 0.9 × 2.1 m', 'pcs', 'Fit-out', 0, 14, 190],
  ['elec_point', 'Electrical point', 'pcs', 'Services', 0, 5, 18],
  ['cable', 'Cable 2.5 mm²', 'm', 'Services', 10, 5, 0.9],
  ['db_board', 'Distribution board', 'pcs', 'Services', 0, 7, 160],
  ['plumb_set', 'Bathroom plumbing and sanitary set', 'set', 'Services', 0, 14, 650],
];

const TRADES = { Foreman: 30, 'Welder / fitter': 22, 'Rigger / erector': 20, Labourer: 10 }; // USD per day

// functional roles, not personal names
const TEAM = [
  { name: 'Site', role: 'Site supervision', contact: '' },
  { name: 'Office', role: 'Project office and procurement', contact: 'office@example.com' },
  { name: 'Owner', role: 'Management', contact: '' },
];

const dep = (id, lag = 0) => ({ id, lag });
const STEEL_TASKS = [
  ['t1', 'Mobilisation and setting out', 4, []],
  ['t2', 'Foundations and pedestals', 10, [dep('t1')]],
  ['t3', 'Anchor bolts and grouting', 3, [dep('t2')]],
  ['t4', 'Steel delivered to site', 0, [dep('t1', 12)]],
  ['t5', 'Column erection', 6, [dep('t3'), dep('t4')]],
  ['t6', 'Rafter erection', 6, [dep('t5')]],
  ['t7', 'Purlins, girts and bracing', 5, [dep('t6')]],
  ['t8', 'Roof sheeting', 6, [dep('t7')]],
  ['t9', 'Wall cladding', 6, [dep('t7')]],
  ['t10', 'Handover', 0, [dep('t8'), dep('t9')]],
];
const CONTAINER_TASKS = [
  ['t1', 'Site preparation', 3, []],
  ['t2', 'Foundation piers', 4, [dep('t1')]],
  ['t3', 'Containers delivered', 0, [dep('t1', 5)]],
  ['t4', 'Placement and levelling', 2, [dep('t2'), dep('t3')]],
  ['t5', 'Cut and frame openings', 5, [dep('t4')]],
  ['t6', 'Insulation and lining', 7, [dep('t5')]],
  ['t7', 'Electrical and plumbing', 6, [dep('t5')]],
  ['t8', 'Doors and windows', 3, [dep('t6')]],
  ['t9', 'Flooring, paint and finishes', 5, [dep('t7'), dep('t8')]],
  ['t10', 'Handover', 0, [dep('t9')]],
];

// which task each material is needed for, where that differs from the component's own link
const STEEL_STAGES = { concrete: 't2', rebar: 't2', anchor_bolt: 't3', steel_cf: 't7', paint: 't7', roof_sheet: 't8', wall_sheet: 't9' };
const CONTAINER_STAGES = {
  pier: 't2', steel_rhs: 't5', insulation: 't6', lining: 't6', elec_point: 't7', cable: 't7', db_board: 't7',
  plumb_set: 't7', window: 't8', door: 't8', flooring: 't9', paint: 't9',
};

const PROJECTS = [
  {
    id: 'modjo', name: 'Modjo Steel Structure and Container Houses', type: 'steel', regionId: 'ET', currency: 'ETB', startedDaysAgo: 60, billing: 'milestone_pct',
    // quantities the site reports against: 450 steel beams, 3,000 roof sheeting panels, 120 container modules
    qty: { t5: 225, t6: 225, t8: 3000, t11: 120 },
    durations: { t8: 30, t9: 14 },
    extraTasks: [['t11', 'Container modules installed', 24, [dep('t3')]]],
    technicians: ['Melaku Mangisto', 'Buzelew Asfaw', 'Yared Dessie'],
    assign: { t5: 'm5', t6: 'm5', t7: 'm5', t8: 'm4', t9: 'm4', t11: 'm6' },
    log: (entry, qty) => [
      [0, entry('t1', 30, 0, 'Site handed over, survey started')],
      [3, entry('t1', 100), entry('t2', 10, 0, 'Excavation started')],
      [7, entry('t2', 55, 2, 'Heavy rain, excavations flooded')],
      [11, entry('t2', 80)],
      [15, entry('t2', 100)],
      [18, entry('t3', 100), entry('t4', 100, 0, 'All trucks offloaded')],
      [20, qty('t5', 80, 'Columns, Axis 01 to 08')],
      [22, qty('t5', 75, 'Columns, Axis 09 to 15')],
      [24, qty('t5', 70, 'Columns, Axis 16 to 22'), qty('t11', 12, 'Block A ground floor')],
      [27, qty('t6', 110, 'Rafters, Axis 01 to 11')],
      [30, qty('t6', 115, 'Rafters, Axis 12 to 22'), qty('t11', 16, 'Block A first floor')],
      [35, entry('t7', 100, 0, 'Purlins, girts and bracing complete')],
      [38, qty('t8', 420, 'Roof sheeting, Axis 01 to 03')],
      [41, qty('t8', 380, 'Roof sheeting, Axis 03 to 04', 1, 'Strong wind, sheeting stopped at noon'), qty('t11', 14, 'Block B ground floor')],
      [44, qty('t8', 350, 'Roof sheeting, bay 04')],
    ],
    assembly: { templateId: 'portal_frame', name: 'Main warehouse 24 × 60 m', params: { span: 24, length: 60, eave: 8, bay: 6, pitch: 10 }, taskId: 't5' },
    procurement: { steel_hr: 'delivered', anchor_bolt: 'delivered', hs_bolt: 'delivered', concrete: 'delivered', rebar: 'delivered', steel_cf: 'ordered' },
  },
  {
    id: 'lubumbashi', name: 'Lubumbashi Factory Roof and Structure', type: 'steel', regionId: 'CD', currency: 'USD', startedDaysAgo: 10, billing: 'measured',
    assembly: { templateId: 'portal_frame', name: 'Workshop 18 × 36 m', params: { span: 18, length: 36, eave: 6, bay: 6, pitch: 8 }, taskId: 't5' },
    procurement: {},
  },
  {
    id: 'seychelles', name: 'Seychelles Container Housing', type: 'container', regionId: 'SC', currency: 'SCR', startedDaysAgo: 16, billing: 'milestone_fixed',
    assembly: { templateId: 'container_unit', name: 'Housing block, 6 units', params: { size: '40hc', count: 6, windows: 12, doors: 8, partitions: 30, points: 60, wetUnits: 6, insulated: true }, taskId: 't4' },
    procurement: { container_40hc: 'delivered', pier: 'delivered', steel_rhs: 'delivered', window: 'ordered', door: 'ordered' },
  },
  {
    id: 'dubai', name: 'Dubai Free Zone Operations', type: 'container', regionId: 'AE', currency: 'AED', startedDaysAgo: 3, billing: 'daily',
    assembly: { templateId: 'container_unit', name: 'Office cluster, 4 units', params: { size: '20ft', count: 4, windows: 8, doors: 4, partitions: 6, points: 32, wetUnits: 1, insulated: true }, taskId: 't4' },
    procurement: {},
  },
];

export function seed(today) {
  const T = toDay(today);
  const wd = DEFAULT_WEEK;
  const round = v => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

  const global = {
    company: { name: '', address: '', phone: '', email: '', taxId: '', bank: '', logo: '' },
    fx: FX,
    regions: REGIONS.map(({ id, name, currency }) => ({ id, name, currency })),
    materials: MATERIALS.map(([id, name, unit, category, waste, leadDays]) => ({ id, name, unit, category, waste, leadDays })),
    prices: Object.fromEntries(REGIONS.map(r => [r.id, Object.fromEntries(
      MATERIALS.map(m => [m[0], { price: round(m[6] * r.factor * FX.rates[r.currency]), currency: r.currency }]))])),
  };

  const meta = { activeId: PROJECTS[0].id, projects: [] };
  const workspaces = {};

  for (const def of PROJECTS) {
    const rate = FX.rates[def.currency];
    const start = nextWork(T - def.startedDaysAgo, wd);
    const at = n => fromDay(addWork(start, n, wd)); // n working days into the job
    const ws = emptyWorkspace();

    // column and rafter erection are tracked by pieces installed (two per frame)
    const members = def.type === 'steel' ? (Math.ceil(def.assembly.params.length / def.assembly.params.bay) + 1) * 2 : 0;
    const totalQty = id => def.qty?.[id] ?? (members && (id === 't5' || id === 't6') ? members : 0);
    ws.tasks = [...(def.type === 'steel' ? STEEL_TASKS : CONTAINER_TASKS), ...(def.extraTasks || [])].map(([id, name, duration, deps]) => ({
      id, name, start: fromDay(start), duration: def.durations?.[id] ?? duration, milestone: duration === 0, deps: deps.map(d => ({ ...d })),
      assigneeId: def.assign?.[id] || (name.includes('delivered') ? 'm2' : name === 'Handover' ? 'm3' : 'm1'),
      ...(totalQty(id) ? { totalQty: totalQty(id), unit: 'pcs' } : {}),
    }));
    ws.assemblies = [{ id: 'a1', ...def.assembly }];
    ws.team = [...TEAM, ...(def.technicians || []).map(name => ({ name, role: 'Site Technician', contact: '' }))].map((m, i) => ({ id: 'm' + (i + 1), ...m }));
    ws.laborRates = Object.fromEntries(Object.entries(TRADES).map(([t, usd]) => [t, Math.round(usd * rate)]));
    const stages = def.type === 'steel' ? STEEL_STAGES : CONTAINER_STAGES;
    ws.procurement = Object.fromEntries([...new Set([...Object.keys(stages), ...Object.keys(def.procurement)])].map(id => {
      const status = def.procurement[id] || 'not_ordered';
      return [id, { status, eta: status === 'ordered' ? fromDay(T + 12) : '', taskId: stages[id] || '' }];
    }));

    const project = {
      id: def.id, name: def.name, type: def.type, regionId: def.regionId, currency: def.currency,
      workDays: [...wd], markups: { ...DEFAULT_MARKUPS }, budget: 0, contractValue: 0,
    };
    const boq = priceBOM(buildBOM(ws.assemblies), project, global);
    const direct = boq.totals.direct;
    project.budget = Math.round(direct * 1.25 / 1000) * 1000;       // materials plus labour and plant allowance
    project.contractValue = Math.round(boq.totals.total * 1.2 / 1000) * 1000;

    const crew = [{ trade: 'Foreman', count: 1 }, { trade: 'Welder / fitter', count: 3, ot: 4 }, { trade: 'Labourer', count: 8 }];
    const past = list => list.filter(x => toDay(x.date) < T);
    const entry = (taskId, progress, delayDays = 0, note = '') => ({ taskId, progress, delayDays, note });
    const qty = (taskId, n, note = '', delayDays = 0, reason = '') => ({ taskId, progress: null, qty: n, delayDays, note: reason || note });
    const log = def.log ? def.log(entry, qty) : def.type === 'steel' ? [
      [0, entry('t1', 30, 0, 'Site handed over, survey started')],
      [3, entry('t1', 100), entry('t2', 10, 0, 'Excavation started')],
      [7, entry('t2', 55, 2, 'Heavy rain, excavations flooded')],
      [11, entry('t2', 80)],
      [15, entry('t2', 100)],
      [18, entry('t3', 100), entry('t4', 100, 0, 'All trucks offloaded')],
      [19, { taskId: 't5', progress: null, qty: 3, delayDays: 0, note: 'Axis 1 to 2' }],
    ] : [
      [0, entry('t1', 40, 0, 'Clearing and levelling')],
      [2, entry('t1', 100)],
      [4, entry('t2', 50, 1, 'Rain stopped concrete pour')],
      [7, entry('t2', 100)],
      [8, entry('t3', 100, 0, 'Containers offloaded'), entry('t4', 50)],
      [9, entry('t4', 100)],
      [12, entry('t5', 60)],
    ];
    ws.reports = past(log.map(([n, ...entries]) => ({ date: at(n), entries })))
      .map((r, i) => ({ id: 'r' + (i + 1), by: def.technicians ? def.technicians[i % def.technicians.length] : 'Site', weather: r.entries.some(e => e.delayDays) ? 'Rain' : 'Clear', manpower: crew, issue: '', ...r }));

    ws.ledger = past([
      { date: at(0), type: 'income', category: 'overhead', description: 'Advance payment (30%)', amount: Math.round(project.contractValue * 0.3), vendor: 'Client' },
      { date: at(1), type: 'expense', category: 'transport', description: 'Mobilisation of plant and site office', amount: Math.round(project.budget * 0.03), vendor: '' },
      { date: at(4), type: 'expense', category: 'material', description: 'Concrete and reinforcement, first delivery', amount: Math.round(project.budget * 0.05), vendor: '' },
      { date: at(8), type: 'expense', category: 'equipment', description: 'Excavator and crane hire', amount: Math.round(project.budget * 0.04), vendor: '' },
    ]).map((e, i) => ({ id: 'l' + (i + 1), currency: def.currency, ...e }));

    ws.items = [
      { id: 'i1', type: 'approval', title: 'Shop drawings rev B awaiting client approval', owner: 'client@example.com', created: fromDay(T - 6), due: fromDay(T + 2), status: 'open', remindEvery: 3 },
      { id: 'i2', type: 'site_request', title: 'Access road compaction before crane arrives', owner: 'Site', created: fromDay(T - 4), due: fromDay(T - 1), status: 'open', remindEvery: 2 },
    ].filter(i => def.startedDaysAgo > 5);

    // billing terms: one demo project per contract type
    project.client = { name: 'Sample Client PLC', address: '', contact: 'client@example.com', taxId: '' };
    project.billing = { ...DEFAULT_BILLING, method: def.billing };
    if (def.billing.startsWith('milestone')) {
      const share = (name, pct, taskId, i) => ({
        id: 's' + (i + 1), name, taskId, value: def.billing === 'milestone_pct' ? pct : Math.round(project.contractValue * pct / 100),
      });
      ws.payStages = (def.type === 'steel'
        ? [['Advance payment', 30, ''], ['Steel delivered to site', 30, 't4'], ['Erection complete', 30, 't7'], ['Handover', 10, 't10']]
        : [['Advance payment', 30, ''], ['Containers delivered', 30, 't3'], ['Fit-out complete', 30, 't9'], ['Handover', 10, 't10']]
      ).map(([name, pct, taskId], i) => share(name, pct, taskId, i));

      // the advance is already invoiced and paid, so the ledger entry and the invoice agree
      const advance = project.contractValue * 0.3;
      const invoice = makeDoc({
        type: 'invoice', project, docs: [], today: at(0), due: at(0), party: project.client,
        lines: [{ description: 'Advance payment (30% of contract value)', qty: 1, unit: 'sum', rate: advance, amount: advance, stageId: 's1' }],
      });
      const received = ws.ledger.find(e => e.id === 'l1');
      if (received) {
        Object.assign(received, { description: `Payment received, ${invoice.number}`, amount: Math.round(invoice.amountDue) });
        Object.assign(invoice, { id: 'd1', status: 'paid', ledgerId: 'l1' });
        ws.docs = [invoice];
      }
    }
    if (def.billing === 'measured') {
      const done = ['Footings', 'Footing reinforcement', 'Anchor bolts'];
      ws.measure = measureFromBOQ(boq).map(m => (done.some(d => m.description.startsWith(d + ',')) ? { ...m, doneQty: m.contractQty } : m));
    }
    if (def.billing === 'daily') {
      ws.billRates = Object.fromEntries(Object.entries(ws.laborRates).map(([trade, cost]) => [trade, Math.round(cost * 1.6)]));
    }

    meta.projects.push(project);
    workspaces[def.id] = ws;
  }

  // two demo shipments: one on the water and running late, one delivered and costed
  const day = n => fromDay(T + n);
  const company = {
    shipments: [
      {
        id: 'sh1', ref: 'SHP-001', supplier: 'Tianjin Steel Structures Co.', projectId: 'modjo', currency: 'USD',
        origin: 'Tianjin, China', destination: 'Modjo dry port', mode: 'sea', incoterm: 'CFR', tracking: 'MSKU 482 1107', carrier: 'Maersk',
        etd: day(-34), eta: day(-3), arrived: '', status: 'port', created: day(-50), notes: 'Waiting for the customs declaration number.',
        lines: [
          { id: 'ln1', description: 'Cold-formed purlins Z200', qty: 18, unit: 't', unitCost: 890 },
          { id: 'ln2', description: 'Roof sheeting 0.5 mm', qty: 1650, unit: 'm²', unitCost: 6.4 },
        ],
        costs: [
          { id: 'cs1', kind: 'freight', note: 'Tianjin to Djibouti, 2 x 40 ft', amount: 5200, currency: 'USD' },
          { id: 'cs2', kind: 'insurance', note: '', amount: 310, currency: 'USD' },
        ],
      },
      {
        id: 'sh2', ref: 'SHP-002', supplier: 'Gulf Container Trading', projectId: 'dubai', currency: 'AED',
        origin: 'Jebel Ali', destination: 'Dubai site', mode: 'road', incoterm: 'DAP', tracking: '', carrier: 'Own truck',
        etd: day(-9), eta: day(-8), arrived: day(-8), status: 'delivered', created: day(-15), notes: '',
        lines: [{ id: 'ln3', description: '40 ft high cube container, used', qty: 4, unit: 'pcs', unitCost: 9800 }],
        costs: [
          { id: 'cs3', kind: 'inland', note: 'Flatbed, 2 trips', amount: 2400, currency: 'AED' },
          { id: 'cs4', kind: 'port', note: 'Gate and handling', amount: 650, currency: 'AED' },
        ],
      },
      {
        id: 'sh3', ref: 'SHP-003', supplier: 'Foshan Building Materials Ltd.', projectId: '', currency: 'USD',
        origin: 'Guangzhou, China', destination: 'Addis Ababa warehouse', mode: 'sea', incoterm: 'FOB', tracking: 'COSU 771 3340', carrier: 'COSCO',
        etd: day(-70), eta: day(-25), arrived: day(-22), status: 'delivered', created: day(-90), notes: 'Bought for resale with K Homes.',
        lines: [
          { id: 'ln4', description: 'Sandwich panel 50 mm', qty: 1200, unit: 'm²', unitCost: 11.5 },
          { id: 'ln5', description: 'Aluminium sliding window 1.2 x 1.2 m', qty: 80, unit: 'pcs', unitCost: 62 },
        ],
        costs: [
          { id: 'cs5', kind: 'freight', note: '1 x 40 ft HC', amount: 4100, currency: 'USD' },
          { id: 'cs6', kind: 'duty', note: '', amount: 310000, currency: 'ETB' },
          { id: 'cs7', kind: 'clearing', note: '', amount: 45000, currency: 'ETB' },
          { id: 'cs8', kind: 'inland', note: 'Djibouti to Addis', amount: 160000, currency: 'ETB' },
        ],
      },
    ],
    sales: [
      { id: 'sl1', date: day(-12), customer: 'K Homes', country: 'UAE', shipmentId: 'sh3', lineId: 'ln4', qty: 400, unitPrice: 3300, currency: 'ETB', paid: true, note: '' },
      { id: 'sl2', date: day(-4), customer: 'Hawassa Lodge', country: 'Ethiopia', shipmentId: 'sh3', lineId: 'ln5', qty: 24, unitPrice: 16500, currency: 'ETB', paid: false, note: '' },
    ],
    contracts: [
      {
        id: 'ct1', ref: 'CON-001', title: 'Steel structure and container houses, supply and installation', kind: 'client', party: 'Sample Client PLC', contact: 'client@example.com',
        projectId: 'modjo', value: 21883000, currency: 'ETB', signedOn: day(-40), start: day(-30), end: day(48), noticeDays: 30,
        retentionPct: 5, retentionRelease: day(413), defectsEnd: day(413), paymentTerms: '30% advance, 60% on progress, 10% on handover. 30 days from invoice.',
        link: '', notes: '', closed: '', created: day(-45),
        dates: [
          { id: 'kd1', what: 'Performance bond expires', date: day(9), done: false },
          { id: 'kd2', what: 'Advance payment guarantee submitted', date: day(-35), done: true },
        ],
      },
      {
        id: 'ct2', ref: 'CON-002', title: 'Supply of cold-formed sections and sheeting', kind: 'supplier', party: 'Tianjin Steel Structures Co.', contact: '',
        projectId: 'modjo', value: 26580, currency: 'USD', signedOn: day(-55), start: day(-55), end: day(30), noticeDays: 0,
        retentionPct: 0, retentionRelease: '', defectsEnd: '', paymentTerms: '30% with order, 70% against bill of lading.', link: '', notes: '', closed: '', created: day(-60), dates: [],
      },
      {
        id: 'ct3', ref: 'CON-003', title: 'Crane hire, 25 t mobile', kind: 'lease', party: 'Sample Crane Hire', contact: '',
        projectId: 'modjo', value: 480000, currency: 'ETB', signedOn: '', start: day(3), end: day(33), noticeDays: 7,
        retentionPct: 0, retentionRelease: '', defectsEnd: '', paymentTerms: 'Monthly in advance.', link: '', notes: '', closed: '', created: day(-2), dates: [],
      },
    ],
    // invented people, to show the screen: replace with your own
    staff: [
      {
        id: 'st1', name: 'Sample Site Engineer', title: 'Site Engineer', projectId: 'modjo', status: 'active', started: day(-400), nationality: '', phone: '', email: '', emergency: '', notes: '',
        agreement: { type: 'fixed', start: day(-400), end: day(35), noticeDays: 30, signedOn: day(-400), pay: 45000, payPer: 'month', currency: 'ETB', link: '', terms: '' },
        documents: [{ id: 'dc1', kind: 'Safety certificate', number: '', expiry: day(20), link: '' }],
      },
      {
        id: 'st2', name: 'Sample Welder', title: 'Welder', projectId: 'modjo', status: 'active', started: day(-20), nationality: '', phone: '', email: '', emergency: '', notes: '',
        agreement: { type: 'probation', start: day(-20), end: '', probationEnd: day(10), noticeDays: 7, signedOn: '', pay: 650, payPer: 'day', currency: 'ETB', link: '', terms: '' },
        documents: [],
      },
    ],
  };

  return { global, meta, workspaces, company };
}

/** Standard task lists a new project can start from: [id, name, working days, predecessors]. */
// Both kinds of work on one site: the steel list, then the container list with its own ids,
// both leading to a single handover.
const withoutHandover = list => list.filter(([, name]) => name !== 'Handover');
const lastOf = list => list.find(([, name]) => name === 'Handover')[3];
const MIXED_TASKS = [
  ...withoutHandover(STEEL_TASKS).map(([id, name, d, deps]) => [id, `Steel: ${name}`, d, deps]),
  ...withoutHandover(CONTAINER_TASKS).map(([id, name, d, deps]) => [`c${id}`, `Containers: ${name}`, d, deps.map(x => dep(`c${x.id}`, x.lag))]),
  ['t10', 'Handover', 0, [...lastOf(STEEL_TASKS), ...lastOf(CONTAINER_TASKS).map(x => dep(`c${x.id}`, x.lag))]],
];

export const TASK_TEMPLATES = { steel: STEEL_TASKS, container: CONTAINER_TASKS, mixed: MIXED_TASKS };
/** The kinds of project, as shown wherever one is chosen. */
export const PROJECT_TYPES = [['steel', 'Steel structure'], ['container', 'Container building'], ['mixed', 'Steel structure and container building']];
export const typeLabel = type => (PROJECT_TYPES.find(([k]) => k === type) || PROJECT_TYPES[0])[1];
