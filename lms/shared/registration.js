// Student self-registration: "Register account" on the ATLAS home page's sign-in card opens
// "Create student account". The form (public/js/hub/app.js) and the server (POST /api/auth/register
// in server/api.js) share these lists and rules, so both say the same thing about the same answer.
// The account waits as an applicant (status "pending") until the registrar admits it.

// The titles the form offers. Still to be confirmed with the school (e.g. whether to add "Dr." or
// a gender-neutral choice such as "Mx."); add or remove here and both sides follow.
export const TITLES = ['Mr.', 'Ms.', 'Mrs.'];

export const NAME_MAX = 60; // each of first, middle and last name
export const EMAIL_MAX = 160; // as an account's email anywhere in ATLAS (server/admin.js)
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A name: letters (any alphabet, with accents such as ñ), spaces, periods, apostrophes and hyphens,
// with at least one letter ("Ma. Cristina", "Dela Cruz", "Niño", "O'Neil").
const NAME_CHARS = /^[\p{L}\p{M} .'’-]+$/u;
const LETTER = /\p{L}/u;
export const cleanName = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

// A Philippine mobile number, typed 09XXXXXXXXX or +639XXXXXXXXX (spaces, dashes, dots and brackets
// are ignored), kept in one form: +639XXXXXXXXX. Anything else: null.
export function normaliseMobile(v) {
  const s = String(v ?? '').replace(/[\s\-.()]/g, '');
  if (/^09\d{9}$/.test(s)) return `+63${s.slice(1)}`;
  if (/^\+639\d{9}$/.test(s)) return s;
  return null;
}
// +639171234567 → 0917 123 4567 (how people write it).
export const formatMobile = (v) => (/^\+639\d{9}$/.test(String(v || '')) ? `0${v.slice(3, 6)} ${v.slice(6, 9)} ${v.slice(9)}` : String(v || ''));

// The name shown everywhere: first name, middle initial, last name ("Juan D. Dela Cruz").
export function composeName({ firstName = '', middleName = '', lastName = '' }) {
  const initial = cleanName(middleName).replace(/[^\p{L}]/gu, '').slice(0, 1).toUpperCase();
  return [cleanName(firstName), initial ? `${initial}.` : '', cleanName(lastName)].filter(Boolean).join(' ');
}

const nameProblem = (label, value, required) => {
  if (!value) return required ? `Type your ${label.toLowerCase()}.` : '';
  if (value.length > NAME_MAX) return `${label}: at most ${NAME_MAX} characters.`;
  if (!NAME_CHARS.test(value) || !LETTER.test(value)) return `${label}: use letters, with spaces, periods, apostrophes or hyphens if your name has them.`;
  return '';
};

// The answers, cleaned: { fields } when they are all right, else { problem } (the first one, in the
// order of the form). The campus list, the email's uniqueness, the password rules and the password
// confirmation are the server's to check (it knows the school's accounts and password settings).
export function checkRegistration(v = {}) {
  const f = {
    campusId: String(v.campusId ?? '').trim(),
    title: String(v.title ?? '').trim(),
    firstName: cleanName(v.firstName),
    middleName: cleanName(v.middleName),
    lastName: cleanName(v.lastName),
    email: String(v.email ?? '').trim().toLowerCase(),
    mobile: normaliseMobile(v.mobile),
  };
  const problem = (msg) => ({ problem: msg });
  if (!f.campusId) return problem('Choose your preferred campus.');
  if (!f.title) return problem('Choose your title.');
  if (!TITLES.includes(f.title)) return problem(`Choose a title from the list: ${TITLES.join(', ')}.`);
  for (const [label, key, required] of [['First name', 'firstName', true], ['Middle name', 'middleName', false], ['Last name', 'lastName', true]]) {
    const p = nameProblem(label, f[key], required);
    if (p) return problem(p);
  }
  if (!f.email) return problem('Type your email address.');
  if (f.email.length > EMAIL_MAX || !EMAIL_RE.test(f.email)) return problem('That email address does not look right.');
  if (!String(v.mobile ?? '').trim()) return problem('Type your mobile number.');
  if (!f.mobile) return problem('Type a Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX.');
  return { fields: f };
}
export const PASSWORDS_DIFFER = 'The passwords do not match. Type the same password in both boxes.';

// A username for the account, from the email (the student never needs it: they sign in with their
// email). Lowercase letters, digits, dots, dashes and underscores, 3 to 40 of them, and not taken:
// "juan.delacruz@mail.com" → "juan.delacruz", then "juan.delacruz2", "juan.delacruz3"…
export function usernameFromEmail(email, taken) {
  let base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 34);
  if (!base) base = 'student';
  if (base.length < 3) base = `${base}.student`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base}${n}`;
    if (!taken(name)) return name;
  }
}

// The privacy notice students read when the school has not written its own: exactly what the form
// collects, why, how long it is kept and whom to ask.
export function defaultPrivacyText(school) {
  const name = school || 'The school';
  return [
    `${name} collects what you type in this form: your preferred campus, title, first, middle and last name, email address, mobile number, and the password you choose (kept only in a scrambled form that nobody can read back).`,
    'They are used for two things only: to consider your registration for admission, and to contact you about it. The registrar\'s office sees them.',
    'Once you are admitted, they become part of your student records and are kept as the school keeps student records. If you are not admitted, the registrar keeps them on record with the decision.',
    'To see, correct or ask about your information, or to withdraw your registration, contact the registrar\'s office (Data Privacy Act of 2012).',
  ].join('\n\n');
}

// What administrators see in the empty Terms of Use box. Students never see it: without the school's
// own terms, the form shows no Terms of Use link at all.
export const TERMS_PLACEHOLDER = 'Placeholder, to replace: write your school\'s Terms of Use for its online services here, or give the address of the page where they are published. Until you do, students see no Terms of Use link.';

export const POLICY_TEXT_MAX = 20000;
export const POLICY_URL_MAX = 500;
