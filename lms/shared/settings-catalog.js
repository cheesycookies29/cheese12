// Every setting an administrator can change, in one list: which module and group it is in, what it
// is called on its screen, a short explanation, and where to change it. The Admin panel's Settings
// center searches it, compares each value with its default, and labels the change history.
// (After Discourse's site_settings.yml and Moodle's admin settings tree: one registry, many screens.)
//
// area: a group of settings saved together (server/config.js knows how to read, save and reset it).
// path: where the setting is inside its area ('' = the whole area).
// format: how to show the value: percent (0.09 → 9%), money, bool, list, json; default: as is.

export const MODULES = [
  ['admin', 'Admin panel'],
  ['learn', 'ATLAS Learn'],
  ['academic', 'ATLAS Academic'],
  ['people', 'ATLAS People'],
  ['finance', 'ATLAS Finance'],
];

// Areas: [id, module, label, screen]
export const AREAS = [
  ['school', 'admin', 'School', '/admin#/settings'],
  ['branding', 'admin', 'Branding', '/admin#/settings'],
  ['enrollment', 'learn', 'Enrollment and passing', '/admin#/settings'],
  ['security', 'admin', 'Sign-in and passwords', '/admin#/sign-in'],
  ['learn', 'learn', 'Uploads, quizzes and parent alerts', '/admin#/settings'],
  ['numbering', 'admin', 'Numbering', '/admin#/settings'],
  ['activityTypes', 'learn', 'Activity types and grade weights', '/admin#/grading'],
  ['modules', 'learn', 'Modules', '/admin#/modules'],
  ['systems', 'admin', 'Home page and systems', '/admin#/systems'],
  ['sso', 'admin', 'Single sign-on', '/admin#/sso'],
  ['roles', 'admin', 'Roles and permissions', '/admin#/roles'],
  ['academic', 'academic', 'Academic settings', '/academic/#/settings'],
  ['hr', 'people', 'HR settings', '/hris/#/settings'],
  ['payroll', 'people', 'Payroll setup', '/hris/#/payroll-setup'],
  ['leaveTypes', 'people', 'Leave types', '/hris/#/leave'],
  ['locations', 'people', 'Clock-in locations', '/hris/#/clock-locations'],
  ['finance', 'finance', 'Finance: entity, funds, offices and banks', '/finance/#/control'],
  ['financeRules', 'finance', 'Finance: numbering, taxes and rules', '/finance/#/control?tab=taxes'],
];

