// IT Asset Management: tracked assets with assignment history, and consumable
// inventory with stock movements. Assets and stock are allocated to employees
// (from the HR module), departments or locations.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { ASSET_STATUS, ASSET_CONDITIONS, ISSUE_TYPES, ISSUE_IMPACT, ISSUE_STATUS, ACTIVE_ISSUE } from '../shared/assets.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const optDate = (v, label) => {
  if (!v) return null;
  if (!DATE_RE.test(v)) throw new HttpError(400, `${label} must be a date.`);
  return v;
};
const money = (v, label) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!(n >= 0)) throw new HttpError(400, `${label} must be zero or more.`);
  return Math.round(n * 100) / 100;
};

function nextCode(existing, prefix) {
  const max = existing.reduce((m, code) => {
    const match = String(code || '').match(/(\d+)$/);
    return code?.startsWith(prefix) && match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function findAsset(db, id) {
  const asset = db.data.assets.find((a) => a.id === id);
  if (!asset) throw new HttpError(404, 'Asset not found.');
  return asset;
}

function findItem(db, id) {
  const item = db.data.inventoryItems.find((i) => i.id === id);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  return item;
}

// Who or where something is allocated to: an employee (by id), a department or a location.
function resolveAssignee(db, input) {
  const type = input?.type;
  if (type === 'employee') {
    const emp = db.data.employees.find((e) => e.id === input.employeeId);
    if (!emp) throw new HttpError(400, 'Pick the employee.');
    return { type, id: emp.id, name: `${emp.firstName} ${emp.lastName}`, employeeNo: emp.employeeNo, department: emp.department || '' };
  }
  if (type === 'department' || type === 'location') {
    const name = str(input.name, 120);
    if (!name) throw new HttpError(400, `Enter the ${type} name.`);
    return { type, id: null, name };
  }
  throw new HttpError(400, 'Choose who or where it is allocated to.');
}

function validateAsset(input, db, existingId) {
  const a = {
    assetTag: str(input.assetTag, 40).toUpperCase(),
    name: str(input.name, 120),
    category: str(input.category, 60),
    brand: str(input.brand, 60),
    model: str(input.model, 80),
    serialNumber: str(input.serialNumber, 80),
    specs: str(input.specs, 1000),
    purchaseDate: optDate(input.purchaseDate, 'Purchase date'),
    purchaseCost: money(input.purchaseCost, 'Purchase cost'),
    supplier: str(input.supplier, 120),
    warrantyEnd: optDate(input.warrantyEnd, 'Warranty end'),
    condition: ASSET_CONDITIONS.includes(input.condition) ? input.condition : 'Good',
    location: str(input.location, 120),
    notes: str(input.notes, 1000),
  };
  if (!a.name) throw new HttpError(400, 'Asset name is required.');
  if (!a.category) throw new HttpError(400, 'Category is required.');
  if (!a.assetTag) a.assetTag = nextCode(db.data.assets.map((x) => x.assetTag), db.data.settings.assetTagPrefix || 'LTDC-IT-');
  if (db.data.assets.some((x) => x.assetTag === a.assetTag && x.id !== existingId)) throw new HttpError(400, `Asset tag ${a.assetTag} is already used.`);
  if (a.serialNumber && db.data.assets.some((x) => x.serialNumber && x.serialNumber.toLowerCase() === a.serialNumber.toLowerCase() && x.id !== existingId)) {
    throw new HttpError(400, `Serial number ${a.serialNumber} is already registered.`);
  }
  return a;
}

function validateItem(input, db, existingId) {
  const i = {
    sku: str(input.sku, 40).toUpperCase(),
    name: str(input.name, 120),
    category: str(input.category, 60),
    unit: str(input.unit, 20) || 'pcs',
    reorderLevel: Math.max(0, Math.floor(Number(input.reorderLevel) || 0)),
    location: str(input.location, 120),
    unitCost: money(input.unitCost, 'Unit cost'),
    supplier: str(input.supplier, 120),
    notes: str(input.notes, 1000),
  };
  if (!i.name) throw new HttpError(400, 'Item name is required.');
  if (!i.sku) i.sku = nextCode(db.data.inventoryItems.map((x) => x.sku), 'SKU-');
  if (db.data.inventoryItems.some((x) => x.sku === i.sku && x.id !== existingId)) throw new HttpError(400, `SKU ${i.sku} is already used.`);
  return i;
}

export function registerAssetRoutes(route, db, { linkedEmployee }) {
  const log = (asset, user, action, detail, extra = {}) => {
    db.data.assetHistory.push({
      id: randomUUID(), assetId: asset.id, assetTag: asset.assetTag, assetName: asset.name,
      action, detail, at: new Date().toISOString(), by: user.name, ...extra,
    });
  };
  const historyOf = (id) => db.data.assetHistory.filter((h) => h.assetId === id).reverse().sort((a, b) => b.at.localeCompare(a.at));
  // Lists are reversed before sorting so entries with the same timestamp stay newest first.
  const newestFirst = (a, b) => b.reportedAt.localeCompare(a.reportedAt);
  const reportsOf = (id) => db.data.issueReports.filter((r) => r.assetId === id).reverse().sort(newestFirst);
  const findReport = (id) => {
    const r = db.data.issueReports.find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'Report not found.');
    return r;
  };

  function move(item, user, type, delta, extra = {}) {
    item.quantity += delta;
    const m = {
      id: randomUUID(), itemId: item.id, sku: item.sku, itemName: item.name, unit: item.unit, type,
      quantity: delta, balanceAfter: item.quantity, at: new Date().toISOString(), by: user.name,
      issuedTo: null, reference: '', notes: '', ...extra,
    };
    db.data.stockMovements.push(m);
    return m;
  }

  // ----- Reference data for forms (no HR permission needed) -----
  route('GET', '/api/asset-meta', 'assets.view', () => {
    const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return {
      employees: db.data.employees
        .filter((e) => e.status === 'Active')
        .map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}`, employeeNo: e.employeeNo, department: e.department || '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      departments: uniq([...db.data.employees.map((e) => e.department), ...db.data.assets.filter((a) => a.assignedTo?.type === 'department').map((a) => a.assignedTo.name)]),
      locations: uniq([...db.data.assets.map((a) => a.location), ...db.data.inventoryItems.map((i) => i.location), ...db.data.assets.filter((a) => a.assignedTo?.type === 'location').map((a) => a.assignedTo.name)]),
      assetCategories: uniq(db.data.assets.map((a) => a.category)),
      itemCategories: uniq(db.data.inventoryItems.map((i) => i.category)),
      suppliers: uniq([...db.data.assets.map((a) => a.supplier), ...db.data.inventoryItems.map((i) => i.supplier)]),
      nextAssetTag: nextCode(db.data.assets.map((x) => x.assetTag), db.data.settings.assetTagPrefix || 'LTDC-IT-'),
      nextSku: nextCode(db.data.inventoryItems.map((x) => x.sku), 'SKU-'),
    };
  });

  // ----- Assets -----
  route('GET', '/api/assets', 'assets.view', () => db.data.assets);
  route('GET', '/api/assets/:id', 'assets.view', ({ params }) => ({ ...findAsset(db, params.id), history: historyOf(params.id), reports: reportsOf(params.id) }));
  route('POST', '/api/assets', 'assets.edit', ({ body, user }) => {
    const asset = { id: randomUUID(), ...validateAsset(body, db), status: 'in_stock', assignedTo: null, assignedAt: null, expectedReturn: null, createdAt: new Date().toISOString() };
    db.data.assets.push(asset);
    log(asset, user, 'created', `Registered as ${asset.category}${asset.location ? ` at ${asset.location}` : ''}`);
    db.save();
    return asset;
  });
  route('PUT', '/api/assets/:id', 'assets.edit', ({ params, body, user }) => {
    const asset = findAsset(db, params.id);
    Object.assign(asset, validateAsset(body, db, asset.id), { updatedAt: new Date().toISOString() });
    log(asset, user, 'edited', 'Details updated');
    db.save();
    return asset;
  });
  route('DELETE', '/api/assets/:id', 'assets.edit', ({ params }) => {
    const asset = findAsset(db, params.id);
    if (asset.status === 'assigned') throw new HttpError(400, 'Return this asset before deleting it, or mark it retired instead.');
    db.data.assets = db.data.assets.filter((a) => a.id !== asset.id);
    db.data.assetHistory = db.data.assetHistory.filter((h) => h.assetId !== asset.id);
    db.save();
    return { ok: true };
  });

  route('POST', '/api/assets/:id/assign', 'assets.edit', ({ params, body, user }) => {
    const asset = findAsset(db, params.id);
    if (!['in_stock', 'assigned'].includes(asset.status)) {
      throw new HttpError(400, `This asset is ${ASSET_STATUS[asset.status].toLowerCase()}. Set it back to In stock before assigning it.`);
    }
    const to = resolveAssignee(db, body);
    const previous = asset.assignedTo;
    if (previous && previous.type === to.type && previous.id === to.id && previous.name === to.name) throw new HttpError(400, `Already assigned to ${to.name}.`);
    Object.assign(asset, {
      status: 'assigned', assignedTo: to, assignedAt: new Date().toISOString(),
      expectedReturn: optDate(body.expectedReturn, 'Expected return'), updatedAt: new Date().toISOString(),
    });
    log(asset, user, previous ? 'transferred' : 'assigned', previous ? `Transferred from ${previous.name} to ${to.name}` : `Assigned to ${to.name}`, {
      assignee: to, previousAssignee: previous || null, notes: str(body.notes, 500),
    });
    db.save();
    return { ...asset, history: historyOf(asset.id) };
  });

  route('POST', '/api/assets/:id/return', 'assets.edit', ({ params, body, user }) => {
    const asset = findAsset(db, params.id);
    if (asset.status !== 'assigned') throw new HttpError(400, 'This asset is not assigned to anyone.');
    const previous = asset.assignedTo;
    const status = body.status === 'in_repair' ? 'in_repair' : 'in_stock';
    Object.assign(asset, {
      status, assignedTo: null, assignedAt: null, expectedReturn: null,
      condition: ASSET_CONDITIONS.includes(body.condition) ? body.condition : asset.condition,
      location: str(body.location, 120) || asset.location, updatedAt: new Date().toISOString(),
    });
    log(asset, user, 'returned', `Returned from ${previous.name}${status === 'in_repair' ? ', sent for repair' : ''} (condition: ${asset.condition})`, {
      previousAssignee: previous, notes: str(body.notes, 500),
    });
    db.save();
    return { ...asset, history: historyOf(asset.id) };
  });

  route('POST', '/api/assets/:id/status', 'assets.edit', ({ params, body, user }) => {
    const asset = findAsset(db, params.id);
    const status = body.status;
    if (!['in_stock', 'in_repair', 'retired', 'lost'].includes(status)) throw new HttpError(400, 'Pick a valid status.');
    if (status === asset.status) throw new HttpError(400, `The asset is already ${ASSET_STATUS[status].toLowerCase()}.`);
    const previous = asset.assignedTo;
    if (previous && !['retired', 'lost'].includes(status)) throw new HttpError(400, 'Use Return to take this asset back from its holder first.');
    Object.assign(asset, { status, assignedTo: null, assignedAt: null, expectedReturn: null, updatedAt: new Date().toISOString() });
    log(asset, user, 'status', `Status set to ${ASSET_STATUS[status]}${previous ? ` (was with ${previous.name})` : ''}`, {
      previousAssignee: previous || null, notes: str(body.notes, 500),
    });
    db.save();
    return { ...asset, history: historyOf(asset.id) };
  });

  route('GET', '/api/asset-history', 'assets.view', ({ query }) =>
    db.data.assetHistory
      .filter((h) => (!query.from || h.at.slice(0, 10) >= query.from) && (!query.to || h.at.slice(0, 10) <= query.to))
      .reverse().sort((a, b) => b.at.localeCompare(a.at)),
  );

  // ----- Consumable inventory -----
  route('GET', '/api/inventory', 'assets.view', () => db.data.inventoryItems);
  route('POST', '/api/inventory', 'assets.edit', ({ body, user }) => {
    const item = { id: randomUUID(), ...validateItem(body, db), quantity: 0, createdAt: new Date().toISOString() };
    db.data.inventoryItems.push(item);
    const opening = Math.floor(Number(body.openingQuantity) || 0);
    if (opening < 0) throw new HttpError(400, 'Opening quantity must be zero or more.');
    if (opening > 0) move(item, user, 'in', opening, { reference: 'Opening stock' });
    db.save();
    return item;
  });
  route('PUT', '/api/inventory/:id', 'assets.edit', ({ params, body }) => {
    const item = findItem(db, params.id);
    Object.assign(item, validateItem(body, db, item.id), { updatedAt: new Date().toISOString() });
    db.save();
    return item;
  });
  route('DELETE', '/api/inventory/:id', 'assets.edit', ({ params }) => {
    const item = findItem(db, params.id);
    if (item.quantity > 0) throw new HttpError(400, `There are still ${item.quantity} ${item.unit} in stock. Issue or adjust them to zero first.`);
    db.data.inventoryItems = db.data.inventoryItems.filter((i) => i.id !== item.id);
    db.save();
    return { ok: true };
  });

  // Stock in (received), out (issued to someone) or a count adjustment.
  route('POST', '/api/inventory/:id/movements', 'assets.edit', ({ params, body, user }) => {
    const item = findItem(db, params.id);
    const extra = { reference: str(body.reference, 120), notes: str(body.notes, 500) };
    let m;
    if (body.type === 'in' || body.type === 'out') {
      const qty = Math.floor(Number(body.quantity));
      if (!(qty > 0)) throw new HttpError(400, 'Quantity must be at least 1.');
      if (body.type === 'out') {
        if (qty > item.quantity) throw new HttpError(400, `Only ${item.quantity} ${item.unit} in stock.`);
        m = move(item, user, 'out', -qty, { ...extra, issuedTo: resolveAssignee(db, body.issuedTo) });
      } else {
        m = move(item, user, 'in', qty, extra);
      }
    } else if (body.type === 'adjust') {
      const counted = Math.floor(Number(body.countedQuantity));
      if (!(counted >= 0)) throw new HttpError(400, 'Enter the counted quantity (zero or more).');
      if (counted === item.quantity) throw new HttpError(400, 'The count matches the current stock; nothing to adjust.');
      m = move(item, user, 'adjust', counted - item.quantity, { ...extra, reference: extra.reference || 'Stock count' });
    } else {
      throw new HttpError(400, 'Choose stock in, issue or adjust.');
    }
    item.updatedAt = new Date().toISOString();
    db.save();
    return { item, movement: m };
  });
  route('GET', '/api/stock-movements', 'assets.view', ({ query }) =>
    db.data.stockMovements
      .filter((m) => (!query.itemId || m.itemId === query.itemId) && (!query.from || m.at.slice(0, 10) >= query.from) && (!query.to || m.at.slice(0, 10) <= query.to))
      .reverse().sort((a, b) => b.at.localeCompare(a.at)),
  );

  // ----- Issue reports (malfunction, damage, loss) -----
  route('GET', '/api/asset-reports', 'assets.view', () => [...db.data.issueReports].reverse().sort(newestFirst));
  route('GET', '/api/asset-reports/summary', 'assets.view', () => ({
    new: db.data.issueReports.filter((r) => r.status === 'open').length,
    active: db.data.issueReports.filter((r) => ACTIVE_ISSUE.includes(r.status)).length,
  }));
  route('GET', '/api/asset-reports/:id', 'assets.view', ({ params }) => {
    const r = findReport(params.id);
    return { ...r, asset: db.data.assets.find((a) => a.id === r.assetId) || null };
  });
  // IT's response: a new status and/or a note the reporter can read.
  route('POST', '/api/asset-reports/:id/update', 'assets.edit', ({ params, body, user }) => {
    const r = findReport(params.id);
    const status = body.status || r.status;
    if (!ISSUE_STATUS[status]) throw new HttpError(400, 'Pick a valid status.');
    const note = str(body.note, 1000);
    if (status === r.status && !note) throw new HttpError(400, 'Change the status or write a note.');
    const at = new Date().toISOString();
    r.updates.push({ at, by: user.name, status: status === r.status ? null : status, note });
    if (status !== r.status) {
      r.status = status;
      r.closedAt = ACTIVE_ISSUE.includes(status) ? null : at;
      const asset = db.data.assets.find((a) => a.id === r.assetId);
      if (asset) log(asset, user, 'issue', `Report ${r.number} marked ${ISSUE_STATUS[status].toLowerCase()}`, { notes: note });
    }
    r.updatedAt = at;
    db.save();
    return { ...r, asset: db.data.assets.find((a) => a.id === r.assetId) || null };
  });

  // ----- Employee self-service -----
  route('GET', '/api/me/assets', 'self', ({ user }) => {
    const emp = linkedEmployee(user);
    return {
      assets: db.data.assets.filter((a) => a.assignedTo?.type === 'employee' && a.assignedTo.id === emp.id),
      issued: db.data.stockMovements.filter((m) => m.type === 'out' && m.issuedTo?.type === 'employee' && m.issuedTo.id === emp.id).reverse().sort((a, b) => b.at.localeCompare(a.at)),
      reports: db.data.issueReports.filter((r) => r.reportedBy.employeeId === emp.id).reverse().sort(newestFirst),
    };
  });
  route('POST', '/api/me/asset-reports', 'self', ({ body, user }) => {
    const emp = linkedEmployee(user);
    const asset = db.data.assets.find((a) => a.id === body.assetId && a.assignedTo?.type === 'employee' && a.assignedTo.id === emp.id);
    if (!asset) throw new HttpError(400, 'You can only report equipment that is assigned to you.');
    if (!ISSUE_TYPES[body.type]) throw new HttpError(400, 'Choose what is wrong.');
    if (!ISSUE_IMPACT[body.impact]) throw new HttpError(400, 'Tell IT whether you can still work on it.');
    const description = str(body.description, 2000);
    if (!description) throw new HttpError(400, 'Describe the problem.');
    const noticedOn = optDate(body.noticedOn, 'Date noticed') || localDate();
    const open = db.data.issueReports.find((r) => r.assetId === asset.id && ACTIVE_ISSUE.includes(r.status));
    if (open) throw new HttpError(400, `${asset.assetTag} already has an open report (${open.number}). IT will update you there.`);
    const now = new Date().toISOString();
    const report = {
      id: randomUUID(), number: nextCode(db.data.issueReports.map((r) => r.number), 'IR-'),
      assetId: asset.id, assetTag: asset.assetTag, assetName: asset.name, category: asset.category, serialNumber: asset.serialNumber,
      type: body.type, impact: body.impact, description, noticedOn, status: 'open',
      reportedBy: { userId: user.id, employeeId: emp.id, name: `${emp.firstName} ${emp.lastName}`, employeeNo: emp.employeeNo, department: emp.department || '' },
      reportedAt: now, updatedAt: now, closedAt: null, updates: [],
    };
    db.data.issueReports.push(report);
    log(asset, user, 'issue', `${ISSUE_TYPES[report.type]} reported by ${report.reportedBy.name} (${report.number})`, { notes: description.slice(0, 200) });
    db.save();
    return report;
  });
}
