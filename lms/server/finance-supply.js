// ATLAS Finance – Inventory and Property.
// Procurement: Purchase Request (PR) → Purchase Order (PO, with its obligation request) →
// Inspection and Acceptance Report (IAR), which receives supplies into stock, registers
// semi-expendable property and PPE, and books the liability (Dr inventory/PPE, Cr Accounts
// Payable), with liquidated damages for late delivery (1/10 of 1% of the late items per day).
// Inventory: stock cards (FIFO cost), Requisition and Issue Slips (RIS), the monthly Report of
// Supplies and Materials Issued (RSMI, Dr expense / Cr inventory) and the physical count (RPCI).
// Property: PAR (PPE) and ICS (semi-expendable, expensed when issued, COA Circular 2022-004),
// transfers (PTR/ITR), returns, disposal (IIRUP), monthly straight-line depreciation and the
// Report on the Physical Count of PPE (RPCPPE) / Semi-expendable Property (RPCSP).
import { randomUUID } from 'node:crypto';
import { text } from './util.js';
import { can } from '../shared/roles.js';
import { PPE_CLASSES, SEMI_CLASSES, SUPPLY_CLASSES, PROCUREMENT_MODES, ACCT, round2, sum, depreciation, classOf } from '../shared/finance.js';

const CATEGORIES = ['supply', 'semi', 'ppe', 'service'];

