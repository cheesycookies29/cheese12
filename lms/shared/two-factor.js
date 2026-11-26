// 2-step verification: who must use it (Admin panel → Sign-in and passwords, settings.security.twoFactor).
// Shared by the server (enforcement) and the browser (the settings screen and My security).
export const TWO_FACTOR_POLICIES = {
  off: 'Optional for everyone',
  admins: 'Required for administrators',
  staff: 'Required for employees and administrators',
  all: 'Required for everyone',
};

// Whether the policy (settings.security) requires this account to use 2-step verification.
// Employees: every account type but students, parents and job applicants.
export function twoFactorRequired(security, user) {
  const p = security?.twoFactor || 'off';
  if (!user || p === 'off') return false;
  if (p === 'all') return true;
  if (p === 'admins') return user.role === 'admin';
  if (p === 'staff') return !['student', 'guardian', 'applicant'].includes(user.role);
  return false;
}
