// Which guide the Help button opens: the guide for this person's job in the module they are in.
// (The guides are in docs/guides; ids are their file names.)
const ROLE_GUIDE = { admin: 'admin', hr: 'hr', hrstaff: 'hr', payroll: 'payroll', it: 'it-assets', support: 'service-desk', sales: 'sales', salesmgr: 'sales', pm: 'projects', employee: 'employee', eventstaff: 'custom-app-events' };

// from: the module the button was pressed in (hr, assets, helpdesk, crm, projects, system, a tool such
// as pdf) or home.
export function guideFor(from, role) {
  switch (from) {
    case 'hr': return { hr: 'hr', hrstaff: 'hr', payroll: 'payroll', admin: 'hr' }[role] || 'employee';
    case 'assets': return ['it', 'admin', 'hr', 'support'].includes(role) ? 'it-assets' : 'employee';
    case 'helpdesk': return ['support', 'it', 'admin'].includes(role) ? 'service-desk' : 'employee';
    case 'crm': return ['sales', 'salesmgr', 'admin'].includes(role) ? 'sales' : 'employee';
    // Everyone in a project (a member of any account type) uses the projects guide.
    case 'projects': return 'projects';
    case 'system': return role === 'admin' ? 'admin' : 'getting-started';
    // Tools (0.64): their own guide, for everyone.
    case 'pdf': return 'pdf-studio';
    // Document Management (0.67): one guide for everyone; administrators have Document control in theirs.
    case 'documents': return 'documents';
    // CUSTOM APP (0.71): the events guide, for event staff, their Super Administrator and administrators.
    case 'customapp': return 'custom-app-events';
    default: return ROLE_GUIDE[role] || 'getting-started';
  }
}
