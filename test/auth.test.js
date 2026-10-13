import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createThrottle, parseCookies } from '../server/auth.js';
import { can } from '../shared/roles.js';

test('password hashing', () => {
  const hash = hashPassword('correct horse');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword('anything', undefined), false);
});

test('login throttle locks after 5 failures', () => {
  const t = createThrottle();
  for (let i = 0; i < 5; i++) t.fail('bob');
  assert.throws(() => t.check('bob'), /Too many failed attempts/);
  t.reset('bob');
  assert.doesNotThrow(() => t.check('bob'));
});

test('cookie parsing', () => {
  assert.deepEqual(parseCookies('a=1; ltdc_sid=abc%20d'), { a: '1', ltdc_sid: 'abc d' });
});

test('role permissions', () => {
  assert.equal(can('admin', 'users.manage'), true);
  assert.equal(can('hr', 'employees.edit'), true);
  assert.equal(can('hr', 'payroll.edit'), false);
  assert.equal(can('payroll', 'payroll.edit'), true);
  assert.equal(can('payroll', 'attendance.edit'), false);
  assert.equal(can('employee', 'employees.view'), false);
  assert.equal(can('employee', 'self'), true);
  assert.equal(can('nobody', 'self'), false);
});