export function registerSupplyRoutes(route, fx) {
  const { data, save, fail, iso } = fx;
  const D = () => data();
  const S = () => fx.S();

  // ----- Stock (FIFO lots) -----
  const movements = (itemId) => D().finStock.filter((m) => m.itemId === itemId).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  const onHand = (itemId, asOf) => sum(D().finStock.filter((m) => m.itemId === itemId && (!asOf || m.date <= asOf)), (m) => m.qty);
  const stockValue = (itemId, asOf) => sum(D().finStock.filter((m) => m.itemId === itemId && (!asOf || m.date <= asOf)), (m) => m.total);
  let seq = 0;
  const move = (rec) => {
    const m = { id: randomUUID(), seq: Date.now() + seq++, ...rec, total: round2(rec.qty * rec.unitCost) };
    D().finStock.push(m);
    return m;
  };
  // Take qty out of stock, oldest lots first. Returns the movements made.
  function takeOut(item, qty, rec) {
    if (qty > onHand(item.id) + 1e-9) fail(`Only ${onHand(item.id)} ${item.unit} of ${item.description} in stock.`);
    const lots = movements(item.id).filter((m) => m.qty > 0).map((m) => ({ m, left: round2(m.qty - sum(D().finStock.filter((x) => x.lotId === m.id), (x) => -x.qty)) })).filter((l) => l.left > 0);
    const out = [];
    let need = qty;
    for (const l of lots) {
      if (need <= 0) break;
      const take = Math.min(need, l.left);
      out.push(move({ ...rec, itemId: item.id, qty: -take, unitCost: l.m.unitCost, lotId: l.m.id }));
      need = round2(need - take);
    }
    return out;
  }
  const expenseOf = (code) => SUPPLY_CLASSES.find((c) => c.code === code)?.expense || '50203990';
  const semiExpenseOf = (code) => SEMI_CLASSES.find((c) => c.code === code)?.expense || ACCT.semiExpMachinery;
  const ppeClass = (code) => PPE_CLASSES.find((c) => c.code === code);

  // ----- Items (the stock catalog) -----
  const itemView = (i) => ({ ...i, onHand: onHand(i.id), value: stockValue(i.id), accountTitle: fx.accountTitle(i.code), low: i.reorderPoint > 0 && onHand(i.id) <= i.reorderPoint });
  route('GET', '/api/finance/items', 'finance', ({ user, query }) => {
    if (!mayRequest(user)) fail('Stock is for the school\'s offices.', 403);
    const staff = fx.isStaff(user);
    const q = String(query.q || '').toLowerCase();
    return D().finItems.filter((i) => (query.all || i.active !== false) && (!q || `${i.stockNo} ${i.description}`.toLowerCase().includes(q)))
      .sort((a, b) => a.stockNo.localeCompare(b.stockNo))
      .map((i) => (staff ? itemView(i) : { id: i.id, stockNo: i.stockNo, description: i.description, unit: i.unit, onHand: onHand(i.id) }));
  });
  function itemFields(body, existing) {
    const code = String(body.code ?? existing?.code ?? '');
    if (!SUPPLY_CLASSES.some((c) => c.code === code)) fail('Pick the inventory account (office supplies, drugs, fuel…).');
    const stockNo = text(body.stockNo ?? existing?.stockNo, 30).toUpperCase() || fail('Stock number is required.');
    if (D().finItems.some((i) => i.stockNo === stockNo && i.id !== existing?.id)) fail(`Stock number ${stockNo} is already used.`);
    return {
      stockNo, code, description: text(body.description ?? existing?.description, 200) || fail('Description is required.'),
      unit: text(body.unit ?? existing?.unit, 20) || fail('Unit of measure is required.'), reorderPoint: Math.max(0, Number(body.reorderPoint ?? existing?.reorderPoint) || 0),
      active: body.active !== undefined ? Boolean(body.active) : existing?.active ?? true,
    };
  }
  route('POST', '/api/finance/items', 'finance:finance.inventory', ({ user, body }) => {
    const i = { id: randomUUID(), ...itemFields(body), createdAt: iso() };
    D().finItems.push(i);
    fx.audit(user, `Added stock item ${i.stockNo} ${i.description}`, { kind: 'item', ref: i.id });
    save();
    return itemView(i);
  });
  route('PUT', '/api/finance/items/:id', 'finance:finance.inventory', ({ user, params, body }) => {
    const i = fx.byId(D().finItems, params.id) || fail('Item not found.', 404);
    const f = itemFields(body, i);
    if (f.code !== i.code && D().finStock.some((m) => m.itemId === i.id)) fail('The inventory account cannot change once the item has stock movements.');
    Object.assign(i, f);
    save();
    return itemView(i);
  });
  // Stock card: every movement with the running balance (quantity and value).
  route('GET', '/api/finance/items/:id/card', 'finance:finance.view', ({ params }) => {
    const i = fx.byId(D().finItems, params.id) || fail('Item not found.', 404);
    let qty = 0;
    let value = 0;
    const rows = movements(i.id).map((m) => {
      qty = round2(qty + m.qty);
      value = round2(value + m.total);
      return { date: m.date, kind: m.kind, ref: m.ref, office: m.office || '', in: m.qty > 0 ? m.qty : 0, out: m.qty < 0 ? -m.qty : 0, unitCost: m.unitCost, total: m.total, balance: qty, value };
    });
    return { item: itemView(i), rows };
  });

  // ----- Purchase requests -----
  const stockNo = (itemId) => (itemId ? fx.byId(D().finItems, itemId)?.stockNo || '' : '');
  const prView = (p) => ({ ...p, items: p.items.map((i) => ({ ...i, stockNo: stockNo(i.itemId) })), officeName: fx.office(p.office)?.name || p.office, poNos: D().finPos.filter((o) => o.prId === p.id && o.status !== 'cancelled').map((o) => ({ id: o.id, no: o.no })) });
  function lineItems(list, { cost = 'unitCost' } = {}) {
    const items = (Array.isArray(list) ? list : []).map((l) => {
      const item = l.itemId ? fx.byId(D().finItems, l.itemId) || fail('Stock item not found.') : null;
      const qty = Number(l.qty);
      if (!(qty > 0)) fail('Each line needs a quantity.');
      const unitCost = fx.money(l[cost] ?? l.unitCost, 'Unit cost', { allowZero: true });
      return { itemId: item?.id || null, description: text(l.description || item?.description, 300) || fail('Each line needs a description.'), unit: text(l.unit || item?.unit, 20) || 'unit', qty, unitCost, amount: round2(qty * unitCost) };
    });
    if (!items.length) fail('Add at least one item.');
    return items;
  }
  const mayRequest = (u) => u.role !== 'student' && u.role !== 'guardian';
  route('GET', '/api/finance/prs', 'finance', ({ user, query }) => {
    const mine = !can(user.role, 'finance.view');
    return D().finPrs.filter((p) => (!mine || p.requestedBy?.userId === user.id) && (!query.status || p.status === query.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(prView);
  });
  route('GET', '/api/finance/prs/:id', 'finance', ({ user, params }) => {
    const p = fx.byId(D().finPrs, params.id) || fail('Purchase request not found.', 404);
    if (!can(user.role, 'finance.view') && p.requestedBy?.userId !== user.id) fail('Purchase request not found.', 404);
    return prView(p);
  });
  route('POST', '/api/finance/prs', 'finance', ({ user, body }) => {
    if (!mayRequest(user)) fail('Purchase requests are filed by the school\'s offices.', 403);
    const items = lineItems(body.items);
    const p = {
      id: randomUUID(), no: '', date: fx.date(body.date || fx.today()), fund: fx.fund(String(body.fund || S().funds[0])), office: String(body.office || ''),
      purpose: text(body.purpose, 500) || fail('Purpose is required.'), items, total: sum(items, (i) => i.amount),
      status: body.submit ? 'submitted' : 'draft', requestedBy: { userId: user.id, name: user.name, title: text(body.requesterTitle, 120) }, createdAt: iso(),
    };
    p.no = fx.nextNo('pr', { date: p.date });
    D().finPrs.push(p);
    fx.audit(user, `Prepared PR ${p.no}: ${p.purpose}`, { kind: 'pr', ref: p.id });
    save();
    return prView(p);
  });
  route('POST', '/api/finance/prs/:id/:action', 'finance', ({ user, params, body }) => {
    const p = fx.byId(D().finPrs, params.id) || fail('Purchase request not found.', 404);
    const own = p.requestedBy?.userId === user.id;
    if (params.action === 'submit') {
      if (!own && !can(user.role, 'finance.procure')) fail('Not your request.', 403);
      if (p.status !== 'draft') fail('Already submitted.');
      p.status = 'submitted';
    } else if (params.action === 'approve') {
      if (!can(user.role, 'finance.approve')) fail('Only the approving officer approves purchase requests.', 403);
      if (p.status !== 'submitted') fail('Only a submitted request can be approved.');
      if (own) fail('You cannot approve your own request.');
      Object.assign(p, { status: 'approved', approvedBy: { name: user.name, title: fx.signatory('head').title }, approvedAt: iso() });
    } else if (params.action === 'cancel') {
      if (!own && !can(user.role, 'finance.procure') && !can(user.role, 'finance.approve')) fail('Not your request.', 403);
      if (['ordered', 'cancelled'].includes(p.status)) fail('An ordered or cancelled request cannot be cancelled.');
      Object.assign(p, { status: 'cancelled', cancelReason: text(body.reason, 300) });
    } else fail('Unknown action.', 404);
    fx.audit(user, `${params.action === 'approve' ? 'Approved' : params.action === 'cancel' ? 'Cancelled' : 'Submitted'} PR ${p.no}`, { kind: 'pr', ref: p.id });
    save();
    return prView(p);
  });

  // ----- Purchase orders -----
  const objectCode = (l) => (l.category === 'supply' ? expenseOf(l.code) : l.category === 'semi' ? semiExpenseOf(l.code) : l.code);
  const poView = (o) => ({
    ...o, supplierName: fx.cardName(o.supplierId), prNo: fx.byId(D().finPrs, o.prId)?.no || '',
    ors: o.orsId ? (({ id, no, status, form }) => ({ id, no, status, form }))(fx.byId(D().finObligations, o.orsId) || {}) : null,
    iars: D().finIars.filter((i) => i.poId === o.id).map((i) => ({ id: i.id, no: i.no, date: i.date, total: i.total, liquidatedDamages: i.liquidatedDamages })),
    items: o.items.map((l) => ({ ...l, stockNo: stockNo(l.itemId), accountTitle: fx.accountTitle(l.code), objectCode: objectCode(l) })),
  });
  route('GET', '/api/finance/pos', 'finance:finance.view', ({ query }) => D().finPos.filter((o) => !query.status || o.status === query.status || (query.status === 'open' && ['approved', 'partial'].includes(o.status))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(poView));
  route('GET', '/api/finance/pos/:id', 'finance:finance.view', ({ params }) => poView(fx.byId(D().finPos, params.id) || fail('Purchase order not found.', 404)));
  function poItems(list) {
    const base = lineItems(list);
    return base.map((l, idx) => {
      const src = list[idx];
      const category = CATEGORIES.includes(src.category) ? src.category : fail(`${l.description}: is it a supply, semi-expendable property, PPE or a service?`);
      let code = String(category === 'supply' && src.itemId ? fx.byId(D().finItems, src.itemId).code : src.code || '');
      if (category === 'supply' && !SUPPLY_CLASSES.some((c) => c.code === code)) fail(`${l.description}: pick its inventory account.`);
      if (category === 'semi' && !SEMI_CLASSES.some((c) => c.code === code)) fail(`${l.description}: pick its semi-expendable property account.`);
      if (category === 'ppe' && !ppeClass(code)) fail(`${l.description}: pick its property, plant and equipment account.`);
      if (category === 'service' && classOf(code) !== 'MOOE') fail(`${l.description}: pick the MOOE expense account for the service.`);
      if (category === 'ppe' && l.unitCost < S().capitalization) fail(`${l.description}: ₱${l.unitCost.toLocaleString()} is below the ₱${S().capitalization.toLocaleString()} capitalization threshold; it is semi-expendable property.`);
      if (category === 'semi' && l.unitCost >= S().capitalization) fail(`${l.description}: ₱${l.unitCost.toLocaleString()} is at or above the capitalization threshold; it is PPE.`);
      if (category === 'supply' && !src.itemId) fail(`${l.description}: supplies come from the stock catalog (Inventory → Stock).`);
      fx.account(code);
      return { ...l, category, code, delivered: 0 };
    });
  }
  route('POST', '/api/finance/pos', 'finance:finance.procure', ({ user, body }) => {
    const pr = body.prId ? fx.byId(D().finPrs, body.prId) || fail('Purchase request not found.') : null;
    if (pr && pr.status !== 'approved') fail('The purchase request must be approved first.');
    const supplier = fx.card(body.supplierId);
    if (supplier.status === 'blacklisted') fail(`${supplier.name} is blacklisted.`);
    const items = poItems(body.items);
    const date = fx.date(body.date || fx.today());
    const o = {
      id: randomUUID(), no: fx.nextNo('po', { date }), date, prId: pr?.id || null, supplierId: supplier.id, fund: fx.fund(String(body.fund || pr?.fund || S().funds[0])),
      mode: PROCUREMENT_MODES.includes(body.mode) ? body.mode : PROCUREMENT_MODES[0], office: String(body.office || pr?.office || ''),
      place: text(body.place, 200), deliveryDate: fx.date(body.deliveryDate, 'Delivery date'), deliveryTerm: text(body.deliveryTerm, 120), paymentTerm: text(body.paymentTerm, 120),
      quotes: (Array.isArray(body.quotes) ? body.quotes : []).filter((q) => q.supplierId && Number(q.amount) > 0).map((q) => ({ supplierId: fx.card(q.supplierId).id, amount: round2(q.amount) })),
      items, total: sum(items, (i) => i.amount), status: 'draft', orsId: null, createdAt: iso(), createdBy: user.name,
    };
    if (o.deliveryDate < date) fail('Delivery date is before the order date.');
    if (o.mode === 'Small Value Procurement' && o.total > S().svpLimit) fail(`Small Value Procurement is for contracts up to ₱${S().svpLimit.toLocaleString()} (RA 12009 IRR); this order is ₱${o.total.toLocaleString()}.`);
    if (o.mode === 'Direct Acquisition' && o.total > S().directAcquisitionLimit) fail(`Direct Acquisition is for contracts up to ₱${S().directAcquisitionLimit.toLocaleString()}; this order is ₱${o.total.toLocaleString()}.`);
    D().finPos.push(o);
    if (pr) pr.status = 'ordered';
    fx.audit(user, `Prepared PO ${o.no} to ${supplier.name}: ₱${o.total.toLocaleString()}`, { kind: 'po', ref: o.id });
    save();
    return poView(o);
  });
  // The obligation request for a PO: object codes grouped, each class charged to the allotment picked.
  route('POST', '/api/finance/pos/:id/ors', 'finance:finance.procure', ({ user, params, body }) => {
    const o = fx.byId(D().finPos, params.id) || fail('Purchase order not found.', 404);
    if (o.status !== 'draft') fail('Only a draft PO needs an obligation request.');
    if (o.orsId && fx.byId(D().finObligations, o.orsId)?.status !== 'cancelled') fail('This PO already has an obligation request.');
    const byCode = {};
    for (const l of o.items) byCode[objectCode(l)] = round2((byCode[objectCode(l)] || 0) + l.amount);
    const lines = Object.entries(byCode).map(([code, amount]) => {
      const cls = classOf(code);
      const allotmentId = body.allotments?.[cls] || fail(`Pick the ${cls} allotment to charge.`);
      return { allotmentId, code, amount };
    });
    const pr = fx.byId(D().finPrs, o.prId);
    const ors = fx.createObligation(user, {
      fund: o.fund, payeeId: o.supplierId, office: o.office, date: o.date, submit: true,
      particulars: `To obligate payment for PO ${o.no}${pr ? ` (PR ${pr.no})` : ''}: ${o.items.map((i) => i.description).slice(0, 3).join('; ')}${o.items.length > 3 ? '…' : ''}`,
      requestedBy: pr?.requestedBy || { name: user.name, title: '' }, lines,
    }, { kind: 'po', id: o.id });
    o.orsId = ors.id;
    save();
    return poView(o);
  });
  route('POST', '/api/finance/pos/:id/approve', 'finance:finance.approve', ({ user, params }) => {
    const o = fx.byId(D().finPos, params.id) || fail('Purchase order not found.', 404);
    if (o.status !== 'draft') fail('This PO is not a draft.');
    const ors = fx.byId(D().finObligations, o.orsId);
    if (ors?.status !== 'obligated') fail('The PO\'s obligation request must be obligated by the budget office first (funds available).');
    if (sum(ors.lines, fx.lineObligated) + 0.001 < o.total) fail(`The obligation (₱${sum(ors.lines, fx.lineObligated).toLocaleString()}) is less than the PO (₱${o.total.toLocaleString()}).`);
    Object.assign(o, { status: 'approved', approvedBy: { name: user.name, title: fx.signatory('head').title }, approvedAt: iso() });
    fx.audit(user, `Approved PO ${o.no}`, { kind: 'po', ref: o.id });
    save();
    return poView(o);
  });
  route('POST', '/api/finance/pos/:id/cancel', 'finance:finance.procure', ({ user, params, body }) => {
    const o = fx.byId(D().finPos, params.id) || fail('Purchase order not found.', 404);
    if (D().finIars.some((i) => i.poId === o.id)) fail('Deliveries were accepted on this PO.');
    if (o.status === 'cancelled') fail('Already cancelled.');
    o.status = 'cancelled';
    o.cancelReason = text(body.reason, 300);
    const ors = fx.byId(D().finObligations, o.orsId);
    if (ors && ors.status === 'draft') ors.status = 'cancelled';
    const pr = fx.byId(D().finPrs, o.prId);
    if (pr && pr.status === 'ordered' && !D().finPos.some((x) => x.prId === pr.id && x.status !== 'cancelled')) pr.status = 'approved';
    fx.audit(user, `Cancelled PO ${o.no}${ors?.status === 'obligated' ? ' (its ORS stays obligated; cancel or adjust it in Budget)' : ''}`, { kind: 'po', ref: o.id });
    save();
    return poView(o);
  });

  // ----- Inspection and acceptance -----
  const iarView = (i) => ({ ...i, po: (({ id, no, deliveryDate }) => ({ id, no, deliveryDate }))(fx.byId(D().finPos, i.poId) || {}), supplierName: fx.cardName(i.supplierId), jevNo: fx.byId(D().finJournals, i.journalId)?.jevNo || '' });
  route('GET', '/api/finance/iars', 'finance:finance.view', ({ query }) => D().finIars.filter((i) => !query.poId || i.poId === query.poId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(iarView));
  route('GET', '/api/finance/iars/:id', 'finance:finance.view', ({ params }) => iarView(fx.byId(D().finIars, params.id) || fail('IAR not found.', 404)));
  route('POST', '/api/finance/iars', 'finance:finance.inventory', ({ user, body }) => {
    const o = fx.byId(D().finPos, body.poId) || fail('Purchase order not found.');
    if (!['approved', 'partial'].includes(o.status)) fail('Only an approved PO can receive deliveries.');
    const date = fx.date(body.date || fx.today());
    fx.assertOpen(date);
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => {
      const pl = o.items[Number(l.line)] || fail('Unknown PO line.');
      const qty = Number(l.qty);
      if (!(qty > 0)) return null;
      if (qty > pl.qty - pl.delivered + 1e-9) fail(`${pl.description}: only ${pl.qty - pl.delivered} ${pl.unit} left to deliver.`);
      if (['semi', 'ppe'].includes(pl.category) && !Number.isInteger(qty)) fail(`${pl.description}: property is received in whole units.`);
      return { line: Number(l.line), qty, amount: round2(qty * pl.unitCost) };
    }).filter(Boolean);
    if (!lines.length) fail('Enter the quantity delivered for at least one item.');
    const total = sum(lines, (l) => l.amount);
    const daysLate = Math.max(0, Math.floor((Date.parse(`${date}T00:00:00`) - Date.parse(`${o.deliveryDate}T00:00:00`)) / 86400000));
    const iar = {
      id: randomUUID(), no: fx.nextNo('iar', { date }), date, poId: o.id, supplierId: o.supplierId, fund: o.fund, office: o.office,
      invoiceNo: text(body.invoiceNo, 40) || fail('Invoice number is required.'), invoiceDate: fx.date(body.invoiceDate || date, 'Invoice date'),
      inspectedBy: text(body.inspectedBy, 120) || fx.signatory('inspector').name || fail('Who inspected the delivery?'), inspectedDate: date,
      acceptedBy: user.name, lines, total, daysLate, createdAt: iso(),
    };
    // Liquidated damages: 1/10 of 1% of the late items per day, at most 10% of the contract in all.
    const ldSoFar = sum(D().finIars.filter((x) => x.poId === o.id), (x) => x.liquidatedDamages);
    iar.liquidatedDamages = Math.max(0, Math.min(round2(total * 0.001 * daysLate), round2(o.total * 0.1 - ldSoFar)));
    iar.ldCapReached = round2(ldSoFar + iar.liquidatedDamages) >= round2(o.total * 0.1) && daysLate > 0;
    // Receive: supplies into stock, property registered, the liability booked.
    const debit = {};
    for (const l of lines) {
      const pl = o.items[l.line];
      pl.delivered = round2(pl.delivered + l.qty);
      const dr = pl.category === 'service' ? pl.code : pl.code;
      debit[dr] = round2((debit[dr] || 0) + l.amount);
      if (pl.category === 'supply') move({ itemId: pl.itemId, date, kind: 'receipt', qty: l.qty, unitCost: pl.unitCost, ref: { kind: 'iar', id: iar.id, no: iar.no } });
      if (['semi', 'ppe'].includes(pl.category)) {
        for (let n = 0; n < l.qty; n++) registerProperty({ type: pl.category, description: pl.description, code: pl.code, cost: pl.unitCost, acquired: date, fund: o.fund, office: o.office, source: { kind: 'iar', id: iar.id, no: iar.no } }, user);
      }
    }
    const j = fx.postJournal({
      date, fund: o.fund, journal: 'GJ', user, particulars: `Delivery accepted, IAR ${iar.no}, PO ${o.no}, invoice ${iar.invoiceNo} – ${fx.cardName(o.supplierId)}`,
      lines: [...Object.entries(debit).map(([code, amt]) => ({ code, debit: amt, office: o.office })), { code: ACCT.payable, credit: total, cardId: o.supplierId }],
      source: { kind: 'iar', id: iar.id },
    });
    iar.journalId = j.id;
    o.status = o.items.every((l) => l.delivered >= l.qty - 1e-9) ? 'delivered' : 'partial';
    iar.complete = o.status === 'delivered';
    D().finIars.push(iar);
    fx.audit(user, `Accepted delivery IAR ${iar.no} on PO ${o.no}: ₱${total.toLocaleString()}${daysLate ? ` (${daysLate} days late)` : ''}`, { kind: 'iar', ref: iar.id });
    save();
    return iarView(iar);
  });

  // ----- Requisition and issue slips -----
  const risView = (r) => ({ ...r, officeName: fx.office(r.office)?.name || r.office, items: r.items.map((l) => ({ ...l, ...(({ stockNo, description, unit }) => ({ stockNo, description, unit }))(fx.byId(D().finItems, l.itemId) || {}), onHand: onHand(l.itemId) })) });
  route('GET', '/api/finance/ris', 'finance', ({ user, query }) => {
    const mine = !can(user.role, 'finance.view');
    return D().finRis.filter((r) => (!mine || r.requestedBy.userId === user.id) && (!query.status || r.status === query.status || (query.status === 'open' && ['requested', 'approved'].includes(r.status)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(risView);
  });
  route('GET', '/api/finance/ris/:id', 'finance', ({ user, params }) => {
    const r = fx.byId(D().finRis, params.id) || fail('Requisition not found.', 404);
    if (!can(user.role, 'finance.view') && r.requestedBy.userId !== user.id) fail('Requisition not found.', 404);
    return risView(r);
  });
  route('POST', '/api/finance/ris', 'finance', ({ user, body }) => {
    if (!mayRequest(user)) fail('Requisitions are filed by the school\'s offices.', 403);
    const items = (Array.isArray(body.items) ? body.items : []).map((l) => {
      const item = fx.byId(D().finItems, l.itemId) || fail('Pick items from the stock list.');
      const qty = Number(l.qty);
      if (!(qty > 0)) fail(`${item.description}: enter the quantity.`);
      return { itemId: item.id, qty, issued: 0 };
    });
    if (!items.length) fail('Add at least one item.');
    const date = fx.date(body.date || fx.today());
    const r = { id: randomUUID(), no: fx.nextNo('ris', { date }), date, office: String(body.office || ''), purpose: text(body.purpose, 300) || fail('Purpose is required.'), items, status: 'requested', requestedBy: { userId: user.id, name: user.name }, createdAt: iso() };
    D().finRis.push(r);
    fx.audit(user, `Requested supplies, RIS ${r.no}`, { kind: 'ris', ref: r.id });
    save();
    return risView(r);
  });
  route('POST', '/api/finance/ris/:id/:action', 'finance', ({ user, params, body }) => {
    const r = fx.byId(D().finRis, params.id) || fail('Requisition not found.', 404);
    const supply = can(user.role, 'finance.inventory');
    // Nobody approves or issues their own requisition: another supply officer or an administrator does.
    const own = r.requestedBy.userId === user.id && user.role !== 'admin';
    if (params.action === 'approve') {
      if (!supply) fail('Only the supply office approves requisitions.', 403);
      if (own) fail('This is your own requisition: another supply officer or an administrator approves it.', 403);
      if (r.status !== 'requested') fail('Only a new requisition can be approved.');
      Object.assign(r, { status: 'approved', approvedBy: user.name, approvedAt: iso() });
    } else if (params.action === 'issue') {
      if (!supply) fail('Only the supply office issues supplies.', 403);
      if (own) fail('This is your own requisition: another supply officer or an administrator issues it.', 403);
      if (!['requested', 'approved'].includes(r.status)) fail('This requisition is not open.');
      const date = fx.date(body.date || fx.today());
      fx.assertOpen(date);
      if (date > fx.today()) fail('Supplies cannot be issued with a future date.');
      const qtys = body.qty || {};
      let any = false;
      for (const l of r.items) {
        const q = qtys[l.itemId] !== undefined ? Number(qtys[l.itemId]) : l.qty;
        if (!(q >= 0) || q > l.qty) fail('Issue at most the quantity requested.');
        if (!q) continue;
        takeOut(fx.byId(D().finItems, l.itemId), q, { date, kind: 'issue', office: r.office, ref: { kind: 'ris', id: r.id, no: r.no } });
        l.issued = q;
        any = true;
      }
      if (!any) fail('Nothing to issue.');
      Object.assign(r, { status: 'issued', issuedBy: user.name, issuedDate: date, receivedBy: text(body.receivedBy, 120) || r.requestedBy.name, approvedBy: r.approvedBy || user.name });
    } else if (params.action === 'cancel') {
      if (!supply && r.requestedBy.userId !== user.id) fail('Not your requisition.', 403);
      if (!['requested', 'approved'].includes(r.status)) fail('Only an open requisition can be cancelled.');
      Object.assign(r, { status: 'cancelled', cancelReason: text(body.reason, 300) });
    } else fail('Unknown action.', 404);
    fx.audit(user, `${{ approve: 'Approved', issue: 'Issued supplies on', cancel: 'Cancelled' }[params.action]} RIS ${r.no}`, { kind: 'ris', ref: r.id });
    save();
    return risView(r);
  });

  // ----- RSMI: supplies issued in a month, and its journal entry -----
  function rsmi(month) {
    const issues = D().finStock.filter((m) => m.kind === 'issue' && m.date.slice(0, 7) === month);
    const rows = issues.map((m) => {
      const i = fx.byId(D().finItems, m.itemId);
      return { date: m.date, risNo: m.ref?.no, office: m.office, stockNo: i.stockNo, description: i.description, unit: i.unit, qty: -m.qty, unitCost: m.unitCost, amount: -m.total, code: i.code, expense: expenseOf(i.code), posted: Boolean(m.journalId) };
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.risNo || '').localeCompare(b.risNo || ''));
    const recap = {};
    for (const r of rows) {
      const k = `${r.expense}|${r.code}`;
      recap[k] ||= { expense: r.expense, expenseTitle: fx.accountTitle(r.expense), code: r.code, title: fx.accountTitle(r.code), amount: 0 };
      recap[k].amount = round2(recap[k].amount + r.amount);
    }
    return { issues, rows, recap: Object.values(recap), total: sum(rows, (r) => r.amount), unposted: issues.filter((m) => !m.journalId).length };
  }
  route('GET', '/api/finance/rsmi', 'finance:finance.view', ({ query }) => {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : fx.today().slice(0, 7);
    const { issues, ...out } = rsmi(month);
    return { month, ...out, jevNos: [...new Set(issues.map((m) => fx.byId(D().finJournals, m.journalId)?.jevNo).filter(Boolean))] };
  });
  route('POST', '/api/finance/rsmi', 'finance:finance.inventory', ({ user, body }) => {
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : fail('Pick the month.');
    const fund = fx.fund(String(body.fund || S().funds[0]));
    const { issues } = rsmi(month);
    const todo = issues.filter((m) => !m.journalId);
    if (!todo.length) fail('Every issue in that month is already in a journal entry.');
    const debit = {};
    const credit = {};
    for (const m of todo) {
      const code = fx.byId(D().finItems, m.itemId).code;
      const k = `${expenseOf(code)}|${m.office || ''}`;
      debit[k] = round2((debit[k] || 0) - m.total);
      credit[code] = round2((credit[code] || 0) - m.total);
    }
    const date = fx.monthEnd(month) > fx.today() ? fx.today() : fx.monthEnd(month);
    const j = fx.postJournal({
      date, fund, journal: 'GJ', user, particulars: `Supplies and materials issued in ${fx.monthLabel(month)} (RSMI)`,
      lines: [...Object.entries(debit).map(([k, amt]) => ({ code: k.split('|')[0], office: k.split('|')[1], debit: amt })), ...Object.entries(credit).map(([code, amt]) => ({ code, credit: amt }))],
      source: { kind: 'rsmi', month },
    });
    for (const m of todo) m.journalId = j.id;
    save();
    return fx.journalView(j);
  });

  // ----- Physical count of inventories (RPCI) -----
  route('GET', '/api/finance/inventory-count', 'finance:finance.view', ({ query }) => {
    const asOf = query.asOf || fx.today();
    return {
      asOf,
      rows: D().finItems.filter((i) => i.active !== false).sort((a, b) => a.code.localeCompare(b.code) || a.stockNo.localeCompare(b.stockNo)).map((i) => {
        const q = onHand(i.id, asOf);
        const v = stockValue(i.id, asOf);
        return { id: i.id, stockNo: i.stockNo, description: i.description, unit: i.unit, code: i.code, title: fx.accountTitle(i.code), qty: q, unitValue: q ? round2(v / q) : 0, value: v };
      }),
      counts: D().finCounts.slice(-10).reverse(),
    };
  });
  route('POST', '/api/finance/inventory-count', 'finance:finance.inventory', ({ user, body }) => {
    const date = fx.date(body.asOf || fx.today());
    const fund = fx.fund(String(body.fund || S().funds[0]));
    const counts = body.counts || {};
    fx.assertOpen(date);
    if (date > fx.today()) fail('A count cannot be dated in the future.');
    const latest = D().finStock.filter((m) => m.itemId in counts).map((m) => m.date).sort().at(-1);
    if (latest && date < latest) fail(`Stock moved on ${latest}, after the count date. Record the count as of ${latest} or later (the cards must show what was on hand that day).`);
    const dr = {};
    const cr = {};
    const diffs = [];
    for (const [id, counted] of Object.entries(counts)) {
      const i = fx.byId(D().finItems, id) || fail('Item not found.');
      const c = Number(counted);
      if (!(c >= 0)) fail(`${i.description}: count must be zero or more.`);
      const diff = round2(c - onHand(i.id, date));
      if (!diff) continue;
      if (diff < 0) {
        const out = takeOut(i, -diff, { date, kind: 'adjust', ref: { kind: 'count', no: 'Physical count' } });
        const value = -sum(out, (m) => m.total);
        dr[ACCT.lossOfAssets] = round2((dr[ACCT.lossOfAssets] || 0) + value);
        cr[i.code] = round2((cr[i.code] || 0) + value);
        diffs.push({ itemId: i.id, description: i.description, diff, value: -value });
      } else {
        const last = movements(i.id).filter((m) => m.qty > 0).at(-1);
        const m = move({ itemId: i.id, date, kind: 'adjust', qty: diff, unitCost: last?.unitCost || 0, ref: { kind: 'count', no: 'Physical count' } });
        dr[i.code] = round2((dr[i.code] || 0) + m.total);
        cr[ACCT.miscIncome] = round2((cr[ACCT.miscIncome] || 0) + m.total);
        diffs.push({ itemId: i.id, description: i.description, diff, value: m.total });
      }
    }
    let journalId = null;
    const lines = [...Object.entries(dr).map(([code, debit]) => ({ code, debit })), ...Object.entries(cr).map(([code, credit]) => ({ code, credit }))].filter((l) => l.debit || l.credit);
    if (lines.length) journalId = fx.postJournal({ date, fund, journal: 'GJ', user, particulars: `Physical count of inventories as of ${date}: shortages and overages`, lines, source: { kind: 'count' } }).id;
    const rec = { id: randomUUID(), asOf: date, by: user.name, diffs, journalId, at: iso() };
    D().finCounts.push(rec);
    fx.audit(user, `Physical count as of ${date}: ${diffs.length} difference${diffs.length === 1 ? '' : 's'}`, { kind: 'count', ref: rec.id });
    save();
    return rec;
  });

  // ----- Property -----
  function registerProperty(p, user) {
    // Semi-expendable property carries the useful life of its PPE class too (printed on the ICS).
    const life = Number(p.life) || ppeClass(p.type === 'ppe' ? p.code : p.code.replace(/^10405/, '10605').replace(/^10406/, '10607'))?.life || 5;
    const rec = {
      id: randomUUID(), propertyNo: p.propertyNo || fx.nextNo('property', { date: p.acquired }), type: p.type, description: text(p.description, 300), code: p.code,
      fund: p.fund, cost: round2(p.cost), acquired: p.acquired, life, residual: p.type === 'ppe' ? round2((p.cost * S().residualRate) / 100) : 0,
      serialNo: text(p.serialNo, 60), office: p.office || '', location: text(p.location, 120), status: 'in-stock', custodianId: null, docNo: '',
      depBooked: round2(p.depBooked || 0), expensed: Boolean(p.expensed), history: [{ date: p.acquired, action: 'Received', docNo: p.source?.no || '', by: user?.name || 'System', note: p.note || '' }],
      source: p.source || { kind: 'manual' }, createdAt: iso(),
    };
    D().finProperty.push(rec);
    return rec;
  }
  const highValue = (p) => p.type === 'semi' && p.cost >= S().semiHighValue;
  const propertyView = (p, detail = false) => {
    const dep = p.type === 'ppe' ? depreciation({ cost: p.cost, residual: p.residual, lifeYears: p.life, acquired: p.acquired }, fx.today().slice(0, 7)) : null;
    const out = {
      ...p, accountTitle: fx.accountTitle(p.code), custodianName: fx.cardName(p.custodianId), officeName: fx.office(p.office)?.name || p.office,
      valueClass: p.type === 'semi' ? (highValue(p) ? 'High value (SPHV)' : 'Low value (SPLV)') : 'PPE',
      bookValue: p.type === 'ppe' ? round2(p.cost - p.depBooked) : 0, depreciationToDate: dep?.accumulated || 0, monthly: dep?.monthly || 0,
    };
    if (detail && dep) {
      const sched = [];
      const [y] = p.acquired.split('-').map(Number);
      for (let yr = y; yr <= y + p.life; yr++) {
        const d = depreciation({ cost: p.cost, residual: p.residual, lifeYears: p.life, acquired: p.acquired }, `${yr}-12`);
        sched.push({ year: yr, accumulated: d.accumulated, bookValue: d.bookValue });
        if (d.fully) break;
      }
      out.schedule = sched;
    }
    return out;
  };
  route('GET', '/api/finance/property', 'finance:finance.view', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return D().finProperty.filter((p) => (!query.type || p.type === query.type) && (!query.status || p.status === query.status || (query.status === 'active' && p.status !== 'disposed'))
      && (!query.custodianId || p.custodianId === query.custodianId) && (!q || `${p.propertyNo} ${p.description} ${p.serialNo} ${fx.cardName(p.custodianId)}`.toLowerCase().includes(q)))
      .sort((a, b) => b.acquired.localeCompare(a.acquired) || a.propertyNo.localeCompare(b.propertyNo)).map((p) => propertyView(p));
  });
  route('GET', '/api/finance/property/:id', 'finance:finance.view', ({ params }) => propertyView(fx.byId(D().finProperty, params.id) || fail('Property not found.', 404), true));
  // Register property already on the books (beginning balances, donations recorded by a JEV).
  route('POST', '/api/finance/property', 'finance:finance.property', ({ user, body }) => {
    const type = ['ppe', 'semi'].includes(body.type) ? body.type : fail('PPE or semi-expendable?');
    const code = String(body.code || '');
    if (type === 'ppe' ? !ppeClass(code) : !SEMI_CLASSES.some((c) => c.code === code)) fail('Pick the property account.');
    const cost = fx.money(body.cost, 'Acquisition cost');
    if (type === 'ppe' && cost < S().capitalization) fail(`Below the ₱${S().capitalization.toLocaleString()} capitalization threshold: register it as semi-expendable.`);
    if (type === 'semi' && cost >= S().capitalization) fail('At or above the capitalization threshold: register it as PPE.');
    const acquired = fx.date(body.acquired, 'Date acquired');
    const p = registerProperty({ type, code, cost, acquired, description: text(body.description, 300) || fail('Description is required.'), fund: fx.fund(String(body.fund || S().funds[0])), office: String(body.office || ''), location: body.location, serialNo: body.serialNo, life: body.life, depBooked: type === 'ppe' ? fx.money(body.depBooked || 0, 'Accumulated depreciation', { allowZero: true }) : 0, expensed: type === 'semi' ? body.expensed !== false : false, note: 'Registered (already on the books)', propertyNo: text(body.propertyNo, 40) }, user);
    if (D().finProperty.filter((x) => x.propertyNo === p.propertyNo).length > 1) {
      D().finProperty.pop();
      fail(`Property number ${p.propertyNo} is already used.`);
    }
    if (p.depBooked > p.cost - p.residual) {
      D().finProperty.pop();
      fail('Accumulated depreciation cannot exceed cost less residual value.');
    }
    fx.audit(user, `Registered property ${p.propertyNo} ${p.description}`, { kind: 'property', ref: p.id });
    save();
    return propertyView(p);
  });
  // Issue to a custodian (PAR or ICS), transfer (PTR/ITR), return, dispose (IIRUP).
  route('POST', '/api/finance/property/:id/:action', 'finance:finance.property', ({ user, params, body }) => {
    const p = fx.byId(D().finProperty, params.id) || fail('Property not found.', 404);
    const date = fx.date(body.date || fx.today());
    if (p.status === 'disposed') fail('This property was disposed of.');
    const doc = p.type === 'ppe' ? 'par' : 'ics';
    if (params.action === 'issue' || params.action === 'transfer') {
      const to = fx.card(body.custodianId);
      if (!['employee', 'officer'].includes(to.kind)) fail('Property is issued to an employee or accountable officer.');
      if (params.action === 'issue' && p.status === 'issued') fail('Already issued; transfer it instead.');
      if (params.action === 'transfer' && p.status !== 'issued') fail('Only issued property is transferred.');
      if (params.action === 'transfer' && to.id === p.custodianId) fail('Already with that custodian.');
      const ptrNo = params.action === 'transfer' ? fx.nextNo('ptr', { date }) : '';
      const docNo = fx.nextNo(doc, { date }); // the new custodian signs a new PAR/ICS
      if (params.action === 'issue' && p.type === 'semi' && !p.expensed) {
        const sc = SEMI_CLASSES.find((c) => c.code === p.code);
        fx.postJournal({ date, fund: p.fund, journal: 'GJ', user, particulars: `Issue of semi-expendable property ${p.propertyNo} to ${to.name}, ICS ${docNo}`, lines: [{ code: sc.expense, debit: p.cost, office: body.office || p.office }, { code: p.code, credit: p.cost }], source: { kind: 'ics', id: p.id } });
        p.expensed = true;
      }
      const from = fx.cardName(p.custodianId);
      Object.assign(p, { status: 'issued', custodianId: to.id, docNo, office: String(body.office || p.office || to.office || ''), location: text(body.location, 120) || p.location });
      p.history.push({ date, action: params.action === 'issue' ? `Issued (${doc.toUpperCase()})` : `Transferred from ${from} (${p.type === 'ppe' ? 'PTR' : 'ITR'} ${ptrNo}), new ${doc.toUpperCase()}`, docNo, to: to.name, by: user.name, note: text(body.reason, 300) });
    } else if (params.action === 'return') {
      if (p.status !== 'issued') fail('Only issued property is returned.');
      p.history.push({ date, action: 'Returned to the supply office', docNo: '', to: '', by: user.name, note: text(body.reason, 300) || `From ${fx.cardName(p.custodianId)}`, condition: text(body.condition, 60) });
      Object.assign(p, { status: 'returned', custodianId: null, docNo: '' });
    } else if (params.action === 'dispose') {
      fx.assertOpen(date);
      const mode = text(body.mode, 60) || fail('How was it disposed of (destruction, sale, transfer…)?');
      const docNo = fx.nextNo('iirup', { date });
      if (p.type === 'ppe') {
        // Depreciation through the month before disposal must be booked first.
        const before = prevMonthOf(date.slice(0, 7));
        const due = depreciation({ cost: p.cost, residual: p.residual, lifeYears: p.life, acquired: p.acquired }, before).accumulated;
        if (due > p.depBooked + 0.01) fail(`Book depreciation through ${fx.monthLabel(before)} first (₱${round2(due - p.depBooked).toLocaleString()} not yet booked).`);
        const pc = ppeClass(p.code);
        const book = round2(p.cost - p.depBooked);
        fx.postJournal({
          date, fund: p.fund, journal: 'GJ', user, particulars: `Derecognition of ${p.propertyNo} ${p.description} (${mode}), IIRUP ${docNo}`,
          lines: [{ code: pc.accum, debit: p.depBooked }, { code: mode.toLowerCase().includes('sale') ? ACCT.lossOnSale : ACCT.lossOfAssets, debit: book }, { code: p.code, credit: p.cost }],
          source: { kind: 'iirup', id: p.id },
        });
      }
      if (p.type === 'semi' && !p.expensed) {
        // Never issued, so still in inventory: its cost is taken out as a loss.
        fx.postJournal({ date, fund: p.fund, journal: 'GJ', user, particulars: `Derecognition of ${p.propertyNo} ${p.description} (${mode}), IIRUP ${docNo}`, lines: [{ code: ACCT.lossOfAssets, debit: p.cost }, { code: p.code, credit: p.cost }], source: { kind: 'iirup', id: p.id } });
        p.expensed = true;
      }
      p.history.push({ date, action: `Disposed of: ${mode}`, docNo, to: '', by: user.name, note: text(body.reason, 300) });
      Object.assign(p, { status: 'disposed', custodianId: null, disposal: { date, mode, docNo, appraised: round2(body.appraised || 0) } });
    } else fail('Unknown action.', 404);
    fx.audit(user, `${p.history.at(-1).action}: ${p.propertyNo} ${p.description}`, { kind: 'property', ref: p.id });
    save();
    return propertyView(p, true);
  });

  // ----- Depreciation -----
  function depreciationPlan(month) {
    const out = [];
    for (const p of D().finProperty) {
      if (p.type !== 'ppe' || p.status === 'disposed' || p.acquired.slice(0, 7) > month) continue;
      const d = depreciation({ cost: p.cost, residual: p.residual, lifeYears: p.life, acquired: p.acquired }, month);
      const amount = round2(d.accumulated - p.depBooked);
      if (amount > 0) out.push({ p, amount });
    }
    return out;
  }
  const prevMonth = () => prevMonthOf(fx.today().slice(0, 7));
  route('GET', '/api/finance/depreciation', 'finance:finance.view', ({ query }) => {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : prevMonth();
    const plan = depreciationPlan(month);
    const byClass = {};
    for (const { p, amount } of plan) {
      const k = `${p.fund}|${p.code}`;
      byClass[k] ||= { fund: p.fund, code: p.code, title: fx.accountTitle(p.code), expense: ppeClass(p.code).expense, accum: ppeClass(p.code).accum, items: 0, amount: 0 };
      byClass[k].items++;
      byClass[k].amount = round2(byClass[k].amount + amount);
    }
    return { month, bookable: month < fx.today().slice(0, 7), rows: Object.values(byClass), total: sum(plan, (x) => x.amount), runs: D().finDepRuns.slice(-24).reverse().map((r) => ({ ...r, jevNo: fx.byId(D().finJournals, r.journalId)?.jevNo || '' })) };
  });
  route('POST', '/api/finance/depreciation', 'finance:finance.property', ({ user, body }) => {
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : fail('Pick the month.');
    if (month >= fx.today().slice(0, 7)) fail('Depreciation is booked after the month ends.');
    const plan = depreciationPlan(month);
    if (!plan.length) fail(`Depreciation through ${fx.monthLabel(month)} is already booked.`);
    const out = [];
    for (const fund of [...new Set(plan.map((x) => x.p.fund))]) {
      const lines = {};
      for (const { p, amount } of plan.filter((x) => x.p.fund === fund)) {
        const pc = ppeClass(p.code);
        lines[`d|${pc.expense}`] = round2((lines[`d|${pc.expense}`] || 0) + amount);
        lines[`c|${pc.accum}`] = round2((lines[`c|${pc.accum}`] || 0) + amount);
      }
      const j = fx.postJournal({
        date: fx.monthEnd(month), fund, journal: 'GJ', user, particulars: `Depreciation of property, plant and equipment through ${fx.monthLabel(month)}`,
        lines: Object.entries(lines).map(([k, amt]) => (k[0] === 'd' ? { code: k.slice(2), debit: amt } : { code: k.slice(2), credit: amt })), source: { kind: 'depreciation', month },
      });
      for (const { p, amount } of plan.filter((x) => x.p.fund === fund)) p.depBooked = round2(p.depBooked + amount);
      const run = { id: randomUUID(), month, fund, amount: j.total, items: plan.filter((x) => x.p.fund === fund).length, journalId: j.id, by: user.name, at: iso() };
      D().finDepRuns.push(run);
      out.push(run);
    }
    save();
    return out;
  });

  // ----- Reports: RPCPPE / RPCSP, register of semi-expendable property issued -----
  route('GET', '/api/finance/property-count', 'finance:finance.view', ({ query }) => {
    const type = query.type === 'semi' ? 'semi' : 'ppe';
    const asOf = query.asOf || fx.today();
    const list = D().finProperty.filter((p) => p.type === type && p.acquired <= asOf && (p.status !== 'disposed' || p.disposal?.date > asOf) && (!query.fund || p.fund === query.fund)).map((p) => propertyView(p));
    const groups = {};
    for (const p of list) (groups[p.code] ||= { code: p.code, title: p.accountTitle, items: [], total: 0 }).items.push(p);
    for (const g of Object.values(groups)) g.total = sum(g.items, (p) => p.cost);
    return { type, asOf, groups: Object.values(groups).sort((a, b) => a.code.localeCompare(b.code)), total: sum(list, (p) => p.cost), count: list.length };
  });

  fx.ctx.financeSupply = {
    onHand,
    depreciationDue: () => depreciationPlan(prevMonth()).length,
  };
  fx.supply = { onHand, registerProperty };
}

function prevMonthOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
