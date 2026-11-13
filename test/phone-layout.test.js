// Phones and tablets (0.18): the logic behind the shared form errors, the folded filters, the
// sideways-scroller fades, the timesheet's day picker and the roles grid's account-type picker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeKey, readableMessage, fieldForMessage, errorSummary, activeFilterCount, edgeState, scrollToShow, WIDE_COLUMNS } from '../public/js/ui.js';
import { defaultDay, dayTotals, pickedRole } from '../public/js/phone.js';

const EMPLOYEE = [
  { name: 'firstName', label: 'First name' }, { name: 'middleName', label: 'Middle name' }, { name: 'lastName', label: 'Last name' },
  { name: 'email', label: 'Email' }, { name: 'employeeNo', label: 'Employee no.' }, { name: 'hireDate', label: 'Date hired' }, { name: 'rate', label: 'Rate' },
];
const DEAL = [
  { name: 'title', label: 'Deal name' }, { name: 'accountId', label: 'Account' }, { name: 'contactId', label: 'Contact' },
  { name: 'value', label: 'Value' }, { name: 'expectedClose', label: 'Expected close' }, { name: 'ownerId', label: 'Owner' },
];

test('internal field keys read as words', () => {
  assert.equal(humanizeKey('firstName'), 'First name');
  assert.equal(humanizeKey('hireDate'), 'Hire date');
  assert.equal(humanizeKey('pagibig_no'), 'Pagibig no');
  assert.equal(humanizeKey('rate'), 'Rate');
});

test('a server message that names a field by its key uses the label on screen', () => {
  assert.equal(readableMessage('firstName is required.', EMPLOYEE), 'First name is required.');
  assert.equal(readableMessage('hireDate is required.', EMPLOYEE), 'Date hired is required.');
  // Messages already in words are left alone, and the first letter is a capital.
  assert.equal(readableMessage('Hire date must be YYYY-MM-DD.', EMPLOYEE), 'Hire date must be YYYY-MM-DD.');
  assert.equal(readableMessage('employeeNo is required.', EMPLOYEE), 'Employee no. is required.');
});

test('a server 400 message is matched to the field it is about', () => {
  // By the key the server used.
  assert.equal(fieldForMessage('firstName is required.', EMPLOYEE), 'firstName');
  assert.equal(fieldForMessage('employeeNo is required.', EMPLOYEE), 'employeeNo');
  // By the label shown on screen.
  assert.equal(fieldForMessage('Rate must be greater than zero.', EMPLOYEE), 'rate');
  assert.equal(fieldForMessage('Asset name is required.', [{ name: 'assetTag', label: 'Asset tag' }, { name: 'name', label: 'Name' }, { name: 'category', label: 'Category' }]), 'name');
  // By all the words of a label, in any order ("Enter a name for the deal." → Deal name).
  assert.equal(fieldForMessage('Enter a name for the deal.', DEAL), 'title');
  assert.equal(fieldForMessage('Pick the account (organization) for this deal.', DEAL), 'accountId');
  assert.equal(fieldForMessage('Enter the deal value. Use 0 if it is not known yet.', DEAL), 'value');
  assert.equal(fieldForMessage('Enter a valid email address, such as name@example.com.', EMPLOYEE), 'email');
  // A message about no field in the form stays in the summary only.
  assert.equal(fieldForMessage('There are no active employees for this period.', EMPLOYEE), null);
  assert.equal(fieldForMessage('', EMPLOYEE), null);
});

test('several problems are listed together, by their labels', () => {
  assert.equal(errorSummary([]), '');
  assert.equal(errorSummary([{ name: 'title', label: 'Deal name', message: 'Deal name is required.' }]), 'Deal name is required.');
  assert.equal(errorSummary([{ name: 'title', label: 'Deal name' }, { name: 'accountId', label: 'Account' }, { name: 'value', label: 'Value' }]), 'Check 3 fields: Deal name, Account and Value.');
  assert.equal(errorSummary([{ name: 'firstName' }, { name: 'lastName' }]), 'Check 2 fields: First name and Last name.');
});

test('the Filters button counts the filters that are not at their default', () => {
  assert.equal(activeFilterCount([{ type: 'select', index: 0 }, { type: 'select', index: 0 }, { type: 'checkbox', checked: false }]), 0);
  assert.equal(activeFilterCount([{ type: 'select', index: 2 }, { type: 'select', index: 0 }, { type: 'checkbox', checked: true }]), 2);
  // Date ranges always have a value: they are filters, not counted as "on".
  assert.equal(activeFilterCount([{ type: 'date' }, { type: 'date' }, { type: 'select', index: 1 }]), 1);
});

test('sideways scrollers fade on the side where more waits, and bring the active item into view', () => {
  assert.deepEqual(edgeState({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }), { left: false, right: false });
  assert.deepEqual(edgeState({ scrollLeft: 0, scrollWidth: 531, clientWidth: 328 }), { left: false, right: true });
  assert.deepEqual(edgeState({ scrollLeft: 100, scrollWidth: 531, clientWidth: 328 }), { left: true, right: true });
  assert.deepEqual(edgeState({ scrollLeft: 203, scrollWidth: 531, clientWidth: 328 }), { left: true, right: false });
  // Already in view: leave it. Out of view: centred.
  assert.equal(scrollToShow({ scrollLeft: 0, clientWidth: 328 }, { left: 10, width: 100 }), null);
  assert.equal(scrollToShow({ scrollLeft: 0, clientWidth: 328 }, { left: 324, width: 108 }), 214);
  assert.equal(scrollToShow({ scrollLeft: 200, clientWidth: 328 }, { left: 20, width: 80 }), 0);
});

test('wide tables (6 columns or more) are cards up to tablet width', () => {
  assert.equal(WIDE_COLUMNS, 6);
});

test('the timesheet on a phone opens on today, or Monday, or the day asked for', () => {
  const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
  assert.equal(defaultDay(days, '2026-11-13'), 4);
  assert.equal(defaultDay(days, '2026-11-20'), 0); // a past week
  assert.equal(defaultDay(days, '2026-11-02'), 0); // a week ahead
  assert.equal(defaultDay(days, '2026-11-13', '2'), 2);
  assert.equal(defaultDay(days, '2026-11-13', 2), 2);
  assert.equal(defaultDay(days, '2026-11-13', '9'), 4); // out of range: today
  assert.equal(defaultDay(days, '2026-11-13', 'x'), 4);
  assert.equal(defaultDay(days, '2026-11-13', ''), 4);
});

test('the day picker shows each day\'s hours and the week\'s', () => {
  const rows = [{ hours: [1, 2, 0, 0, 1.5, 0, 0] }, { hours: [0.25, '', '3', 0, 0, 0, 0] }];
  assert.deepEqual(dayTotals(rows, 7), { days: [1.25, 2, 3, 0, 1.5, 0, 0], week: 7.75 });
  assert.deepEqual(dayTotals([], 7), { days: [0, 0, 0, 0, 0, 0, 0], week: 0 });
});

test('roles on a phone show the picked account type, else the first one that can be edited', () => {
  const ids = ['hr', 'hrstaff', 'payroll', 'it'];
  assert.equal(pickedRole(ids, 'payroll'), 'payroll');
  assert.equal(pickedRole(ids, null), 'hr');
  assert.equal(pickedRole(ids, 'gone'), 'hr');
  assert.equal(pickedRole([], 'hr'), null);
});
