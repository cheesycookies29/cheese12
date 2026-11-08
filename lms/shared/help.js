// Which guide the Help button opens: the guide for this person's job in the system they are in.
// (The guides are in docs/guides; ids are their file names.)
const FINANCE_GUIDE = { accountant: 'accountant', budget: 'budget-officer', cashier: 'cashier', supply: 'supply-officer', approver: 'approver' };
const ROLE_GUIDE = { student: 'student', guardian: 'parent', teacher: 'teacher', registrar: 'registrar', dean: 'dean', admin: 'admin', hr: 'hr', payroll: 'payroll', staff: 'employee', ...FINANCE_GUIDE };

export function guideFor(from, role) {
  switch (from) {
    case 'hris': return role === 'hr' || role === 'payroll' ? role : role === 'admin' ? 'payroll' : 'employee';
    case 'finance': return FINANCE_GUIDE[role] || (role === 'student' ? 'student' : role === 'admin' ? 'accountant' : 'employee');
    case 'academic': return { registrar: 'registrar', dean: 'dean', student: 'student', teacher: 'teacher', admin: 'registrar' }[role] || ROLE_GUIDE[role] || 'getting-started';
    case 'admin': return { registrar: 'registrar', dean: 'dean' }[role] || 'admin';
    default: return ROLE_GUIDE[role] || 'getting-started';
  }
}
