// Printable forms on A4, laid out after the GAM Volume II appendices: JEV (36), ORS (11) / BURS
// (14), DV (32), PR (60), PO (61), IAR (62), RIS (63), PAR (73), ICS (59), RCD (26), LDDAP-ADA
// (42), the official receipt (AF 51) and BIR Form 2307 (certificate of creditable tax withheld).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, fmtDate } from '../../ui.js';
import { amountInWords, APPENDIX, fundName } from '/shared/finance.js';
import { fin, num, isStaff } from '../state.js';

const long = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const sig = (k) => fin.settings.signatories[k] || { name: '', title: '' };
const signBox = (label, who = {}, extra = '') => html`<div class="f-sign"><span class="f-label">${label}</span><span class="f-line">${who.name || ''}</span><span class="f-cap">${who.title || 'Printed name and position'}</span>${extra}</div>`;
const head = (title, appendix, { fund, no, date, extra = '' } = {}) => html`
  <div class="f-appendix">${appendix ? `Appendix ${appendix}` : ''}</div>
  <header class="f-head"><h1>${title}</h1><div class="f-entity"><span>Entity name: <strong>${fin.settings.entity.name}</strong></span>${fund ? html`<span>Fund cluster: <strong>${fund} · ${fundName(fund)}</strong></span>` : ''}</div>
  <div class="f-meta">${no !== undefined ? html`<span>No.: <strong>${no || '________'}</strong></span>` : ''}${date ? html`<span>Date: <strong>${long(date)}</strong></span>` : ''}${extra}</div></header>`;