// [area, path, label, help, format]
export const SETTINGS = [
  // ----- Admin panel -----
  ['school', 'schoolName', 'School name', 'Shown on every page, sign-in screen and printout.'],
  ['school', 'currentTermId', 'Current term', 'Shown first to students and teachers, and on the dashboard.', 'term'],
  ['branding', 'theme', 'Theme colour', 'A preset colour scheme, or the school\'s own colour.'],
  ['branding', 'color', 'School colour', 'The brand colour when the theme is the school\'s own.'],
  ['branding', 'logo', 'School logo or seal', 'On the sign-in pages and payslips.', 'picture'],
  ['branding', 'tagline', 'Sign-in headline', 'The line under the school name on the sign-in page.'],
  ['security', 'minPasswordLength', 'Shortest password', 'Characters a new password needs (8 to 64).'],
  ['security', 'requireLettersAndDigits', 'Passwords mix letters and digits', 'New passwords must have at least one letter and one digit.', 'bool'],
  ['security', 'lockoutAttempts', 'Wrong passwords before locking', 'A username is locked on one network address after this many wrong passwords in a row, and everywhere after ten times as many.'],
  ['security', 'lockoutMinutes', 'Minutes locked', 'How long a locked username waits before trying again.'],
  ['security', 'idleHours', 'Sign out after (hours idle)', 'People are signed out after this long without using ATLAS.'],
  ['security', 'forcePasswordChange', 'Always change the first password', 'New accounts and reset passwords must be changed at the first sign-in; staff cannot untick it.', 'bool'],
  ['security', 'requestsPerMinute', 'Requests per person per minute', 'Above this, ATLAS asks the person to wait; a signed-out network address gets four times as many (60 to 3000).'],
  ['security', 'signInFailuresPerAddress', 'Wrong passwords per network address', 'Wrong passwords from one address in 15 minutes, across all usernames, before it has to wait (10 to 1000).'],
  ['numbering', 'studentNo', 'Student numbers', 'The format of new student numbers, e.g. {YYYY}-{N4} gives 2026-0001.'],
  ['numbering', 'employeeNo', 'Employee numbers', 'The format of new employee numbers in People.'],
  ['numbering', 'documentRequest', 'Document request numbers', 'The format of new document request numbers in Academic.'],
  ['systems', '', 'Other systems on the home page', 'Which other systems the ATLAS home page shows, and their addresses.', 'json'],
  ['sso', 'enabled', 'Single sign-on with Keycloak', 'People sign in with the school\'s Keycloak account.', 'bool'],
  ['sso', 'issuer', 'Keycloak issuer address', 'The realm address, e.g. https://sso.school.edu.ph/realms/school.'],
  ['sso', 'clientId', 'Keycloak client ID', 'The client registered for ATLAS in Keycloak.'],
  ['sso', 'label', 'Keycloak button text', 'The text on the sign-in button.'],
  ['sso', 'matchBy', 'Match Keycloak accounts by', 'Email or username.'],
  ['sso', 'allowPasswords', 'Keep ATLAS passwords', 'Off: only administrators can still sign in with a password.', 'bool'],
  ['roles', '', 'Permissions changed from the built-in ones', 'Which account types were given or lost permissions.', 'json'],
  // ----- Learn -----
  ['enrollment', 'passingGrade', 'Passing grade (%)', 'A final grade in Learn at or above this passes and counts for prerequisites.'],
  ['enrollment', 'enrollment.requireApproval', 'Enrollment requests need approval', 'Requests wait for the registrar. Off: a free seat enrolls at once.', 'bool'],
  ['enrollment', 'enrollment.allowWaitlist', 'Waitlists', 'A full section puts students in line instead of refusing them.', 'bool'],
  ['enrollment', 'enrollment.waitlistLimit', 'Waitlist size per section', '0 = no limit.'],
  ['enrollment', 'enrollment.maxUnits', 'Maximum units per term', 'Enrolled, pending and waitlisted classes together. 0 = no limit.'],
  ['enrollment', 'registration.open', 'Let people apply from the sign-in page', 'Shows "New student? Apply for admission" on the ATLAS home page.', 'bool'],
  ['learn', 'maxUploadMb', 'Largest upload (MB)', 'The biggest file anyone can upload: resources, handed-in work, attachments (1 to 15).'],
  ['learn', 'quizGraceSeconds', 'Quiz grace period (seconds)', 'Answers sent this long after a quiz\'s deadline still count, for slow connections.'],
  ['learn', 'absenceAlert', 'Absences shown in red to parents', 'From this many absences in a term, a parent\'s dashboard shows them in red.'],
  ['activityTypes', '', 'Activity types and grade weights', 'The types teachers pick (assignment, quiz, exam…) and how much each counts.', 'types'],
  ['modules', '', 'Modules for students, teachers and parents', 'Which parts of Learn each kind of account sees.', 'modules'],
  // ----- Academic -----
  ['academic', 'passingGrade', 'Lowest passing grade', 'Grades worse than this fail (3.00 by default).', 'grade'],
  ['academic', 'scale', 'Grading scale', 'From the final percentage to the grade on the record.', 'scale'],
  ['academic', 'incDays', 'Days to complete an INC', 'An incomplete must be completed within this many days of posting.'],
  ['academic', 'honors.maxGwa', "Dean's list: GWA at most", "A term's general weighted average must be this or better.", 'grade'],
  ['academic', 'honors.worstGrade', "Dean's list: no grade lower than", 'No subject that term may have a worse grade.', 'grade'],
  ['academic', 'honors.minUnits', "Dean's list: at least (units)", 'The fewest units carried that term.'],
  ['academic', 'registrar.name', "Registrar's name", 'Printed on the signature line of documents.'],
  ['academic', 'registrar.title', "Registrar's title", 'Printed under the name.'],
  ['academic', 'fees.tor', 'Fee: Transcript of Records', 'Pesos per copy.', 'money'],
  ['academic', 'fees.cog', 'Fee: Certificate of Grades', 'Pesos per copy.', 'money'],
  ['academic', 'fees.coe', 'Fee: Certificate of Enrollment', 'Pesos per copy.', 'money'],
  ['academic', 'fees.cor', 'Fee: Certificate of Registration', 'Pesos per copy.', 'money'],
  ['academic', 'fees.gmc', 'Fee: Good Moral Certificate', 'Pesos per copy.', 'money'],
  ['academic', 'fees.hd', 'Fee: Honorable Dismissal', 'Pesos per copy.', 'money'],
  ['academic', 'requirements', 'Admission requirements', 'What each type of student must submit.', 'list'],
  // ----- People -----
  ['hr', 'employerAddress', 'Employer address', 'On payslips and government forms.'],
  ['hr', 'employerTin', 'Employer TIN', 'On payslips and BIR forms.'],
  ['hr', 'schedule', 'Default work schedule', 'Shift start and end, break and work days, for employees without their own.', 'schedule'],
  ['payroll', 'payrollSystem', 'Payroll system', 'Government (GSIS, salary grades) or private (SSS).'],
  ['payroll', 'payFrequency', 'Pay frequency', 'Semi-monthly or monthly.'],
  ['payroll', 'workDaysPerYear', 'Work days per year', 'Turns a monthly rate into a daily rate (private payroll).'],
  ['payroll', 'gracePeriodMinutes', 'Late grace period (minutes)', 'Clock-ins this late are not counted as late.'],
  ['payroll', 'minimumOvertimeMinutes', 'Minimum overtime (minutes)', 'Shorter overtime on work days is ignored.'],
  ['payroll', 'overtimeMultiplier', 'Overtime rate', 'Times the hourly rate (private payroll).'],
  ['payroll', 'restDayMultiplier', 'Rest-day rate', 'Times the hourly rate (private payroll).'],
  ['payroll', 'contributions.gsis', 'Compute GSIS', '', 'bool'],
  ['payroll', 'contributions.sss', 'Compute SSS', '', 'bool'],
  ['payroll', 'contributions.philhealth', 'Compute PhilHealth', '', 'bool'],
  ['payroll', 'contributions.pagibig', 'Compute Pag-IBIG', '', 'bool'],
  ['payroll', 'contributions.withholdingTax', 'Compute withholding tax', '', 'bool'],
  ['payroll', 'gov.gsisPersonal', 'GSIS personal share', 'Of the monthly salary.', 'percent'],
  ['payroll', 'gov.gsisGovernment', 'GSIS government share', 'Of the monthly salary.', 'percent'],
  ['payroll', 'gov.ecc', "Employees' Compensation (ECC)", 'Pesos a month, paid by the government.', 'money'],
  ['payroll', 'gov.pera', 'PERA', 'Pesos a month.', 'money'],
  ['payroll', 'gov.peraTaxable', 'PERA is taxable', '', 'bool'],
  ['payroll', 'gov.workingDaysPerMonth', 'Working days a month', 'Daily rate = monthly salary ÷ this (22).'],
  ['payroll', 'gov.netPayFloor', 'Minimum net pay', 'Loans that would take net pay below this a month are not deducted (GAA).', 'money'],
  ['payroll', 'gov.tardiness', 'Tardiness and undertime', 'Charged to vacation leave first, or deducted from pay.'],
  ['payroll', 'gov.vacationLeaveId', 'Leave charged first', 'The leave type tardiness is charged to.'],
  ['payroll', 'gov.overtime', 'Overtime', 'Compensatory time-off, or paid.'],
  ['payroll', 'gov.overtimeRegular', 'Overtime rate, work days', 'Times the hourly rate.'],
  ['payroll', 'gov.overtimeRestDay', 'Overtime rate, rest days', 'Times the hourly rate.'],
  ['payroll', 'gov.overtimeCapPercent', 'Overtime cap (% of monthly)', 'Overtime pay in a month is at most this share of the salary.'],
  ['payroll', 'gov.benefitsExemptCeiling', '13th-month and other benefits exemption', 'Pesos a year that are not taxed.', 'money'],
  ['payroll', 'gov.cashGift', 'Cash gift', 'With the year-end bonus.', 'money'],
  ['payroll', 'gov.pei', 'Productivity Enhancement Incentive', '', 'money'],
  ['payroll', 'gov.clothingAllowance', 'Clothing allowance', '', 'money'],
  ['payroll', 'gov.clothingExemptCeiling', 'Clothing allowance not taxed up to', '', 'money'],
  ['payroll', 'gov.clothingMinMonths', 'Months of service for the clothing allowance', ''],
  ['payroll', 'gov.jobOrderEwt', 'Job order withholding tax', '', 'percent'],
  ['payroll', 'gov.jobOrderPercentageTax', 'Job order percentage tax', '', 'percent'],
  ['payroll', 'gov.payrollFund', 'Payroll fund cluster', 'The fund the payroll obligation and voucher are charged to in Finance.'],
  ['payroll', 'rates.sss', 'SSS contribution table', 'Rates and salary credits.', 'json'],
  ['payroll', 'rates.philhealth', 'PhilHealth contribution', 'Rate, floor and ceiling.', 'json'],
  ['payroll', 'rates.pagibig', 'Pag-IBIG contribution', 'Rates and the fund salary cap.', 'json'],
  ['payroll', 'rates.tax', 'Withholding tax tables', 'BIR brackets, semi-monthly and monthly.', 'json'],
  ['leaveTypes', '', 'Leave types and yearly credits', 'Vacation, sick and other leave, with their credits and rules.', 'list'],
  ['locations', '', 'Clock-in locations', 'Each campus\'s location and radius for clocking in.', 'json'],
  // ----- Finance -----
  ['finance', 'entity.name', 'Entity name', 'On every Finance form; blank uses the school name.'],
  ['finance', 'entity.agencyCode', 'UACS agency code', ''],
  ['finance', 'entity.address', 'Entity address', ''],
  ['finance', 'entity.tin', 'Entity TIN', ''],
  ['finance', 'fiscalYear', 'Fiscal year', 'The year being worked on; blank is this year.'],
  ['finance', 'funds', 'Fund clusters in use', 'e.g. 01 Regular Agency Fund, 05 Internally Generated Funds.', 'list'],
  ['finance', 'offices', 'Offices (responsibility centers)', '', 'list'],
  ['finance', 'paps', 'Programs, activities and projects', '', 'list'],
  ['finance', 'bankAccounts', 'Bank accounts', '', 'list'],
  ['finance', 'revenueItems', 'Fees collected on official receipts', '', 'list'],
  ['finance', 'signatories', 'Signatories', 'Names and titles on Finance forms.', 'json'],
  ['financeRules', 'numbering', 'Finance document numbering', 'Formats of JEV, ORS, DV, PO and other numbers.', 'json'],
  ['financeRules', 'taxes', 'Withholding taxes (ATC)', 'Tax codes and rates for vouchers.', 'list'],
  ['financeRules', 'capitalization', 'Capitalization threshold', 'Property at or above this cost is PPE.', 'money'],
  ['financeRules', 'semiHighValue', 'Semi-expendable high-value threshold', '', 'money'],
  ['financeRules', 'residualRate', 'Residual value (%)', 'Of cost, for depreciation.'],
  ['financeRules', 'svpLimit', 'Small value procurement limit', '', 'money'],
  ['financeRules', 'directAcquisitionLimit', 'Direct acquisition limit', '', 'money'],
  ['financeRules', 'depositDays', 'Days to deposit collections', ''],
  ['financeRules', 'liquidationDays', 'Days to liquidate cash advances', 'By kind of advance.', 'json'],
];

export const areaInfo = (id) => {
  const a = AREAS.find(([k]) => k === id);
  return a ? { id: a[0], module: a[1], label: a[2], screen: a[3] } : null;
};

// The catalog label of a changed path ("enrollment.maxUnits" → "Maximum units per term"); for a
// path under a listed setting ("gov.pera" under nothing, "rates.sss.eeRate" under "rates.sss"),
// the nearest listed parent.
export function labelOf(area, path) {
  let p = path;
  for (;;) {
    const hit = SETTINGS.find(([a, q]) => a === area && q === p);
    if (hit) return hit[2] + (p !== path ? ` (${path.slice(p.length + (p ? 1 : 0))})` : '');
    if (!p) return path;
    p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '';
  }
}
