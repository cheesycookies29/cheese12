// Which guide the Help button opens: the guide for this person's job in the module they are in.
// (The guides are in docs/guides; ids are their file names.)
const ROLE_GUIDE = { admin: 'admin', hr: 'hr', hrstaff: 'hr', payroll: 'payroll', it: 'it-assets', support: 'service-desk', sales: 'sales', salesmgr: 'sales', pm: 'projects', employee: 'employee' };

// from: the module the button was pressed in (hr, assets, helpdesk, crm, projects, system) or home.
export function guideFor(from, role) {
  switch (from) {
    case 'hr': return { hr: 'hr', hrstaff: 'hr', payroll: 'payroll', admin: 'hr' }[role] || 'employee';
    case 'assets': return ['it', 'admin', 'hr', 'support'].includes(role) ? 'it-assets' : 'employee';
    case 'helpdesk': return ['support', 'it', 'admin'].includes(role) ? 'service-desk' : 'employee';
    case 'crm': return ['sales', 'salesmgr', 'admin'].includes(role) ? 'sales' : 'employee';
    // Everyone in a project (a member of any account type) uses the projects guide.
    case 'projects': return 'projects';
    case 'system': return role === 'admin' ? 'admin' : 'getting-started';
    default: return ROLE_GUIDE[role] || 'getting-started';
  }
}