const FORMS = {
  async jev(id) {
    const j = await api.get(`/api/finance/journals/${id}`);
    return html`${head('Journal Entry Voucher', APPENDIX.jev, { fund: j.fund, no: j.jevNo, date: j.date, extra: html`<span>${j.journalLabel}</span>` })}
      <table class="f-table"><thead><tr><th>Responsibility center</th><th>Accounts and explanation</th><th>UACS code</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${j.lines.map((l) => html`<tr><td>${l.office}</td><td class="${l.credit ? 'indent' : ''}">${l.title}${l.cardName ? ` — ${l.cardName}` : ''}</td><td>${l.code}</td><td class="num">${l.debit ? num(l.debit) : ''}</td><td class="num">${l.credit ? num(l.credit) : ''}</td></tr>`)}
      <tr><td></td><td colspan="2"><em>${j.particulars}</em></td><td></td><td></td></tr></tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="num">${num(j.total)}</td><td class="num">${num(j.total)}</td></tr></tfoot></table>
      <div class="f-signs">${signBox('Prepared by:', { name: j.createdBy, title: 'Accounting staff' })}${signBox('Certified correct:', sig('accountant'))}</div>`;
  },
  async ors(id) {
    const o = await api.get(`/api/finance/obligations/${id}`);
    const burs = o.form === 'BURS';
    return html`${head(burs ? 'Budget Utilization Request and Status' : 'Obligation Request and Status', burs ? APPENDIX.burs : APPENDIX.ors, { fund: o.fund, no: o.no, date: o.obligatedDate || o.date })}
      <table class="f-table f-kv"><tbody><tr><th>Payee</th><td>${o.payeeName}</td></tr><tr><th>Office</th><td>${o.officeName}</td></tr><tr><th>Address</th><td>${o.payeeAddress}</td></tr></tbody></table>
      <table class="f-table"><thead><tr><th>Responsibility center</th><th>Particulars</th><th>MFO/PAP</th><th>UACS object code</th><th class="num">Amount</th></tr></thead>
      <tbody>${o.lines.map((l, i) => html`<tr><td>${i === 0 ? o.office : ''}</td><td>${i === 0 ? o.particulars : ''}</td><td>${l.pap}</td><td>${l.uacs}</td><td class="num">${num(l.amount)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${num(o.lines.reduce((s, l) => s + l.amount, 0))}</td></tr></tfoot></table>
      <div class="f-signs"><div class="f-box"><strong>A.</strong> Certified: Charges to appropriation/allotment are necessary, lawful and under my direct supervision; and supporting documents valid, proper and legal.${signBox('', o.requestedBy || {})}</div>
        <div class="f-box"><strong>B.</strong> Certified: Allotment available and obligated for the purpose/adjustment necessary as indicated above.${signBox('', o.certifiedBy || sig('budget'))}</div></div>
      <h3 class="f-sub">C. Status of ${burs ? 'utilization' : 'obligation'}</h3>
      <table class="f-table"><thead><tr><th>UACS</th><th class="num">${burs ? 'Utilization' : 'Obligation'}</th><th class="num">Payment</th><th class="num">Not yet due</th><th class="num">Due and demandable</th></tr></thead>
      <tbody>${o.lines.map((l) => html`<tr><td>${l.uacs}</td><td class="num">${num(l.obligated)}</td><td class="num">${num(l.disbursed)}</td><td class="num">${num(l.available)}</td><td class="num">${num(l.pending)}</td></tr>`)}</tbody></table>`;
  },
  async dv(id) {
    const d = await api.get(`/api/finance/dvs/${id}`);
    const mode = (k) => html`<span class="f-check">${d.mode === k ? '☒' : '☐'}</span>`;
    return html`${head('Disbursement Voucher', APPENDIX.dv, { fund: d.fund, no: d.no, date: d.date })}
      <table class="f-table f-kv"><tbody>
        <tr><th>Mode of payment</th><td colspan="3">${mode('check')} MDS check &nbsp; ${mode('bank')} Commercial check &nbsp; ${mode('ada')} ADA &nbsp; ${mode('cash')} Others</td></tr>
        <tr><th>Payee</th><td>${d.payee.name}</td><th>TIN / employee no.</th><td>${d.payee.tin || ''}</td></tr>
        <tr><th>Address</th><td>${d.payee.address || ''}</td><th>ORS/BURS no.</th><td>${d.ors?.no || ''}</td></tr></tbody></table>
      <table class="f-table"><thead><tr><th>Particulars</th><th>Responsibility center</th><th>MFO/PAP</th><th class="num">Amount</th></tr></thead>
      <tbody><tr><td>${d.particulars}${d.taxes.length || d.deductions.length ? html`<div class="f-small">Gross ${num(d.gross)}${d.taxes.map((t) => html`<br />Less ${t.atc} ${t.rate}%: ${num(t.amount)}`)}${d.deductions.map((x) => html`<br />Less ${x.label}: ${num(x.amount)}`)}</div>` : ''}</td><td>${d.office}</td><td>${d.pap}</td><td class="num">${num(d.gross)}</td></tr></tbody>
      <tfoot><tr><td colspan="3">Amount due</td><td class="num">${num(d.net)}</td></tr></tfoot></table>
      <div class="f-box"><strong>A.</strong> Certified: Expenses/Cash Advance necessary, lawful and incurred under my direct supervision.${signBox('', d.boxA)}</div>
      <div class="f-box"><strong>B.</strong> Accounting Entry:
        <table class="f-table"><thead><tr><th>Account title</th><th>UACS code</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${d.entry.map((l) => html`<tr><td class="${l.credit ? 'indent' : ''}">${l.title}</td><td>${l.code}</td><td class="num">${l.debit ? num(l.debit) : ''}</td><td class="num">${l.credit ? num(l.credit) : ''}</td></tr>`)}</tbody></table></div>
      <div class="f-signs"><div class="f-box"><strong>C.</strong> Certified: ☒ Cash available ☒ Subject to Authority to Debit Account (when applicable) ☒ Supporting documents complete and amount claimed proper.${signBox('', d.certifiedBy ? { name: d.certifiedBy.name, title: d.certifiedBy.title } : sig('accountant'), html`<span class="f-cap">Date: ${d.certifiedBy ? fmtDate(d.certifiedBy.at.slice(0, 10)) : ''}</span>`)}</div>
        <div class="f-box"><strong>D.</strong> Approved for payment: <em>${amountInWords(d.net)}</em>${signBox('', d.approvedBy ? { name: d.approvedBy.name, title: d.approvedBy.title } : sig('head'), html`<span class="f-cap">Date: ${d.approvedBy ? fmtDate(d.approvedBy.at.slice(0, 10)) : ''}</span>`)}</div></div>
      <div class="f-box"><strong>E.</strong> Receipt of payment
        <table class="f-table f-kv"><tbody><tr><th>Check/ADA no.</th><td>${d.checkNo || d.lddapNo || ''}</td><th>Date</th><td>${fmtDate(d.paidDate)}</td><th>Bank name and account no.</th><td>${d.payee.bankName || ''} ${d.payee.bankAccount || ''}</td></tr>
        <tr><th>Signature</th><td></td><th>Date</th><td>${d.receipt ? fmtDate(d.receipt.date) : ''}</td><th>Printed name</th><td>${d.receipt?.receivedBy || ''}</td></tr>
        <tr><th>Official receipt no. and date / other documents</th><td colspan="5">${d.receipt?.orNo || ''}</td></tr></tbody></table></div>
      <p class="f-small">JEV no.: ${d.jevNo || '________'} &nbsp; Date: ${fmtDate(d.paidDate)}</p>`;
  },
  async pr(id) {
    const p = await api.get(`/api/finance/prs/${id}`);
    return html`${head('Purchase Request', APPENDIX.pr, { fund: p.fund, no: p.no, date: p.date, extra: html`<span>Office/section: <strong>${p.officeName}</strong></span>` })}
      <table class="f-table"><thead><tr><th>Stock/property no.</th><th>Unit</th><th>Item description</th><th class="num">Quantity</th><th class="num">Unit cost</th><th class="num">Total cost</th></tr></thead>
      <tbody>${p.items.map((i, n) => html`<tr><td>${n + 1}</td><td>${i.unit}</td><td>${i.description}</td><td class="num">${i.qty}</td><td class="num">${num(i.unitCost)}</td><td class="num">${num(i.amount)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total</td><td class="num">${num(p.total)}</td></tr></tfoot></table>
      <p><strong>Purpose:</strong> ${p.purpose}</p>
      <div class="f-signs">${signBox('Requested by:', { name: p.requestedBy.name, title: p.requestedBy.title || 'Requesting officer' })}${signBox('Approved by:', p.approvedBy || sig('head'))}</div>`;
  },
  async po(id) {
    const o = await api.get(`/api/finance/pos/${id}`);
    const card = await api.get(`/api/finance/cards/${o.supplierId}`).then((c) => c.card).catch(() => ({}));
    return html`${head('Purchase Order', APPENDIX.po, { fund: o.fund, no: o.no, date: o.date, extra: html`<span>Mode of procurement: <strong>${o.mode}</strong></span>` })}
      <table class="f-table f-kv"><tbody><tr><th>Supplier</th><td>${o.supplierName}</td><th>TIN</th><td>${card.tin || ''}</td></tr><tr><th>Address</th><td colspan="3">${card.address || ''}</td></tr>
        <tr><th>Place of delivery</th><td>${o.place}</td><th>Delivery term</th><td>On or before ${long(o.deliveryDate)}</td></tr><tr><th>Payment term</th><td colspan="3">${o.paymentTerm}</td></tr></tbody></table>
      <p class="f-small">Gentlemen: Please furnish this office the following articles subject to the terms and conditions contained herein:</p>
      <table class="f-table"><thead><tr><th>Stock/property no.</th><th>Unit</th><th>Description</th><th class="num">Quantity</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
      <tbody>${o.items.map((i, n) => html`<tr><td>${n + 1}</td><td>${i.unit}</td><td>${i.description}</td><td class="num">${i.qty}</td><td class="num">${num(i.unitCost)}</td><td class="num">${num(i.amount)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">(Total amount in words) ${amountInWords(o.total)}</td><td class="num">${num(o.total)}</td></tr></tfoot></table>
      <p class="f-small">In case of failure to make the full delivery within the time specified above, a penalty of one-tenth (1/10) of one percent for every day of delay shall be imposed on the undelivered item/s.</p>
      <div class="f-signs">${signBox('Conforme:', { name: '', title: 'Signature over printed name of supplier / date' })}${signBox('Very truly yours:', o.approvedBy || sig('head'))}</div>
      <table class="f-table f-kv"><tbody><tr><th>Fund cluster</th><td>${o.fund}</td><th>ORS/BURS no.</th><td>${o.ors?.no || ''}</td><th>Amount</th><td>${num(o.total)}</td></tr></tbody></table>
      <div class="f-signs">${signBox('', sig('accountant'), html`<span class="f-cap">Signature over printed name of Chief Accountant / Head of Accounting Division/Unit</span>`)}</div>`;
  },
  async iar(id) {
    const i = await api.get(`/api/finance/iars/${id}`);
    const o = await api.get(`/api/finance/pos/${i.poId}`);
    return html`${head('Inspection and Acceptance Report', APPENDIX.iar, { fund: i.fund, no: i.no, date: i.date })}
      <table class="f-table f-kv"><tbody><tr><th>Supplier</th><td>${i.supplierName}</td><th>Invoice no.</th><td>${i.invoiceNo} · ${fmtDate(i.invoiceDate)}</td></tr><tr><th>PO no./date</th><td>${o.no} · ${fmtDate(o.date)}</td><th>Requisitioning office</th><td>${o.office}</td></tr></tbody></table>
      <table class="f-table"><thead><tr><th>Stock/property no.</th><th>Description</th><th>Unit</th><th class="num">Quantity</th><th class="num">Amount</th></tr></thead>
      <tbody>${i.lines.map((l) => html`<tr><td>${l.line + 1}</td><td>${o.items[l.line].description}</td><td>${o.items[l.line].unit}</td><td class="num">${l.qty}</td><td class="num">${num(l.amount)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${num(i.total)}</td></tr></tfoot></table>
      ${i.daysLate ? html`<p class="f-small">Delivered ${i.daysLate} day${i.daysLate === 1 ? '' : 's'} after the delivery term: liquidated damages ₱${num(i.liquidatedDamages)}.</p>` : ''}
      <div class="f-signs"><div class="f-box"><strong>Inspection</strong><br />Date inspected: ${fmtDate(i.inspectedDate)}<br />☒ Inspected, verified and found in order as to quantity and specifications${signBox('', { name: i.inspectedBy, title: 'Inspection Officer / Inspection Committee' })}</div>
        <div class="f-box"><strong>Acceptance</strong><br />Date received: ${fmtDate(i.date)}<br />☒ ${o.items.every((x) => x.delivered >= x.qty) ? 'Complete' : 'Partial (pls. specify quantity)'}${signBox('', { name: i.acceptedBy, title: sig('supply').title })}</div></div>`;
  },
  async ris(id) {
    const r = await api.get(`/api/finance/ris/${id}`);
    return html`${head('Requisition and Issue Slip', APPENDIX.ris, { no: r.no, date: r.date, extra: html`<span>Division/office: <strong>${r.officeName}</strong></span>` })}
      <table class="f-table"><thead><tr><th colspan="4">Requisition</th><th colspan="2">Stock available?</th><th colspan="2">Issue</th></tr><tr><th>Stock no.</th><th>Unit</th><th>Description</th><th class="num">Quantity</th><th>Yes</th><th>No</th><th class="num">Quantity</th><th>Remarks</th></tr></thead>
      <tbody>${r.items.map((i) => html`<tr><td>${i.stockNo}</td><td>${i.unit}</td><td>${i.description}</td><td class="num">${i.qty}</td><td>${i.onHand >= i.qty ? '✓' : ''}</td><td>${i.onHand < i.qty ? '✓' : ''}</td><td class="num">${r.status === 'issued' ? i.issued : ''}</td><td></td></tr>`)}</tbody></table>
      <p><strong>Purpose:</strong> ${r.purpose}</p>
      <div class="f-signs four">${signBox('Requested by:', { name: r.requestedBy.name })}${signBox('Approved by:', { name: r.approvedBy || '' })}${signBox('Issued by:', { name: r.issuedBy || '', title: sig('supply').title })}${signBox('Received by:', { name: r.receivedBy || '' })}</div>`;
  },
  async par(id) {
    const p = await api.get(`/api/finance/property/${id}`);
    const ppe = p.type === 'ppe';
    const issued = [...p.history].reverse().find((h) => h.docNo === p.docNo);
    return html`${head(ppe ? 'Property Acknowledgment Receipt' : 'Inventory Custodian Slip', ppe ? APPENDIX.par : APPENDIX.ics, { fund: p.fund, no: p.docNo, date: issued?.date })}
      <table class="f-table"><thead><tr><th class="num">Quantity</th><th>Unit</th>${ppe ? '' : html`<th class="num">Unit cost</th><th class="num">Total cost</th>`}<th>Description</th><th>${ppe ? 'Property number' : 'Inventory item no.'}</th>${ppe ? html`<th>Date acquired</th><th class="num">Amount</th>` : html`<th>Estimated useful life</th>`}</tr></thead>
      <tbody><tr><td class="num">1</td><td>unit</td>${ppe ? '' : html`<td class="num">${num(p.cost)}</td><td class="num">${num(p.cost)}</td>`}<td>${p.description}${p.serialNo ? html`<br /><small>Serial no. ${p.serialNo}</small>` : ''}</td><td>${p.propertyNo}</td>${ppe ? html`<td>${fmtDate(p.acquired)}</td><td class="num">${num(p.cost)}</td>` : html`<td>${p.life ? `${p.life} years` : ''}</td>`}</tr></tbody></table>
      <div class="f-signs">${signBox('Received by:', { name: p.custodianName, title: 'Signature over printed name of end user' })}${signBox(ppe ? 'Issued by:' : 'Received from:', sig('supply'))}</div>`;
  },
  async ics(id) {
    return FORMS.par(id);
  },
  async or(id) {
    const r = await api.get(`/api/finance/receipts/${id}`);
    return html`<div class="f-or">
      <header><span>Accountable Form No. ${r.form || '51'}</span><strong>OFFICIAL RECEIPT</strong><span>of the Republic of the Philippines</span></header>
      <div class="f-or-no">No. <strong>${r.no}</strong>${r.status === 'cancelled' ? html` <span class="badge red">CANCELLED</span>` : ''}</div>
      <table class="f-table f-kv"><tbody><tr><th>Date</th><td>${long(r.date)}</td></tr><tr><th>Agency</th><td>${r.entity.name}</td></tr><tr><th>Fund</th><td>${r.fund}</td></tr><tr><th>Payor</th><td>${r.payorName}</td></tr></tbody></table>
      <table class="f-table"><thead><tr><th>Nature of collection</th><th>Account code</th><th class="num">Amount</th></tr></thead>
      <tbody>${r.lines.map((l) => html`<tr><td>${l.description}</td><td>${l.code}</td><td class="num">${num(l.amount)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${num(r.total)}</td></tr></tfoot></table>
      <p class="f-small">Amount in words: <em>${amountInWords(r.total)}</em></p>
      <p class="f-small">${r.mode === 'cash' ? '☒' : '☐'} Cash &nbsp; ${r.mode === 'check' ? '☒' : '☐'} Check ${r.checkNo ? `no. ${r.checkNo} ${r.bank}` : ''} &nbsp; ${r.mode === 'online' ? '☒' : '☐'} Online</p>
      <p class="f-small">Received the amount stated above.</p>
      ${signBox('', { name: r.collectorName, title: 'Collecting Officer' })}
    </div>`;
  },
  async rcd(id) {
    const c = await api.get(`/api/finance/rcds/${id}`);
    return html`${head('Report of Collections and Deposits', APPENDIX.rcd, { fund: c.fund, no: c.no, date: c.date, extra: html`<span>Collecting officer: <strong>${c.collectorName}</strong></span>` })}
      <h3 class="f-sub">A. Collections</h3>
      <table class="f-table"><thead><tr><th>Date</th><th>O.R. no.</th><th>Payor</th><th>Nature of collection</th><th class="num">Amount</th></tr></thead>
      <tbody>${c.receipts.map((r) => html`<tr><td>${fmtDate(r.date)}</td><td>${r.no}</td><td>${r.status === 'cancelled' ? 'CANCELLED' : r.payorName}</td><td>${r.lines.map((l) => l.description).join(', ')}</td><td class="num">${r.status === 'cancelled' ? '' : num(r.total)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${num(c.total)}</td></tr></tfoot></table>
      <h3 class="f-sub">B. Remittances/Deposits</h3>
      <table class="f-table"><thead><tr><th>Bank / account</th><th>Reference (deposit slip)</th><th>Date</th><th class="num">Amount</th></tr></thead>
      <tbody><tr><td>${c.bank ? `${c.bank.name} ${c.bank.number}` : ''}</td><td>${c.deposit?.slipNo || ''}</td><td>${fmtDate(c.deposit?.date)}</td><td class="num">${c.deposit ? num(c.total) : ''}</td></tr></tbody></table>
      <h3 class="f-sub">C. Accountability for accountable forms</h3><p class="f-small">Official receipts no. ${c.from} to ${c.to} issued (${c.count} with collections).</p>
      <div class="f-signs"><div class="f-box">Certification: I hereby certify that this Report of Collections and Deposits, including supporting documents, is true and correct.${signBox('', { name: c.collectorName, title: 'Collecting Officer' })}</div>
        <div class="f-box">Verification and acknowledgment: I hereby certify that the foregoing report of collections has been verified and acknowledge receipt of ₱${num(c.total)}.${signBox('', sig('cashier'))}</div></div>`;
  },
  async lddap(id) {
    const l = await api.get(`/api/finance/lddaps/${id}`);
    return html`${head('List of Due and Demandable Accounts Payable – Advice to Debit Account', APPENDIX.lddap, { fund: l.fund, no: l.no, date: l.date, extra: html`<span>MDS-GSB branch/account: <strong>${l.bank ? `${l.bank.name} ${l.bank.number}` : ''}</strong></span>` })}
      <table class="f-table"><thead><tr><th>Creditor</th><th>Preferred servicing bank / account no.</th><th>ORS/BURS no.</th><th>UACS / allotment class</th><th class="num">Gross amount</th><th class="num">Withholding tax</th><th class="num">Net amount</th><th>Remarks</th></tr></thead>
      <tbody>${l.dvs.map((d) => html`<tr><td>${d.payee.name}</td><td>${d.payee.bankName || ''} ${d.payee.bankAccount || ''}</td><td>${d.ors?.no || ''}</td><td>${d.entry[0]?.code || ''}</td><td class="num">${num(d.gross)}</td><td class="num">${num(d.taxTotal)}</td><td class="num">${num(d.net)}</td><td>DV ${d.no}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="6">Total</td><td class="num">${num(l.total)}</td><td></td></tr></tfoot></table>
      <p class="f-small">Total amount in words: <em>${amountInWords(l.total)}</em></p>
      <p class="f-small">I hereby warrant that the above list of due and demandable accounts payable is in accordance with existing budgeting, accounting and auditing rules and regulations.</p>
      <div class="f-signs">${signBox('Certified correct:', sig('accountant'))}${signBox('Approved:', sig('head'))}</div>`;
  },
  async 2307(id, query) {
    const d = await api.get(`/api/finance/taxes/2307?${new URLSearchParams({ payeeId: id, year: query.year, quarter: query.quarter, kind: query.kind || 'ewt' })}`);
    return html`<div class="f-appendix">BIR Form No. 2307</div>
      <header class="f-head"><h1>Certificate of Creditable Tax Withheld at Source</h1><div class="f-meta"><span>For the period from <strong>${long(d.from)}</strong> to <strong>${long(d.to)}</strong></span></div></header>
      <h3 class="f-sub">Part I – Payee information</h3><table class="f-table f-kv"><tbody><tr><th>TIN</th><td>${d.payee.tin || ''}</td></tr><tr><th>Payee's name</th><td>${d.payee.name}</td></tr><tr><th>Registered address</th><td>${d.payee.address || ''}</td></tr></tbody></table>
      <h3 class="f-sub">Part II – Payor information</h3><table class="f-table f-kv"><tbody><tr><th>TIN</th><td>${d.payor.tin || ''}</td></tr><tr><th>Payor's name</th><td>${d.payor.name}</td></tr><tr><th>Registered address</th><td>${d.payor.address || ''}</td></tr></tbody></table>
      <h3 class="f-sub">Part III – Details of monthly income payments and taxes withheld${d.kind === 'vat' ? ' (business taxes: VAT and percentage tax withheld)' : ''}</h3>
      <table class="f-table f-2307"><thead><tr><th>Income payments subject to ${d.kind === 'vat' ? 'withholding of business tax' : 'expanded withholding tax'}</th><th>ATC</th><th class="num">1st month of the quarter</th><th class="num">2nd month</th><th class="num">3rd month</th><th class="num">Total</th><th class="num">Tax withheld for the quarter</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.label}</td><td>${r.atc}</td>${r.months.map((m) => html`<td class="num">${m ? num(m) : ''}</td>`)}<td class="num">${num(r.total)}</td><td class="num">${num(r.tax)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total</td><td class="num">${num(d.total)}</td><td class="num">${num(d.tax)}</td></tr></tfoot></table>
      <p class="f-small">We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof.</p>
      <div class="f-signs">${signBox('Payor / authorized representative / tax agent:', d.signatory)}${signBox('Conforme: payee / authorized representative:', { name: d.payee.name, title: 'Signature over printed name' })}</div>`;
  },
};

export async function printView(el, params, query) {
  const make = FORMS[params.kind];
  if (!make) throw new Error('Unknown form.');
  const body = await make(params.id, query);
  const back = { jev: ['/journals', 'Journal entries'], ors: [`/obligations/${params.id}`, 'Obligation'], dv: [`/dvs/${params.id}`, 'Voucher'], pr: [`/prs/${params.id}`, 'Purchase request'], po: [`/pos/${params.id}`, 'Purchase order'], iar: ['/pos', 'Purchase orders'], ris: [`/ris/${params.id}`, 'Requisition'], par: [`/property/${params.id}`, 'Property'], ics: [`/property/${params.id}`, 'Property'], or: [isStaff() ? '/receipts' : '/me', isStaff() ? 'Official receipts' : 'My payments'], rcd: [`/rcds/${params.id}`, 'Report'], lddap: ['/lddap', 'LDDAP-ADA'], 2307: ['/taxes?tab=alpha', 'Taxes'] }[params.kind];
  mount(el, html`
    <div class="no-print">${pageHead('Print', 'Prints on A4. Sign the printed copy where marked.', html`<button class="btn primary" id="print">${icon('file', 16)} Print</button>`, back)}</div>
    <article class="document gov-form ${params.kind === 'or' ? 'small-form' : ''}">${body}</article>`);
  el.querySelector('#print').addEventListener('click', () => window.print());
}
