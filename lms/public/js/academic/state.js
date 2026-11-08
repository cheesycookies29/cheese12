// Academic state shared between screens: the settings (grading scale, document types…),
// what the signed-in person may do, and small helpers.
import { api } from '../api.js';
import { ctx } from '../shell.js';
import { html, badge } from '../ui.js';
import { fmtGrade, REQUEST_STATUS, GRADE_SHEET_STATUS } from '/shared/academic.js';

export const ac = {
  settings: null,
  async refreshSettings() {
    ac.settings = await api.get('/api/academic/settings');
  },
};

export const can = (permission) => Boolean(ctx.info?.permissions?.includes(permission));
export const role = () => ctx.user?.role;
export const isStudent = () => role() === 'student';
export const isTeacher = () => role() === 'teacher';
export const isStaff = () => ['admin', 'registrar', 'dean'].includes(role());

// Rows of a table that open a page when clicked (tr[data-href]).
export function clickableRows(root) {
  if (root.dataset.rows) return; // once per element, however often a view redraws
  root.dataset.rows = '1';
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button, input, select, label')) location.hash = tr.dataset.href;
  });
}

const SUBJECT = {
  passed: ['Passed', 'green'],
  credited: ['Credited', 'blue'],
  graded: ['Graded', 'green'],
  enrolled: ['Taking now', 'brand'],
  pending: ['Requested', 'amber'],
  inc: ['INC', 'amber'],
  failed: ['Failed', 'red'],
  remaining: ['Not taken', 'gray'],
};
export const subjectBadge = (s) => {
  const [label, kind] = SUBJECT[s.status] || [s.status, 'gray'];
  return badge(s.status === 'remaining' && s.canTake ? 'Can take' : label, s.status === 'remaining' && s.canTake ? 'blue' : kind);
};
export const remarkBadge = (remark) => ({
  passed: badge('Passed', 'green'), failed: badge('Failed', 'red'), inc: badge('INC', 'amber'), dropped: badge('Dropped', 'gray'), credited: badge('Credited', 'blue'),
})[remark] || badge(remark || '—', 'gray');
export const gradeText = (r) => (r.remark === 'inc' ? 'INC' : r.remark === 'dropped' ? 'DRP' : fmtGrade(r.grade) || '—');
export const gwaText = (g) => (g == null ? '—' : Number(g).toFixed(4).replace(/0{1,2}$/, ''));
export const requestBadge = (status) => badge(REQUEST_STATUS[status] || status, { requested: 'amber', paid: 'blue', processing: 'blue', ready: 'green', released: 'gray', cancelled: 'gray' }[status]);
export const sheetBadge = (status) => badge(GRADE_SHEET_STATUS[status] || status, { none: 'gray', submitted: 'amber', approved: 'blue', posted: 'green', returned: 'red' }[status]);
export const units = (n) => html`${Number(n) || 0} unit${Number(n) === 1 ? '' : 's'}`;
