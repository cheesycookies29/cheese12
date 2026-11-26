// JSON API. Three sides, each with its own session cookie (see shared/roles.js):
//   /api/admin/...  the LMS admin panel (Administrators, Registrars)
//   /api/...        the learning portal (Teachers, Students)
//   /api/hris/...   the HRIS: HR and staff accounts, and any employee's session
// A route's access is one of:
//   'public'                      anyone
//   'portal' | 'teacher' | 'student' | 'guardian'  signed in to the portal (optionally that type only;
//                                    parents & guardians reach only 'guardian' routes and those marked guardians: true)
//   'admin' | 'admin:<permission>'    signed in to the admin panel (optionally with that permission)
//   'hris' | 'hris:<permission>'      any signed-in employee (not students), optionally with that permission;
//                                    job applicants reach only the routes marked applicants: true (the jobs area)
//   'finance' | 'finance:<permission>'    ATLAS Finance: any signed-in employee or student (whichever session the
//                                    browser has), optionally with that permission
//   'me'                          whoever is signed in, in any system (their own account: /api/me/…)
//   'tool:<id>'                   whoever is signed in and may use that ATLAS tool (shared/systems.js TOOLS)
//   'academic' | 'academic:<permission>'  ATLAS Academic: administrators, registrars and deans (admin-panel
//                                    session), teachers and students (portal session); optionally with that permission
//   'documents' | 'documents:<permission>'  ATLAS Documents: any signed-in employee or student (whichever session
//                                    the browser has; not parents and guardians), optionally with that permission
// Portal routes may also name a module; the call is refused when an administrator
// has switched that module off for the caller's account type.
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError, localDate, localDateTime, text } from './util.js';
import {
  hashPasswordAsync, verifyPasswordAsync, needsRehash, validatePassword, publicUser as accountFields, parseCookies, createSessions, createThrottle,
  sealAllPasswords, needsSealing, sealHash, readableHash, passwordEncryption,
  sessionCookie, clearedCookie, cookieName, cookiesSecureByDefault, PORTAL_COOKIE, ADMIN_COOKIE, HRIS_COOKIE,
} from './auth.js';
import { checkStructure, checkBody, t } from './validate.js';
import { clientIp, createRateLimiter, networkMatcher, networkOf, parseNetwork } from './ratelimit.js';
import { ROLES, can, userCan, setRoleOverrides } from '../shared/roles.js';
import { MODULES, moduleOn, enabledModules } from '../shared/modules.js';
import { registerEnrollmentRoutes } from './enrollment.js';
import { registerAdminRoutes, validateUserFields } from './admin.js';
import { registerClassroomRoutes } from './classroom.js';
import { addDemo, removeDemo, demoStatus } from './demo.js';
import { emptyData } from './db.js';
import { createFileStore } from './files.js';
import { registerNewsRoutes } from './news.js';
import { registerGuideRoutes } from './guides.js';
import { readFileSync } from 'node:fs';
import { createAudit, systemOf, describeRoute, sideLabel, isStaff, addAuditDemo, removeAuditDemo } from './audit.js';
import { registerSystemRoutes } from './system.js';
import { createMonitor } from './monitor.js';
import { registerMonitorRoutes } from './monitor-panel.js';
import { registerAccountRoutes, createAvatarStore, tidyAvatars } from './account.js';
import { registerPdfStudio, DIRECT_UPLOAD_BYTES } from './tools-pdf.js';
import { PDF_LIMITS } from '../shared/pdf-studio.js';
import { TOOLS, toolOpenFor } from '../shared/systems.js';
import { createTwoFactor, hasTwoFactor, cleanBackupTwoFactor } from './two-factor.js';
import { TITLES, checkRegistration, composeName, usernameFromEmail, defaultPrivacyText, PASSWORDS_DIFFER } from '../shared/registration.js';

// The version of this ATLAS (package.json), shown with the guides.
const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '';
  } catch {
    return '';
  }
})();
import { themeColors } from '../shared/themes.js';
import { brandName, productName, isSchoolBrand } from '../shared/brand.js';
import { SYSTEMS, systemName } from '../shared/systems.js';
import { campusesFor, activeCampusId, campusName } from './campus.js';
import { registerHrisRoutes } from './hris.js';
import { registerGuardianRoutes, guardianChildren } from './guardian.js';
import { HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import { registerAcademicRoutes, ACADEMIC_ROLES } from './academic.js';
import { registerSsoRoutes } from './sso.js';
import { registerCloudflareRoutes } from './cloudflare.js';
import { registerFinanceRoutes } from './finance.js';
import { registerConfigRoutes } from './config.js';
import { registerCalendarRoutes } from './calendar.js';
import { addFinanceDemo, removeFinanceDemo } from './finance-demo.js';
import { notify, registerNotificationRoutes, restoreNotifications, addNotificationsDemo, removeNotificationsDemo, fmtDay } from './notifications.js';
import { registerDocuments } from './documents.js';
import { registerForms } from './forms.js';
import { FORMS_TOOL } from '../shared/forms.js';
import { createSecrets } from './secrets.js';
import { registerRecruitmentRoutes } from './recruitment.js';
import { registerPlantillaRoutes } from './plantilla.js';
import { applicantExpired } from '../shared/recruitment.js';
import { demoPdf, demoDocx } from './demo.js';
import { MAX_ATTACH_PIECE_BODY } from './recruitment-docs.js';


// The largest request body: 20 MB for someone signed in (files travel as base64 in JSON), and
// 256 KB for anyone else; signing in, applying and first-run setup need only a few hundred bytes.
// Reading and decoding a large body holds up the whole server, so a stranger may not send one.
export const MAX_BODY_SIGNED_IN = 20 * 1024 * 1024;
export const MAX_BODY_SIGNED_OUT = 256 * 1024;
export const MAX_DOCS_BODY = 6 * 1024 * 1024; // ATLAS Documents: a 4 MB piece as base64, with room
// People's recruitment: an applicant's document arrives in pieces of 1 MB (server/recruitment-docs.js).
export { MAX_ATTACH_PIECE_BODY };
// A job applicant signed in: their own picture (300 KB) is the largest thing they send besides a piece.
export const MAX_BODY_APPLICANT = 512 * 1024;
const ATTACH_PIECE = /^\/api\/hris\/jobs\/[^/]+\/documents\/uploads\/[^/]+$/;

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// options.clock: () => Date, so tests can pin "today".
// options.setupCode (or the SETUP_CODE environment variable): when set, creating the first
// administrator also needs this code, so nobody else can claim a new server on the internet.
// options.ssoSecret / options.ssoFetch: the Keycloak client secret and fetch, for tests (default: OIDC_CLIENT_SECRET, fetch).
// options.secrets: the server key (server/secrets.js; default: SERVER_KEY, or server.key beside the data file).
// options.documentsDir: where ATLAS Documents keeps its encrypted files (default: data/documents).
// options.formsDir: where Document circulation keeps its encrypted form files (default: data/forms).
// options.applicantFilesDir: where job applicants' documents are kept, encrypted (default: data/applicant-files).
// options.cloudflareFetch / options.cloudflareHelper: fetch for Cloudflare's API and the AWS instance
// metadata, and where the server's Cloudflare helper is installed, for tests (default: fetch, /usr/local/sbin/ltdc-lms-cloudflare).
export function createApi(db, { clock = () => new Date(), setupCode = process.env.SETUP_CODE || '', ssoSecret, ssoFetch, cloudflareFetch, cloudflareHelper, ssoLookup, rateLimits = process.env.RATE_LIMITS || '', sealAtStart = true, secrets = createSecrets(db.dir), documentsDir, formsDir, applicantFilesDir, secureCookies = cookiesSecureByDefault() } = {}) {
  const sameCode = (given) => {
    const a = createHash('sha256').update(String(given ?? '')).digest();
    const b = createHash('sha256').update(setupCode).digest();
    return timingSafeEqual(a, b);
  };
  const routes = [];
  // Settings → Sign-in & passwords: idle sign-out and lockout apply at once.
  const security = () => db.data.settings.security || {};
  const idleMs = () => Math.min(72, Math.max(1, Number(security().idleHours) || 8)) * 3600 * 1000;
  // However busy, a session ends this long after sign-in (never sooner than the idle time).
  const maxSessionMs = () => Math.max(idleMs(), Math.min(168, Math.max(1, Number(security().maxSessionHours) || 12)) * 3600 * 1000);
  const sides = { portal: createSessions(idleMs, maxSessionMs), admin: createSessions(idleMs, maxSessionMs), hris: createSessions(idleMs, maxSessionMs) };
  // Session cookie names: "__Host-…" when served over HTTPS (server/auth.js).
  const COOKIES = { portal: cookieName(PORTAL_COOKIE, secureCookies), admin: cookieName(ADMIN_COOKIE, secureCookies), hris: cookieName(HRIS_COOKIE, secureCookies) };
  const setCookie = (side, token) => sessionCookie(COOKIES[side], token, maxSessionMs(), secureCookies);
  const clearCookie = (side) => clearedCookie(COOKIES[side], secureCookies);
  const lockout = () => ({ max: Number(security().lockoutAttempts) || 5, lockMs: (Number(security().lockoutMinutes) || 5) * 60 * 1000 });
  const throttle = createThrottle(lockout);
  // Wrong 2-step verification codes, per account from every address (server/two-factor.js): the same
  // settings as wrong passwords. A right password does not forgive them; only a right code does.
  const codeLocks = createThrottle(lockout, { now: () => clock().getTime() });
  // Rate limits (server/ratelimit.js). Signed in: per person; not signed in: per network address
  // (four times as many, as a whole school may share one address). RATE_LIMITS=off switches them off.
  // School networks (Sign-in and passwords): a campus shares one or two addresses, so the limits
  // counted per address are multiplied there (`<rule>@school`); everywhere else they are unchanged.
  const SCHOOL_SCALED = ['signin', 'signinFail', 'address', 'apply', 'sso'];
  const onSchoolNetwork = networkMatcher();
  const atSchool = (ip) => onSchoolNetwork(security().schoolNetworks, ip);
  const byAddress = (name, ip) => (SCHOOL_SCALED.includes(name) && atSchool(ip) ? `${name}@school` : name);
  const limits = createRateLimiter(() => {
    if (rateLimits === 'off') return {};
    const perMinute = Number(security().requestsPerMinute) || 300;
    const MIN = 60 * 1000;
    const rules = {
      user: { limit: perMinute, windowMs: MIN },
      address: { limit: perMinute * 4, windowMs: MIN },
      signin: { limit: 60, windowMs: MIN }, // sign-in attempts per address (each is a slow password check)
      sso: { limit: 120, windowMs: MIN }, // Keycloak sign-ins per address (each counts twice: on the way out and back)
      signinFail: { limit: Number(security().signInFailuresPerAddress) || 30, windowMs: 15 * MIN }, // wrong passwords per address
      password: { limit: 10, windowMs: 15 * MIN }, // password changes per person (each checks the current password)
      apply: { limit: 10, windowMs: 60 * MIN }, // applications per address
      setup: { limit: 20, windowMs: 15 * MIN }, // first-administrator attempts per address
      lookup: { limit: 60, windowMs: MIN }, // document checks per address
      feed: { limit: 20, windowMs: 15 * MIN }, // one calendar feed (calendar apps fetch it every few minutes at most, from shared addresses)
      outbound: { limit: 20, windowMs: 15 * MIN }, // tests of the Keycloak connection per address (each makes this server call another)
      // ATLAS Documents' links for people outside the school (server/documents.js)
      shareAccess: { limit: 120, windowMs: MIN }, // requests to links, per address
      shareLink: { limit: 300, windowMs: MIN }, // requests to one link, from anywhere
      sharePasswordFail: { limit: 10, windowMs: 15 * MIN }, // wrong link passwords, per address and link
      shareUpload: { limit: 60, windowMs: 60 * MIN }, // files sent through upload links, per address
      publicForms: { limit: 60, windowMs: MIN }, // Document circulation: the public Forms page and its downloads, per address
    };
    // From a school network: the same rules, multiplied (a campus is many people at one address).
    const factor = Math.min(100, Math.max(1, Number(security().schoolNetworkFactor) || 20));
    for (const name of SCHOOL_SCALED) rules[`${name}@school`] = { ...rules[name], limit: rules[name].limit * factor };
    return rules;
  });
  // The same limits, counted with the school-network rule where the address is on one (for modules
  // that count per address themselves, as 2-step verification's wrong codes).
  const addressLimits = {
    hit: (name, key, message) => limits.hit(byAddress(name, key), key, message),
    check: (name, key, message) => limits.check(byAddress(name, key), key, message),
    add: (name, key) => limits.add(byAddress(name, key), key),
  };
  const users = () => db.data.users;
  // System → Security monitor (server/monitor.js): requests (reported by server.js), audit entries
  // and the process, in buckets of fixed size, kept in monitor.json beside the data.
  const openSessions = () => Object.entries(sides).flatMap(([side, s]) => s.list().map((x) => ({ ...x, side })));
  const monitor = createMonitor(db.dir, { sessions: openSessions });
  // The audit trail (server/audit.js, System → Audit log).
  const audit = createAudit(db, { onRecord: (entry) => monitor.audit(entry) });
  const SIDE_SYSTEM = { portal: 'learn', admin: 'admin', hris: 'people' };
  // Password hashes are encrypted under the current key (server/auth.js): plain ones, and ones under
  // an old key, are encrypted now; ones under a key this server lacks cannot be used until it has it.
  function sealPasswords() {
    const { sealed, unreadable, resealed } = sealAllPasswords(users()); // and the 2-step verification secrets under an old key
    if (sealed || resealed) db.save();
    if (unreadable) console.warn(`  ${unreadable} account(s) have passwords encrypted with another key, so they cannot sign in. Set PASSWORD_KEY (or PASSWORD_KEY_OLD) to that key, or reset those passwords.`);
    return { sealed, unreadable };
  }
  // server.js waits until the new version has run for a while (sealAtStart: false), so an update
  // that is rolled back never leaves hashes the previous version cannot read.
  if (sealAtStart) sealPasswords();

  // ----- 2-step verification (server/two-factor.js) -----
  // What a request knows while it runs: which signed-in accounts came through Keycloak (they skip
  // ATLAS's 2-step verification, as Keycloak asks for its own). Set by handle() for each request.
  const requestScope = new AsyncLocalStorage();
  const viaSso = (user) => Boolean(user && requestScope.getStore()?.sso.has(user.id));
  // An account as it may leave the server (server/auth.js), with whether it must set up 2-step
  // verification before anything else (the browser then shows only that, as for a forced password change).
  const publicUser = (user) => {
    const out = accountFields(user);
    if (out) out.twoFactorSetupRequired = twoFactor.mustSetUp(user);
    if (out) out.manageForms = ctx.forms ? ctx.forms.managed(user) : []; // Document circulation: the modules whose forms this account keeps
    return out;
  };
  const twoFactor = createTwoFactor({
    db, record: (e) => audit.record(e), throttle, codeLocks, limits: addressLimits, sides, security, viaSso, publicUser,
    notify: (userIds, entry) => ctx.notify(userIds, entry),
    systemOf: (user) => SIDE_SYSTEM[ROLES[user.role]?.side] || 'home', now: () => clock().getTime(),
  });

  // limit: a rate-limit rule this route also counts against (see `limits`).
  // audit: false when the route records its own, clearer entry in the audit trail (or nothing worth one);
  // a refused request is recorded either way.
  // body: the fields this route accepts (server/validate.js); others are removed before the handler.
  // limitBy({ params, ip }): what the `limit` counts by (default: the network address; 'password': the person).
  // duringPasswordChange: also answers an account that must first change its password or set up 2-step
  // verification; an open ('public') route without it sees such an account as signed out.
  // applicants: an 'hris' route job applicants may use too (People's jobs area; server/recruitment.js).
  const route = (method, pattern, access, handler, { module = null, duringPasswordChange = false, guardians = false, applicants = false, limit = null, limitBy = null, audit: logged = true, body = null } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, pattern, re, keys, access, handler, module, duringPasswordChange, guardians, applicants, limit, limitBy, audit: logged, body });
  };

  // Bodies of the sign-in, password and setup routes (server/validate.js): only these fields reach them.
  const LOGIN_BODY = { username: t.str(200), password: t.str(10000) }; // a longer password is refused as wrong (401), before the slow check
  const PASSWORD_BODY = { currentPassword: t.str(1000), newPassword: t.str(1000) };

  // Profile pictures (server/account.js): data/avatars/ beside the data, or in memory in tests.
  const avatars = createAvatarStore(db.dir);
  const ctx = {
    db,
    files: createFileStore(db),
    now: () => clock(),
    today: () => localDate(clock()),
    nowLocal: () => localDateTime(clock()),
    signOutEverywhere(userId) {
      for (const side of Object.values(sides)) side.destroyForUser(userId);
      // Their home figures were worked out under the access they had: not shown again.
      for (const k of figuresCache.keys()) if (k.startsWith(`${userId}|`)) figuresCache.delete(k);
    },
    audit: (e) => audit.record(e),
    auditLog: audit, // entries() and verify(), for Control
    secrets, // the server key's derived keys (server/secrets.js): applicants' documents are encrypted with one
    applicantFilesDir,
    // The bell (server/notifications.js): tells accounts about an event, at the server's time.
    notify: (userIds, entry, opts = {}) => notify(db.data, userIds, entry, { at: clock().toISOString(), nowMs: clock().getTime(), ...opts }),
  };

  // ----- Sign-in (shared logic for both sides) -----
  // The account a sign-in names. With `byEmail` (the ATLAS home page), something with an "@" is an
  // email: it names an account only when exactly one account, of any kind, has that email (compared
  // without regard to capitals). None or several: no account, so the answer is the same "Incorrect
  // username or password." as for a wrong password, and nobody can learn which emails exist.
  // Usernames never contain "@" (server/admin.js), so the two cannot be confused.
  function findAccount(typed, byEmail) {
    const name = String(typed || '').trim().toLowerCase();
    if (!name) return null;
    if (byEmail && name.includes('@')) {
      const matches = users().filter((u) => String(u.email || '').toLowerCase() === name);
      return matches.length === 1 ? matches[0] : null;
    }
    return users().find((u) => u.username === name) || null;
  }

  // Wrong passwords lock a username for this address (so a stranger cannot lock someone out of
  // every computer), for every address after ten times as many, and pause an address that keeps
  // guessing across many usernames. The lock is the username's, whichever sign-in page is used.
  //
  // The password check is slow on purpose and runs off the main thread, so other requests go on
  // meanwhile. Each attempt is therefore counted as a failure *before* the check (and forgiven if
  // the password is right): fifty guesses sent at once still lock the username after the fifth.
  //
  // With 2-step verification on, a right password opens no session: the answer is a challenge
  // ({ twoFactorRequired, challenge }) for the code, sent to the verify route of the same sign-in
  // (`via`: 'hub' for the ATLAS home page, else the side's own sign-in), which opens it.
  //
  // On the ATLAS home page (`via` 'hub') the account may also be named by its email: see findAccount.
  async function signIn(side, body, ip = '', agent = '', via = side) {
    const typed = String(body.username || '').trim().toLowerCase().slice(0, 200);
    const password = String(body.password || '');
    const user = findAccount(typed, via === 'hub');
    // Locks count against the account an email names (so typing the email or the username makes no
    // difference); an email that names no single account is counted on its own, like a username.
    const key = `user:${user ? user.username : typed.slice(0, 200)}`;
    const here = `${key}@${ip}`;
    // Every refusal is in the audit trail, with the account it was for (a username nobody has is not
    // written down: people sometimes type their password into the username box).
    const refuse = (reason, run) => {
      try {
        return run();
      } catch (err) {
        audit.record({ kind: 'signin', system: SIDE_SYSTEM[side], action: `Sign-in ${err.status === 401 ? 'failed' : 'refused'}: ${reason}`, target: user || null, targetName: user ? '' : '(unknown username)', ip, agent, outcome: 'failed', detail: sideLabel(side) });
        throw err;
      }
    };
    refuse('too many wrong passwords from this address', () => limits.check(byAddress('signinFail', ip), ip, 'Too many wrong passwords from your network.'));
    refuse('username locked', () => {
      throttle.check(here);
      throttle.check(key);
    });
    // With single sign-on on and passwords off, only administrators keep a password (a way in if
    // Keycloak is down). Everyone else gets the same answer whether the password was right, wrong
    // or the account does not exist, so old passwords cannot be tested here.
    const sso = db.data.settings.sso;
    const passwordsOff = Boolean(sso?.enabled && !sso.allowPasswords);
    throttle.fail(here); // counted now, forgiven below if the password is right
    throttle.fail(key, 10);
    const stored = user?.passwordHash;
    const right = password.length <= 200 && (await verifyPasswordAsync(password, stored));
    // Everything from here runs without pausing, so it sees one consistent state.
    // Job applicants are outside the school, so they have no Keycloak account: they keep their password.
    if (!right || (passwordsOff && !['admin', 'applicant'].includes(user.role))) {
      limits.add(byAddress('signinFail', ip), ip);
      refuse(!right ? (user ? 'wrong password' : 'no such account') : 'passwords are switched off', () => fail(passwordsOff ? `This school signs in with Keycloak. Choose "${sso.label}".` : 'Incorrect username or password.', 401));
    }
    throttle.reset(here);
    throttle.reset(key);
    if (needsSealing(user.passwordHash)) user.passwordHash = sealHash(user.passwordHash); // saved below
    // A hash made at a lower cost than today's is redone with this password, in the background. It is
    // kept only if the account still has the hash it has now (not, say, a password changed meanwhile).
    if (needsRehash(stored)) {
      const settled = user.passwordHash;
      hashPasswordAsync(password).then((next) => {
        if (user.passwordHash === settled) {
          user.passwordHash = next;
          db.save();
        }
      }).catch(() => {});
    }
    refuse('wrong sign-in page', () => {
      if (ROLES[user.role]?.side !== side) {
        fail(ROLES[user.role]?.side === 'hris'
          ? `HR and staff accounts sign in on the ${brandName(db.data.settings.branding)} home page and open People.`
          : side === 'admin'
            ? `Teachers and students sign in on the ${brandName(db.data.settings.branding)} home page, not the admin panel.`
            : 'Administrators and registrars sign in on the admin panel at /admin.', 403);
      }
    });
    // A job applicant's account closes after a set number of days (server/recruitment.js).
    refuse('applicant account closed', () => {
      if (user.role === 'applicant' && (user.status === 'expired' || applicantExpired(user, clock().getTime()))) {
        fail(`Your applicant account closed on ${fmtDay(localDate(new Date(user.expiresAt)))}. Ask HR to extend it if you still want to apply.`, 403);
      }
    });
    refuse(`account ${user.status}`, () => {
      if (user.status === 'pending') fail('Your application is still being reviewed. You can sign in once the registrar admits you.', 403);
      if (user.status === 'rejected') fail('Your application was not accepted. Contact the registrar for details.', 403);
      if (user.status !== 'active') fail('This account is disabled. Contact the registrar.', 403);
    });
    if (hasTwoFactor(user)) {
      db.save(); // a hash sealed above
      return { data: { twoFactorRequired: true, challenge: twoFactor.challenge(user, side, via) }, headers: {} };
    }
    return openSession(side, user, ip, agent);
  }
  // The session at the end of a sign-in. how: 'password', or after the code: 'app' or 'recovery'.
  function openSession(side, user, ip, agent, how = 'password', recoveryLeft = 0) {
    user.lastLoginAt = new Date().toISOString();
    db.save();
    const detail = { password: 'password', app: 'password and 2-step verification code', recovery: `password and a recovery code; ${recoveryLeft} recovery code${recoveryLeft === 1 ? '' : 's'} left` }[how];
    audit.record({ kind: 'signin', system: SIDE_SYSTEM[side], action: how === 'recovery' ? 'Signed in with a recovery code' : 'Signed in', actor: user, target: user, ip, agent, detail: `${sideLabel(side)} · ${detail}` });
    return { data: { user: publicUser(user) }, headers: { 'Set-Cookie': setCookie(side, sides[side].create(user.id, { ip, agent })) } };
  }
  // The second step of a sign-in started on `via`: the code, then the session, with the same cookies
  // that sign-in would have set (the ATLAS home page also ends this browser's other sessions).
  const CODE_BODY = { challenge: t.str(200), code: t.str(40) };
  const verifySignIn = (via) => ({ body, tokens, ip, agent }) => {
    const { user, side, how, left } = twoFactor.verify(via, body, ip, agent);
    const out = openSession(side, user, ip, agent, how, left);
    return via === 'hub' ? endOtherSides(out, side, tokens) : out;
  };
  // One person per browser: the sessions this browser has on the other sides end, and their cookies go.
  function endOtherSides(out, side, tokens) {
    for (const [name, sessions] of Object.entries(sides)) if (name !== side) sessions.destroy(tokens[name]);
    out.headers['Set-Cookie'] = [out.headers['Set-Cookie'], ...Object.keys(sides).filter((n) => n !== side).map(clearCookie)];
    return out;
  }

  // A session for `user` on their side, ending any other side's session in this browser (single sign-on).
  function startSession(user, tokens, extra = {}) {
    const side = ROLES[user.role]?.side;
    if (!side) fail('This account type cannot sign in.', 403);
    for (const [name, sessions] of Object.entries(sides)) if (name !== side) sessions.destroy(tokens[name]);
    user.lastLoginAt = new Date().toISOString();
    return [setCookie(side, sides[side].create(user.id, extra)), ...Object.keys(sides).filter((n) => n !== side).map(clearCookie)];
  }

  async function changePassword(side, { user, token, body, ip, agent }) {
    const stored = user.passwordHash;
    if (!(await verifyPasswordAsync(String(body.currentPassword || ''), stored))) {
      audit.record({ kind: 'password', system: SIDE_SYSTEM[side], action: 'Password change failed: wrong current password', actor: user, target: user, ip, agent, outcome: 'failed' });
      fail('Your current password is incorrect.');
    }
    validatePassword(body.newPassword, db.data.settings.security);
    if (body.newPassword === body.currentPassword) fail('Choose a password different from the current one.');
    const next = await hashPasswordAsync(body.newPassword);
    if (user.passwordHash !== stored) fail('Your password was changed meanwhile. Sign in again and try once more.', 409);
    user.passwordHash = next;
    user.mustChangePassword = false;
    for (const [name, sessions] of Object.entries(sides)) sessions.destroyForUser(user.id, name === side ? token : undefined);
    audit.record({ kind: 'password', system: SIDE_SYSTEM[side], action: 'Changed their password', actor: user, target: user, ip, agent, detail: 'Their other sessions were ended.' });
    db.save();
    return { user: publicUser(user) };
  }

  const setupRequired = () => !users().some((u) => u.role === 'admin');
  // School name, colours and logo, for every page including the sign-in screens.
  const branding = () => {
    const b = db.data.settings.branding;
    const term = db.data.terms.find((t) => t.id === db.data.settings.currentTermId);
    // mode and shortName: whose brand leads (shared/brand.js); the sign-in pages need them too.
    return { schoolName: db.data.settings.schoolName, ...themeColors(b), theme: b.theme, logo: b.logo, tagline: b.tagline, termName: term?.name || '', mode: isSchoolBrand(b) ? 'school' : 'atlas', shortName: b.shortName || '', brandName: brandName(b) };
  };
  // The campuses an account can switch between, and the one it is looking at.
  const campusInfo = (user) => {
    const list = campusesFor(db.data, user).map((c) => ({ id: c.id, name: c.name, code: c.code }));
    const active = user ? activeCampusId(db.data, user) : null;
    return { campuses: list, activeCampusId: active, campusName: campusName(db.data, active) };
  };
  function switchCampus(user, body) {
    const id = String(body.campusId || '');
    if (!campusesFor(db.data, user).some((c) => c.id === id)) fail('You do not have access to that campus.', 403);
    user.activeCampusId = id;
    db.save();
    return campusInfo(user);
  }
  const portalInfo = (user) => ({
    ...campusInfo(user),
    schoolName: db.data.settings.schoolName,
    branding: branding(),
    setupRequired: setupRequired(),
    registrationOpen: db.data.settings.registration.open,
    user: publicUser(user),
    modules: user ? enabledModules(db.data.modules, user.role) : [],
    children: user?.role === 'guardian' ? guardianChildren(db.data, user.id).map(({ link, student }) => ({ id: student.id, name: student.name, relationship: link.relationship })) : undefined,
    currentTermId: db.data.settings.currentTermId,
    passingGrade: db.data.settings.passingGrade,
    maxUploadMb: Math.min(15, Number(db.data.settings.learn?.maxUploadMb) || 10),
  });

  // ----- Learning portal: sign-in and admissions -----
  route('GET', '/api/auth/status', 'public', ({ portalUser }) => portalInfo(portalUser), { duringPasswordChange: true });
  route('POST', '/api/auth/login', 'public', ({ body, ip, agent }) => signIn('portal', body, ip, agent), { limit: 'signin', body: LOGIN_BODY });
  route('POST', '/api/auth/login/verify', 'public', verifySignIn('portal'), { limit: 'signin', body: CODE_BODY });
  route('POST', '/api/auth/logout', 'public', ({ portalToken, portalUser, ip, agent }) => {
    if (portalUser) audit.record({ kind: 'signout', system: 'learn', action: 'Signed out', actor: portalUser, target: portalUser, ip, agent });
    sides.portal.destroy(portalToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearCookie('portal') } };
  }, { duringPasswordChange: true });
  route('POST', '/api/auth/change-password', 'portal', (a) => changePassword('portal', a), { duringPasswordChange: true, limit: 'password', guardians: true, audit: false, body: PASSWORD_BODY });
  route('POST', '/api/auth/campus', 'portal', ({ user, body }) => switchCampus(user, body), { guardians: true, audit: false });
  route('POST', '/api/admin/auth/campus', 'admin', ({ user, body }) => switchCampus(user, body), { audit: false });
  // ----- Student self-registration: "Register account" on the ATLAS home page -----
  // The form asks for the campus, title, name, email, mobile number and a password
  // (shared/registration.js). The account waits as an applicant (status "pending") until the
  // registrar admits it under Admin panel → Applicants; the student then signs in with the email.
  // Program and year level come later, at admission and enrollment.
  const registrationClosed = () => {
    if (!db.data.settings.registration.open) fail('Registration is closed. Contact the registrar.', 403);
  };
  // The school's Terms of Use and Privacy Policy for the form: an address, or a text. Terms only when
  // the school has given some; the privacy notice falls back to ATLAS's built-in one.
  const policies = () => {
    const r = db.data.settings.registration;
    const terms = r.termsUrl || r.termsText ? { url: r.termsUrl || '', text: r.termsUrl ? '' : r.termsText } : null;
    const privacy = { url: r.privacyUrl || '', text: r.privacyUrl ? '' : r.privacyText || defaultPrivacyText(db.data.settings.schoolName), builtIn: !r.privacyUrl && !r.privacyText };
    return { terms, privacy };
  };
  route('GET', '/api/auth/register', 'public', () => {
    registrationClosed();
    const sec = db.data.settings.security || {};
    return {
      campuses: db.data.campuses.map((c) => ({ id: c.id, name: c.name })),
      titles: TITLES,
      password: { min: Math.max(8, Number(sec.minPasswordLength) || 8), lettersAndDigits: Boolean(sec.requireLettersAndDigits) }, // as validatePassword
      ...policies(),
    };
  });
  // The answers, checked (and the campus and the email against the school's records): the cleaned
  // fields and the campus, or a refusal with what to fix.
  const registration = (body) => {
    const { fields, problem } = checkRegistration(body);
    if (problem) fail(problem);
    const campus = db.data.campuses.find((c) => c.id === fields.campusId);
    if (!campus) fail('That campus is not on the list. Choose your preferred campus again.');
    // One account per email, compared without regard to capitals, across every kind of account
    // (students sign in with it, so it must name only them).
    if (users().some((u) => String(u.email || '').toLowerCase() === fields.email)) fail('An account with this email address already exists. Sign in with it, or ask the registrar for help.', 409);
    return { fields, campus };
  };
  route('POST', '/api/auth/register', 'public', async ({ body, ip, agent }) => {
    registrationClosed();
    registration(body); // the answers first, before the slow hash
    validatePassword(body.password, db.data.settings.security);
    if (body.password !== body.confirmPassword) fail(PASSWORDS_DIFFER);
    const passwordHash = await hashPasswordAsync(body.password);
    // Checked again after the hash (registration may have closed, or someone taken the email
    // meanwhile), then saved without pausing.
    registrationClosed();
    const { fields: f, campus } = registration(body);
    const at = clock().toISOString();
    const user = {
      id: randomUUID(),
      role: 'student',
      name: composeName(f),
      title: f.title,
      firstName: f.firstName,
      middleName: f.middleName,
      lastName: f.lastName,
      // Not asked: the student signs in with the email. Kept so every screen that shows one works.
      username: usernameFromEmail(f.email, (name) => users().some((u) => u.username === name)),
      email: f.email,
      mobile: f.mobile,
      programId: null,
      yearLevel: 1,
      studentNo: '',
      campusIds: [campus.id],
      status: 'pending',
      mustChangePassword: false,
      passwordHash,
      registeredVia: 'self',
      appliedAt: at,
      createdAt: at,
    };
    users().push(user);
    // The student record in Academic (TORs, certificates, the profile) reads the name parts and the
    // contact number from here.
    db.data.studentProfiles.push({
      id: randomUUID(), studentId: user.id, studentType: 'new', requirements: {}, education: [],
      lastName: f.lastName, firstName: f.firstName, middleName: f.middleName, contactNo: f.mobile, createdAt: at,
    });
    db.save();
    audit.record({ kind: 'account', system: 'home', action: 'Registered for a student account (waiting for the registrar)', actor: user, target: user, ip, agent, detail: campus.name });
    return { ok: true, name: user.name, email: user.email, mobile: user.mobile, campusName: campus.name };
  }, {
    limit: 'apply', // registrations per network address (the rule's name is from "Apply for admission")
    audit: false,
    body: { campusId: t.str(100), title: t.str(20), firstName: t.str(200), middleName: t.str(200), lastName: t.str(200), email: t.str(320), mobile: t.str(40), password: t.str(1000), confirmPassword: t.str(1000) },
  });

  // ----- University Portal (/): one sign-in for every system -----
  // The account type decides which session is opened: students and teachers get the
  // portal (LMS) session, administrators and registrars the admin-panel session.
  const portalSystems = (user, side) => SYSTEMS
    .map((s) => {
      const cfg = s.builtIn ? { status: 'live', url: '' } : db.data.settings.systems[s.id] || { status: 'soon', url: '' };
      // A system named after its product ("ATLAS Learn") carries the brand: "<short> Learn" in school mode.
      return { ...s, name: systemName(s, db.data.settings.branding), status: cfg.status, url: s.builtIn ? (s.id === 'lms' && side === 'admin' ? '/admin' : s.path) : cfg.url, external: !s.builtIn };
    })
    .filter((s) => s.status !== 'hidden' && (!user || s.audience.includes(user.role)))
    .map(({ audience, ...s }) => (user ? s : { ...s, url: '' }));
  const AUTH_BASE = { portal: '/api/auth', admin: '/api/admin/auth', hris: '/api/hris/auth' };
  route('GET', '/api/hub/status', 'public', ({ portalUser, adminUser, hrisUser }) => {
    const user = portalUser || adminUser || hrisUser;
    const side = user ? ROLES[user.role].side : null;
    return {
      branding: branding(),
      setupRequired: setupRequired(),
      registrationOpen: db.data.settings.registration.open,
      user: publicUser(user),
      side,
      authBase: AUTH_BASE[side] || '/api/auth',
      sso: sso.publicInfo(),
      systems: portalSystems(user, side),
      tools: ctx.toolsFor ? ctx.toolsFor(user) : [], // ATLAS Tools this account may use (PDF Studio…)
      jobs: recruitment.publicCount(), // open job openings anyone may apply for (the sign-in page links to them)
      publicForms: forms.publicCount(), // public forms (Document circulation): the sign-in page links to them
      ...campusInfo(user),
    };
  }, { duringPasswordChange: true });
  // One person per browser: signing in here ends any other session this browser had.
  route('POST', '/api/hub/login', 'public', async ({ body, tokens, ip, agent }) => {
    const found = findAccount(body.username, true); // a username, or an email (see findAccount)
    const side = ROLES[found?.role]?.side || 'portal';
    const out = await signIn(side, body, ip, agent, 'hub');
    if (out.data.twoFactorRequired) return out; // the other sessions end once the code is right
    return endOtherSides(out, side, tokens);
  }, { limit: 'signin', body: LOGIN_BODY });
  route('POST', '/api/hub/login/verify', 'public', verifySignIn('hub'), { limit: 'signin', body: CODE_BODY });
  route('POST', '/api/hub/logout', 'public', ({ tokens, origin, portalUser, adminUser, hrisUser, ip, agent }) => {
    const who = portalUser || adminUser || hrisUser;
    if (who) audit.record({ kind: 'signout', system: 'home', action: 'Signed out', actor: who, target: who, ip, agent });
    // A single sign-on session also ends at Keycloak: the browser goes there next.
    const ssoSession = Object.entries(sides).map(([name, sessions]) => sessions.get(tokens[name])).find((s) => s?.sso);
    const ssoLogout = sso.logoutUrl(ssoSession, origin);
    for (const [name, sessions] of Object.entries(sides)) sessions.destroy(tokens[name]);
    return { data: { ok: true, ssoLogout }, headers: { 'Set-Cookie': Object.keys(COOKIES).map(clearCookie) } };
  }, { duringPasswordChange: true });
  // School news and upcoming events for the portal home (when News & events is on for the account type).
  route('GET', '/api/hub/feed', 'public', ({ portalUser, adminUser, hrisUser }) => {
    const user = portalUser || adminUser || hrisUser;
    if (!user) fail('Please sign in.', 401);
    if (portalUser && !moduleOn(db.data.modules, 'news', user.role)) return { news: [], events: [] };
    if (user.role === 'applicant') return { news: [], events: [] }; // the school's news is for its people
    const campusId = activeCampusId(db.data, user);
    const here = (x) => x.campusId == null || x.campusId === campusId;
    const news = db.data.news.filter(here).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4)
      .map(({ reactions, comments, ...n }) => ({ ...n, body: n.body.slice(0, 280), comments: comments?.length || 0 }));
    return { news, events: ctx.upcomingEvents(campusId, portalUser ? user.role : null).slice(0, 5) };
  });

  // ----- Admin panel: sign-in -----
  route('GET', '/api/admin/auth/status', 'public', ({ adminUser }) => ({
    sso: sso.publicInfo(),
    setupRequired: setupRequired(),
    setupCodeRequired: setupRequired() && Boolean(setupCode),
    schoolName: db.data.settings.schoolName,
    branding: branding(),
    user: publicUser(adminUser),
    ...campusInfo(adminUser),
    roleOverrides: adminUser ? db.data.roleOverrides || {} : undefined, // the Admin panel's can() (shared/roles.js)
  }), { duringPasswordChange: true });
  route('POST', '/api/admin/auth/setup', 'public', async ({ body, ip, agent }) => {
    if (!setupRequired()) fail('Setup is already complete. Please sign in.');
    if (setupCode) {
      throttle.check(`setup@${ip}`);
      if (!sameCode(body.setupCode)) {
        throttle.fail(`setup@${ip}`);
        fail('That setup code is not correct. It is the one chosen when the server was created.', 403);
      }
    }
    validateUserFields({ ...body, role: 'admin' }, db.data);
    validatePassword(body.password, db.data.settings.security);
    const passwordHash = await hashPasswordAsync(body.password);
    // Two setups sent at once: only the first makes an administrator.
    if (!setupRequired()) fail('Setup is already complete. Please sign in.');
    const fields = validateUserFields({ ...body, role: 'admin' }, db.data);
    users().push({ id: randomUUID(), ...fields, status: 'active', mustChangePassword: false, passwordHash, createdAt: new Date().toISOString() });
    if (body.schoolName) db.data.settings.schoolName = text(body.schoolName, 120);
    if (text(body.campusName, 80)) {
      db.data.campuses[0].name = text(body.campusName, 80);
      db.data.campuses[0].code = db.data.campuses[0].name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'MAIN';
    }
    db.save();
    const first = users().find((u) => u.username === fields.username);
    audit.record({ kind: 'account', system: 'admin', action: 'Set up ATLAS: made the first administrator', actor: first, target: first, ip, agent });
    return signIn('admin', body, ip, agent);
  }, { limit: 'setup', body: { name: t.str(200), username: t.str(200), email: t.str(320), password: t.str(1000), schoolName: t.str(400), campusName: t.str(200), setupCode: t.str(200) } });
  route('POST', '/api/admin/auth/login', 'public', ({ body, ip, agent }) => signIn('admin', body, ip, agent), { limit: 'signin', body: LOGIN_BODY });
  route('POST', '/api/admin/auth/login/verify', 'public', verifySignIn('admin'), { limit: 'signin', body: CODE_BODY });
  route('POST', '/api/admin/auth/logout', 'public', ({ adminToken, adminUser, ip, agent }) => {
    if (adminUser) audit.record({ kind: 'signout', system: 'admin', action: 'Signed out', actor: adminUser, target: adminUser, ip, agent });
    sides.admin.destroy(adminToken);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearCookie('admin') } };
  }, { duringPasswordChange: true });
  route('POST', '/api/admin/auth/change-password', 'admin', (a) => changePassword('admin', a), { duringPasswordChange: true, limit: 'password', audit: false, body: PASSWORD_BODY });

  // ----- Data: backups and demo data -----
  route('GET', '/api/admin/backup', 'admin:data.manage', ({ user }) => {
    monitor.noteBackup(user.name); // the Security monitor's Backup check
    return db.data;
  });
  route('POST', '/api/admin/restore', 'admin:data.manage', ({ body }) => {
    if (!Array.isArray(body.users) || !Array.isArray(body.enrollments)) fail('That file is not an ATLAS backup.');
    const admins = body.users.filter((u) => u.role === 'admin' && u.status === 'active' && u.passwordHash);
    if (!admins.length) fail('The backup has no active administrator, so nobody could sign in.');
    if (!admins.some((u) => readableHash(u.passwordHash))) fail('This backup\'s passwords are encrypted with another server\'s key, so nobody could sign in. Start ATLAS with that key as PASSWORD_KEY_OLD, then restore again.');
    // The audit log is not part of a backup (it is its own file): an old backup's trail is left out.
    const { auditTrail, ...restored } = body;
    // 2-step verification: kept where it has the shape ATLAS writes, dropped where it does not (server/two-factor.js).
    const droppedTwoFactor = cleanBackupTwoFactor(restored.users);
    db.replace({ ...emptyData(), ...restored });
    tidyAvatars(db.data, avatars); // pictures only when their file is on this server (a backup has no files)
    restoreNotifications(db.data, clock().getTime()); // valid rows of accounts in the backup only
    db.save();
    setRoleOverrides(db.data.roleOverrides);
    const { unreadable } = sealPasswords();
    return { ok: true, unreadablePasswords: unreadable, droppedTwoFactor };
  });
  route('GET', '/api/admin/demo', 'admin:data.manage', () => demoStatus(db.data));
  route('POST', '/api/admin/demo', 'admin:data.manage', () => {
    // Making the demo school runs real routes (Finance's), which notify; those go, and the demo
    // accounts get a set of their own instead (demo: true, removed with the demo).
    const before = new Set((db.data.notifications || []).map((n) => n.id));
    addDemo(db.data, ctx.today(), ctx.files);
    addFinanceDemo(db.data, ctx);
    documents.addDemo({ pdf: demoPdf, docx: demoDocx });
    recruitment.addDocsDemo(demoPdf); // applicants' demo documents (generated PDFs), encrypted like the rest
    forms.addDemo(demoPdf); // Document circulation: a few made-up forms per module (generated PDFs)
    addAuditDemo(db.data, clock().getTime());
    db.data.notifications = db.data.notifications.filter((n) => before.has(n.id));
    addNotificationsDemo(db.data, clock().getTime());
    db.save();
    return demoStatus(db.data);
  });
  route('DELETE', '/api/admin/demo', 'admin:data.manage', () => {
    for (const u of users().filter((x) => x.demo)) ctx.signOutEverywhere(u.id);
    documents.removeDemo();
    recruitment.docs.removeDemo();
    forms.removeDemo();
    removeFinanceDemo(db.data);
    removeDemo(db.data, ctx.files);
    removeAuditDemo(db.data);
    removeNotificationsDemo(db.data);
    tidyAvatars(db.data, avatars);
    db.save();
    return demoStatus(db.data);
  });

  // ----- HRIS (/hris/): sign-in status for any employee -----
  // Teachers and registrars use their own session (portal or admin); HR and staff
  // accounts have the HRIS session. Students have no HRIS.
  const hrisStatus = (user) => {
    const allowed = Boolean(user) && user.role !== 'student' && user.role !== 'guardian';
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null, // a student: ATLAS People says it is for employees
      allowed,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/hris/auth',
      permissions: allowed ? HRIS_PERMISSION_LABELS.map(([p]) => p).filter((p) => userCan(user, p)) : [],
      employee: allowed ? hris.employeeSummary(user) : null,
      applicant: allowed && user.role === 'applicant' ? { expiresAt: user.expiresAt } : null, // a job applicant: only the jobs area
      assessor: allowed && user.role !== 'applicant' ? recruitment.assessorSummary(user) : null, // named on a selection board: Ratings to do
    };
  };
  route('GET', '/api/hris/auth/status', 'public', ({ hrisUser, adminUser, portalUser }) => hrisStatus(hrisUser || adminUser || portalUser), { duringPasswordChange: true });
  route('POST', '/api/hris/auth/change-password', 'hris', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, applicants: true, limit: 'password', audit: false, body: PASSWORD_BODY });
  route('POST', '/api/hris/auth/campus', 'hris', ({ user, body }) => switchCampus(user, body), { audit: false });
  const hris = registerHrisRoutes(route, ctx);
  // Recruitment (People → Recruitment; job applicants; server/recruitment.js).
  const recruitment = registerRecruitmentRoutes(route, ctx);
  // The plantilla register (People → Plantilla; server/plantilla.js).
  const plantilla = registerPlantillaRoutes(route, ctx);

  // ----- Academic (/academic/): staff with their admin-panel session, teachers and students with the portal's -----
  const academicUser = (adminUser, portalUser) => adminUser || portalUser || null;
  route('GET', '/api/academic/auth/status', 'public', ({ adminUser, portalUser, hrisUser }) => {
    const user = academicUser(adminUser, portalUser) || hrisUser;
    const allowed = Boolean(user) && ACADEMIC_ROLES.includes(user.role);
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/academic/auth',
      permissions: allowed ? academic.permissionsFor(user) : [],
      currentTermId: db.data.settings.currentTermId,
    };
  }, { duringPasswordChange: true });
  route('POST', '/api/academic/auth/change-password', 'academic', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password', audit: false, body: PASSWORD_BODY });
  route('POST', '/api/academic/auth/campus', 'academic', ({ user, body }) => switchCampus(user, body), { audit: false });
  const academic = registerAcademicRoutes(route, ctx);

  // ----- Finance (/finance/): any employee (finance staff by their finance.* permissions) and students (their receipts) -----
  route('GET', '/api/finance/auth/status', 'public', ({ adminUser, portalUser, hrisUser }) => {
    const user = hrisUser || adminUser || portalUser;
    const allowed = Boolean(user) && user.role !== 'guardian' && user.role !== 'applicant';
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/finance/auth',
      permissions: allowed ? finance.permissionsFor(user) : [],
    };
  }, { duringPasswordChange: true });
  route('POST', '/api/finance/auth/change-password', 'finance', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password', audit: false, body: PASSWORD_BODY });
  route('POST', '/api/finance/auth/campus', 'finance', ({ user, body }) => switchCampus(user, body), { audit: false });
  const finance = registerFinanceRoutes(route, ctx);

  // ----- Documents (/documents/): any employee and students, with whichever session the browser has -----
  route('GET', '/api/docs/auth/status', 'public', ({ adminUser, portalUser, hrisUser }) => {
    const user = hrisUser || adminUser || portalUser;
    const allowed = Boolean(user) && user.role !== 'guardian' && user.role !== 'applicant';
    return {
      ...campusInfo(allowed ? user : null),
      branding: branding(),
      setupRequired: setupRequired(),
      user: allowed ? publicUser(user) : null,
      deniedUser: user && !allowed ? { name: user.name, role: user.role } : null,
      side: allowed ? ROLES[user.role].side : null,
      authBase: '/api/docs/auth',
      permissions: allowed ? ['docs.manage'].filter((p) => userCan(user, p)) : [],
    };
  }, { duringPasswordChange: true });
  route('POST', '/api/docs/auth/change-password', 'documents', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password' });
  route('POST', '/api/docs/auth/campus', 'documents', ({ user, body }) => switchCampus(user, body));
  const documents = registerDocuments(route, db, { secrets, limits, dir: documentsDir, clock: () => clock().getTime(), notify: (ids, entry, opts) => ctx.notify(ids, entry, opts) });
  // ----- Document circulation: every module's downloadable forms (server/forms.js) -----
  const forms = registerForms(route, ctx, { secrets, dir: formsDir, clock, audit: (e) => audit.record(e) });
  ctx.forms = forms;
  registerConfigRoutes(route, ctx);
  const sso = registerSsoRoutes(route, ctx, { startSession, secureCookies, ...(ssoSecret !== undefined ? { secret: ssoSecret } : {}), ...(ssoFetch ? { fetchImpl: ssoFetch } : {}), ...(ssoLookup ? { lookup: ssoLookup } : {}) });
  registerCloudflareRoutes(route, ctx, { ...(cloudflareFetch ? { fetchImpl: cloudflareFetch } : {}), ...(cloudflareHelper ? { helperPath: cloudflareHelper } : {}) });

  ctx.upcomingEvents = registerNewsRoutes(route, ctx).upcoming;
  registerGuideRoutes(route, { db, version: APP_VERSION });
  registerAdminRoutes(route, ctx);
  registerEnrollmentRoutes(route, ctx);
  const classroom = registerClassroomRoutes(route, ctx);
  registerGuardianRoutes(route, ctx, classroom);
  registerCalendarRoutes(route, ctx, classroom);
  // ----- System → Users & Access and Audit log (administrators, in any system's sidebar) -----
  ctx.tidyAvatars = () => tidyAvatars(db.data, avatars);
  registerSystemRoutes(route, ctx, { sides, throttle });
  // ----- The ATLAS home: a few live figures on each system's card (after CORE's home) -----
  // Worked out through each system's own routes, as the person (ctx.invoke), so every permission and
  // campus rule applies unchanged. A figure that cannot be worked out is left out, never an error.
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  async function figuresFor(user) {
    if (user.role === 'applicant') return { uis: [], lms: [], hris: [], fmis: [], dms: [] }; // the jobs area only
    const ask = async (path) => {
      try {
        return await ctx.invoke(user, 'GET', path);
      } catch {
        return null;
      }
    };
    const may = (p) => userCan(user, p);
    const out = { uis: [], lms: [], hris: [], fmis: [], dms: [] };
    // Learn
    if (['teacher', 'student'].includes(user.role)) {
      const d = await ask('/api/home');
      if (d && user.role === 'teacher') {
        out.lms.push(plural(d.classes.length, 'section') + ' you teach');
        const waiting = d.toGrade.reduce((a, x) => a + x.waiting, 0);
        if (waiting) out.lms.push(`${waiting} to grade`);
      } else if (d) {
        out.lms.push(plural(d.classes.length, 'class', 'classes') + ' this term');
        if (d.due.length) out.lms.push(`${d.due.length} to do${d.due.some((x) => x.overdue) ? `, ${d.due.filter((x) => x.overdue).length} overdue` : ''}`);
        if (d.requests?.length) out.lms.push(plural(d.requests.length, 'enrollment request') + ' waiting');
      }
    } else if (user.role === 'guardian') {
      const n = guardianChildren(db.data, user.id).length;
      out.lms.push(n ? `${plural(n, 'child', 'children')} linked` : 'No child linked yet');
    } else if (may('enrollment.manage')) {
      const e = await ask('/api/admin/enrollments/summary');
      if (e?.pending) out.lms.push(plural(e.pending, 'enrollment request') + ' to review');
      if (e?.applicants) out.lms.push(plural(e.applicants, 'applicant') + ' to admit');
    }
    // Academic
    if (ACADEMIC_ROLES.includes(user.role) && may('academic.view')) {
      const a = await ask('/api/academic/dashboard');
      if (a && may('grades.approve') && a.queue.submitted) out.uis.push(plural(a.queue.submitted, 'grade sheet') + ' to approve');
      if (a && may('academic.records') && a.queue.approved) out.uis.push(plural(a.queue.approved, 'grade sheet') + ' to post');
      if (a && may('academic.records') && a.requestsOpen) out.uis.push(plural(a.requestsOpen, 'document request') + ' open');
      if (a && may('grades.approve') && a.changesPending) out.uis.push(plural(a.changesPending, 'grade change') + ' to decide');
    }
    // People
    if (!['student', 'guardian'].includes(user.role)) {
      if (may('leave.manage')) {
        const r = await ask('/api/hris/requests/summary');
        if (r?.pending) out.hris.push(plural(r.pending, 'leave request') + ' waiting');
      }
      const me = hris.employeeSummary(user);
      if (me?.position) out.hris.push(me.position);
    }
    // Finance
    if (user.role !== 'guardian') {
      if (may('finance.view')) {
        const q = (await ask('/api/finance/dashboard'))?.queue;
        const dv = q ? (may('finance.accounts') ? q.dvToCertify : 0) + (may('finance.approve') ? q.dvToApprove : 0) + (may('finance.disburse') ? q.dvToPay : 0) : 0;
        if (dv) out.fmis.push(plural(dv, 'voucher') + ' waiting for you');
        if (q && may('finance.approve') && q.prToApprove) out.fmis.push(plural(q.prToApprove, 'purchase request') + ' to approve');
        if (q && may('finance.collect') && q.undeposited) out.fmis.push(plural(q.undeposited, 'collection report') + ' to deposit');
      } else if (user.role === 'student') {
        const m = await ask('/api/finance/my');
        if (m) out.fmis.push(m.receipts.length ? plural(m.receipts.length, 'official receipt') : 'No receipts yet');
      }
    }
    // Documents: employees and students (one pass over the documents, no route)
    if (user.role !== 'guardian') out.dms = documents.figures(user);
    for (const k of Object.keys(out)) out[k] = out[k].slice(0, 3);
    return out;
  }
  // Cached for a minute per person and campus: each home page load would otherwise work out every
  // card again through several routes, and at 8:00 thousands of people open the home page at once
  // (council 2026-11: "cached figures"). A figure up to a minute old is fine on a card.
  const FIGURES_MS = 60 * 1000;
  const figuresCache = new Map(); // `${userId}|${campusId}` → { at, value }
  route('GET', '/api/hub/figures', 'me', async ({ user, campusId }) => {
    const key = `${user.id}|${campusId || ''}`;
    const hit = figuresCache.get(key);
    if (hit && Date.now() - hit.at < FIGURES_MS) return hit.value;
    const value = await figuresFor(user);
    if (figuresCache.size >= 20000) for (const [k, v] of figuresCache) if (Date.now() - v.at >= FIGURES_MS) figuresCache.delete(k);
    if (figuresCache.size >= 20000) figuresCache.clear(); // still full: start again rather than grow
    figuresCache.set(key, { at: Date.now(), value });
    return value;
  }, { audit: false });

  // ----- ATLAS Tools (/tools/): PDF Studio, ported from CORE (server/tools-pdf.js) -----
  // Document circulation sits beside PDF Studio for the people who keep forms (shared/forms.js FORMS_TOOL).
  const toolsFor = (u) => (u ? [
    ...TOOLS.filter((x) => toolOpenFor(db.data.settings, x.id, u.role)).map(({ defaultRoles, ...x }) => x),
    ...(forms.managed(u).length ? [FORMS_TOOL] : []),
  ] : []);
  route('GET', '/api/tools/auth/status', 'public', ({ hrisUser, adminUser, portalUser }) => {
    const user = portalUser || adminUser || hrisUser;
    return {
      ...campusInfo(user),
      branding: branding(),
      setupRequired: setupRequired(),
      user: publicUser(user),
      side: user ? ROLES[user.role].side : null,
      authBase: '/api/tools/auth',
      tools: toolsFor(user),
    };
  }, { duringPasswordChange: true });
  route('POST', '/api/tools/auth/change-password', 'me', (a) => changePassword(ROLES[a.user.role].side, a), { duringPasswordChange: true, limit: 'password', audit: false, body: PASSWORD_BODY });
  route('POST', '/api/tools/auth/campus', 'me', ({ user, body }) => switchCampus(user, body), { audit: false });
  ctx.toolsFor = toolsFor;
  const pdfStudio = registerPdfStudio(route, db, { record: (e) => audit.record(e), clock });

  // ----- School networks (Sign-in and passwords): where to find a campus's addresses -----
  // This browser's address as ATLAS sees it, and the addresses most people signed in from in the last
  // seven days (from the audit trail), each with whether a school network already covers it.
  // Only what could be saved is offered (not this computer's own address, for one).
  const listable = (network) => {
    try {
      return Boolean(network && parseNetwork(network));
    } catch {
      return false;
    }
  };
  route('GET', '/api/admin/school-networks', 'admin:settings.edit', ({ ip }) => {
    const since = new Date(clock().getTime() - 7 * 86400000).toISOString();
    const byNet = new Map();
    for (const e of [...audit.entries(), ...(db.data.auditDemo || [])]) { // the demo school's sample trail too
      if (e.kind !== 'signin' || e.outcome !== 'ok' || !e.ip || e.at < since) continue;
      const n = networkOf(e.ip);
      if (!n) continue;
      const x = byNet.get(n) || { network: n, sample: e.ip, signIns: 0, people: new Set() };
      x.signIns += 1;
      if (e.actorId) x.people.add(e.actorId);
      byNet.set(n, x);
    }
    const busiest = [...byNet.values()].filter((x) => listable(x.network) || atSchool(x.sample)).sort((a, b) => b.people.size - a.people.size || b.signIns - a.signIns).slice(0, 8)
      .map((x) => ({ network: x.network, signIns: x.signIns, people: x.people.size, covered: atSchool(x.sample), canAdd: listable(x.network) }));
    return { yourAddress: ip, yourNetwork: networkOf(ip), yourAddressCovered: atSchool(ip), yourNetworkCanAdd: listable(networkOf(ip)), busiest, factor: Number(security().schoolNetworkFactor) || 20 };
  }, { audit: false });

  // ----- Your own account: profile, picture, sessions, quick access (server/account.js) -----
  twoFactor.registerRoutes(route); // My security: 2-step verification (/api/me/2fa…)
  registerAccountRoutes(route, { db, sides, avatars, record: (e) => audit.record(e), systemsFor: (u) => portalSystems(u, ROLES[u.role]?.side).filter((x) => x.status === 'live' && x.url).map((x) => ({ id: x.id, name: x.name, url: x.url, tagline: x.tagline || x.description || '' })) });
  // ----- Notifications: the bell in every system's top bar (server/notifications.js) -----
  registerNotificationRoutes(route, { db, clock });
  // ----- System → Security monitor (administrators), and its metrics export -----
  registerMonitorRoutes(route, { db, monitor, audit, record: (e) => audit.record(e), sec: security, rateLimits: rateLimits !== 'off', routes, sessions: openSessions, version: APP_VERSION });

  // Call a route as a user, inside the server (demo data is made through the same rules as real work).
  ctx.invoke = (user, method, path, body = {}) => {
    const url = new URL(`http://localhost${path}`);
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const permission = r.access.includes(':') ? r.access.split(':')[1] : null;
      if (permission && !userCan(user, permission)) throw new HttpError(403, `${user.name} cannot ${method} ${path}`);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, campusId: activeCampusId(db.data, user), tokens: {}, cookies: {}, origin: '' });
    }
    throw new HttpError(404, `No route for ${method} ${path}`);
  };

  // ----- Request handling -----
  const MODULE_NAMES = Object.fromEntries(MODULES.map((m) => [m.id, m.label]));

  // ----- Where a request comes from -----
  // The proxy in front of ATLAS (Caddy) runs on this computer: only it may say, in X-Forwarded-Host
  // and X-Forwarded-Proto, which address the visitor used, and only an address ATLAS answers to.
  const ALLOWED = String(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const fromLocalProxy = (req) => ['127.0.0.1', '::1'].includes(String(req.socket?.remoteAddress || '').replace(/^::ffff:/, ''));
  const hostAllowed = (h) => {
    const name = String(h || '').trim().toLowerCase().replace(/:\d+$/, '');
    return name === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.startsWith('[') || ALLOWED.includes(name);
  };
  const forwardedHost = (req) => (fromLocalProxy(req) ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '');
  // This app's own address as the browser sees it, for the Keycloak redirects: PUBLIC_URL when set.
  function originOf(req) {
    const pub = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
    if (pub) return pub;
    const fwd = forwardedHost(req);
    const host = fwd && hostAllowed(fwd) ? fwd : hostAllowed(req.headers.host) ? String(req.headers.host) : 'localhost';
    const proto = fromLocalProxy(req) ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() : '';
    return `${['http', 'https'].includes(proto) ? proto : req.socket?.encrypted ? 'https' : 'http'}://${host}`;
  }
  // A change asked for by a page on another website (cross-site request forgery). Browsers say
  // where a request comes from in Sec-Fetch-Site (or, older ones, in Origin); a request with
  // neither did not come from a web page (a script or app), and SameSite cookies and JSON-only
  // bodies already guard it.
  const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  function crossSite(req) {
    if (!UNSAFE.has(req.method)) return false;
    const site = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
    if (site) return site !== 'same-origin' && site !== 'none';
    const o = req.headers.origin;
    if (o == null || o === '') return false;
    let from;
    try {
      from = new URL(o).host.toLowerCase();
    } catch {
      return true; // "null" (a sandboxed page or a file) or nonsense
    }
    return from !== String(req.headers.host || '').toLowerCase() && from !== forwardedHost(req).toLowerCase();
  }

  // Requests whose rate-limit tally was already taken by prepare() (the web server calls it before
  // reading the body); handle() then does not count them again. A WeakSet so finished requests drop out.
  const counted = new WeakSet();
  handle.sealPasswords = sealPasswords;
  handle.audit = audit;
  handle.prepare = prepare;
  handle.monitor = monitor;
  handle.pdfStudio = pdfStudio;
  handle.documents = documents;
  handle.forms = forms;
  handle.recruitment = recruitment;
  handle.plantilla = plantilla;
  // Every route's method, address and access (tests check who can reach what).
  handle.routes = () => routes.map(({ method, pattern, access, applicants, guardians }) => ({ method, pattern, access, applicants, guardians }));
  return handle;
  // Who sent a request, from its session cookies (no body needed).
  function whoIs(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sso = new Set(); // accounts whose session here came through Keycloak
    const resolve = (side, token) => {
      const s = sides[side].get(token);
      // A job applicant's session ends when their account closes (server/recruitment.js).
      const u = s && users().find((x) => x.id === s.userId && x.status === 'active' && !applicantExpired(x, clock().getTime()));
      if (u && s.sso) sso.add(u.id);
      return u && ROLES[u.role]?.side === side ? u : null;
    };
    const portalToken = cookies[COOKIES.portal];
    const adminToken = cookies[COOKIES.admin];
    const hrisToken = cookies[COOKIES.hris];
    const portalUser = resolve('portal', portalToken);
    const adminUser = resolve('admin', adminToken);
    const hrisUser = resolve('hris', hrisToken);
    return { cookies, portalToken, adminToken, hrisToken, portalUser, adminUser, hrisUser, signedIn: portalUser || adminUser || hrisUser, sso };
  }
  // Called by the web server before it reads a request's body: the request is counted against the
  // rate limits first (a flood is refused before any work is done), and the body may be large
  // (uploads) only for someone signed in. Signing in, applying and first-run setup are small.
  function prepare(req) {
    const { signedIn } = whoIs(req);
    if (signedIn) limits.hit('user', signedIn.id);
    else limits.hit(byAddress('address', clientIp(req)), clientIp(req));
    counted.add(req);
    const p = String(req.url || '').split('?')[0];
    // ATLAS Documents: files come in pieces of 4 MB (about 5.4 MB as base64), also from someone
    // outside the school through an upload link (whose own limits count them); nothing else of
    // Documents, or from outside, may be larger than that.
    // Signed out, only through a link that takes uploads now: a made-up token gets the small limit, so
    // a large body is never read and parsed for nobody.
    const piece = req.method === 'PUT' ? /^\/api\/public\/share\/([^/]+)\/uploads\/[^/]+$/.exec(p) : null;
    if (piece) return { maxBody: (() => { try { return documents.uploadLinkOpen(decodeURIComponent(piece[1])); } catch { return false; } })() ? MAX_DOCS_BODY : MAX_BODY_SIGNED_OUT };
    if (!signedIn) return { maxBody: MAX_BODY_SIGNED_OUT };
    // People's recruitment: a piece of an applicant's document (1 MB, as base64), for someone signed in.
    // A job applicant (someone outside the school) sends nothing else larger than the signed-out limit.
    if (req.method === 'PUT' && ATTACH_PIECE.test(p)) return { maxBody: MAX_ATTACH_PIECE_BODY };
    if (signedIn.role === 'applicant') return { maxBody: MAX_BODY_APPLICANT };
    if (p.startsWith('/api/docs/')) return { maxBody: MAX_DOCS_BODY };
    // PDF Studio: a file of up to DIRECT_UPLOAD_BYTES as base64 in one request, an export with up to
    // 30 MB of page edits (pictures, signatures); pieces of larger files fit the usual limit.
    if (req.method === 'POST' && (p === '/api/tools/pdf/sources' || p === '/api/tools/pdf/verify')) return { maxBody: Math.ceil(DIRECT_UPLOAD_BYTES / 3) * 4 + 1024 * 1024 };
    if (req.method === 'POST' && p === '/api/tools/pdf/export') return { maxBody: 30 * 1024 * 1024 };
    if (req.method === 'PUT' && /^\/api\/tools\/pdf\/uploads\/[^/]+$/.test(p)) return { maxBody: Math.ceil(PDF_LIMITS.chunkBytes / 3) * 4 + 64 * 1024 };
    return { maxBody: MAX_BODY_SIGNED_IN };
  }

  async function handle(req, url, body) {
    const who = whoIs(req);
    return requestScope.run({ sso: who.sso }, () => answer(req, url, body, who));
  }
  async function answer(req, url, body, { cookies, portalToken, adminToken, hrisToken, portalUser, adminUser, hrisUser, signedIn }) {
    const tokens = { portal: portalToken, admin: adminToken, hris: hrisToken };
    // An account that must change its password or set up 2-step verification before anything else.
    const held = (u) => Boolean(u && (u.mustChangePassword || twoFactor.mustSetUp(u)));
    const signedInAs = (u) => (held(u) ? null : u);
    const ip = clientIp(req);
    const agent = String(req.headers['user-agent'] || '').slice(0, 160);
    if (!counted.has(req)) {
      if (signedIn) limits.hit('user', signedIn.id);
      else limits.hit(byAddress('address', ip), ip);
    }
    const origin = originOf(req);
    // For the Security monitor: the route that answers (its template, never the address with ids)
    // and who asked, known before any check so a refusal is counted under its route.
    req.atlasRoute = routes.find((x) => x.method === req.method && x.re.test(url.pathname))?.pattern || null;
    req.atlasUser = signedIn?.id || null;
    const signal = (name, run) => {
      try {
        return run();
      } catch (err) {
        throw Object.assign(err, { signal: name });
      }
    };
    signal('cross-site', () => crossSite(req) && fail('This change was asked for by another website, so ATLAS refused it. Open ATLAS itself and try again.', 403));
    // Every body: an object of sane size and depth, without keys that reach a prototype (server/validate.js).
    if (UNSAFE.has(req.method)) body = signal('bad-json', () => checkStructure(body));

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      let user = null;
      let token = null;
      const lastFin = db.data.finAudit.at(-1)?.id;
      const lastAcademic = db.data.auditLog.at(-1)?.id;
      try {
        if (r.access.startsWith('tool:')) {
          // An ATLAS tool: anyone signed in whose account type it is switched on for.
          [user, token] = portalUser ? [portalUser, portalToken] : adminUser ? [adminUser, adminToken] : [hrisUser, hrisToken];
          if (!user) fail('Please sign in.', 401);
          const id = r.access.split(':')[1];
          if (user.role === 'applicant' || !toolOpenFor(db.data.settings, id, user.role)) fail(`${TOOLS.find((x) => x.id === id)?.product || 'This tool'} is not switched on for your account type. Ask an administrator.`, 403);
        } else if (r.access === 'me') {
          // Your own account, from whichever system you are signed in to.
          [user, token] = portalUser ? [portalUser, portalToken] : adminUser ? [adminUser, adminToken] : [hrisUser, hrisToken];
          if (!user) fail('Please sign in.', 401);
        } else if (r.access === 'hris' || r.access.startsWith('hris:')) {
          // Whoever is signed in on this browser: an HR/staff account, else an admin-panel or portal account.
          [user, token] = hrisUser ? [hrisUser, hrisToken] : adminUser ? [adminUser, adminToken] : [portalUser, portalToken];
          if (!user) fail('Please sign in.', 401);
          if (user.role === 'student' || user.role === 'guardian') fail('People is for school employees.', 403);
          if (user.role === 'applicant' && !r.applicants) fail('Job applicants see only Job openings and their applications.', 403);
          const permission = r.access.split(':')[1];
          if (permission && !userCan(user, permission)) fail('Your account does not have access to this.', 403);
        } else if (r.access === 'academic' || r.access.startsWith('academic:')) {
          user = adminUser || portalUser;
          token = adminUser ? adminToken : portalToken;
          if (!user) fail('Please sign in.', 401);
          if (!ACADEMIC_ROLES.includes(user.role)) fail('Academic is for students, teachers and the registrar\'s office.', 403);
          const permission = r.access.split(':')[1];
          if (permission && !userCan(user, permission)) fail('Your account does not have access to this.', 403);
        } else if (r.access === 'finance' || r.access.startsWith('finance:')) {
          [user, token] = hrisUser ? [hrisUser, hrisToken] : adminUser ? [adminUser, adminToken] : [portalUser, portalToken];
          if (!user) fail('Please sign in.', 401);
          if (user.role === 'guardian' || user.role === 'applicant') fail('Finance is for the school\'s employees and students.', 403);
          const permission = r.access.split(':')[1];
          if (permission && !userCan(user, permission)) fail('Your account does not have access to this.', 403);
        } else if (r.access === 'documents' || r.access.startsWith('documents:')) {
          // ATLAS Documents (server/documents.js): every employee and student; not parents.
          [user, token] = hrisUser ? [hrisUser, hrisToken] : adminUser ? [adminUser, adminToken] : [portalUser, portalToken];
          if (!user) fail('Please sign in.', 401);
          if (user.role === 'guardian' || user.role === 'applicant') fail(`${productName(db.data.settings.branding, 'Documents')} is for the school's employees and students.`, 403);
          const permission = r.access.split(':')[1];
          if (permission && !userCan(user, permission)) fail('Your account does not have access to this.', 403);
        } else if (r.access.startsWith('admin')) {
          user = adminUser;
          token = adminToken;
          if (!user) fail('Please sign in to the admin panel.', 401);
          const permission = r.access.split(':')[1];
          if (permission && !userCan(user, permission)) fail('Your account does not have access to this.', 403);
        } else if (r.access !== 'public') {
          user = portalUser;
          token = portalToken;
          if (!user) fail('Please sign in.', 401);
          if (['teacher', 'student', 'guardian'].includes(r.access) && user.role !== r.access) fail(r.access === 'guardian' ? 'Only parents and guardians can do this.' : `Only ${r.access}s can do this.`, 403);
          // Parents & guardians see the school through their linked students only.
          if (user.role === 'guardian' && r.access === 'portal' && !r.guardians) fail('This part of Learn is for students and teachers.', 403);
          if (r.module && !moduleOn(db.data.modules, r.module, user.role)) fail(`${MODULE_NAMES[r.module]} is switched off for ${user.role}s.`, 403);
        }
        if (user?.mustChangePassword && !r.duringPasswordChange) fail('Please change your password first.', 403);
        // The school requires 2-step verification of this account and it is not on yet: only setting it up (and signing out).
        if (!r.duringPasswordChange && twoFactor.mustSetUp(user)) fail('Set up 2-step verification first (My security).', 403);
        // The open routes (news, guides, …) see such an account as signed out, apart from those marked
        // duringPasswordChange: the status each page starts from, and signing out.
        const seen = r.access === 'public' && !r.duringPasswordChange ? signedInAs : (x) => x;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        if (r.limit) {
          if (r.limit === 'password') limits.hit('password', user.id);
          else if (r.limitBy) limits.hit(r.limit, String(r.limitBy({ params, ip })).slice(0, 200));
          else limits.hit(byAddress(r.limit, ip), ip);
        }
        const campusId = user ? activeCampusId(db.data, user) : null;
        // A Finance change is all or nothing: if any check fails partway, the books are put back as they were.
        const finSnap = req.method !== 'GET' && url.pathname.startsWith('/api/finance/') ? Object.fromEntries(Object.keys(db.data).filter((k) => k.startsWith('fin')).map((k) => [k, structuredClone(db.data[k])])) : null;
        // A settings screen's save is recorded in the Settings center's history (server/config.js).
        const recordSettings = ctx.settingsWatch?.(req.method, url.pathname);
        let result;
        try {
          // A route that declares its body gets only those fields, checked (server/validate.js).
          const accepted = r.body ? checkBody(body, r.body) : body;
          result = await r.handler({ params, body: accepted, query: Object.fromEntries(url.searchParams), user, token, portalUser: seen(portalUser), adminUser: seen(adminUser), hrisUser: seen(hrisUser), portalToken, adminToken, tokens, campusId, origin, cookies, ip, agent, headers: req.headers || {} });
        } catch (err) {
          if (finSnap) Object.assign(db.data, finSnap);
          throw err;
        }
        const settingsEntries = recordSettings?.(user);
        // Every change by staff goes in the audit trail, unless the system's own log has it already
        // (Settings history, Finance's audit, Academic's log: the trail shows those too).
        if (req.method !== 'GET' && r.audit && isStaff(user) && !settingsEntries?.length && db.data.finAudit.at(-1)?.id === lastFin && db.data.auditLog.at(-1)?.id === lastAcademic) {
          // About whom or what: an account named in the address, else what was just made, else the record's id.
          const about = Object.values(params).map((v) => users().find((u) => u.id === v)).find(Boolean);
          const made = !about && req.method === 'POST' && result && typeof result === 'object' && typeof result.id === 'string' ? result : null;
          const target = about || (made ? { id: made.id, name: made.name || made.title || made.code || '' } : Object.values(params)[0] ? { id: Object.values(params)[0], name: '' } : null);
          audit.record({ kind: 'change', system: systemOf(url.pathname), action: describeRoute(req.method, r.pattern), actor: user, target, ip, agent, detail: `${req.method} ${url.pathname}`.slice(0, 200) });
        }
        if (result?.raw != null) return result; // a file, a page or a redirect
        return result && result.headers && 'data' in result ? result : { data: result, headers: {} };
      } catch (err) {
        // Refused: someone signed in asked for something their account may not do.
        if (err instanceof HttpError && err.status === 403 && (user || signedIn) && !((user?.mustChangePassword || twoFactor.mustSetUp(user)) && !r.duringPasswordChange)) {
          audit.record({ kind: 'refused', system: systemOf(url.pathname), action: `Refused: ${describeRoute(req.method, r.pattern)}`, actor: user || signedIn, ip, agent, outcome: 'refused', detail: `${req.method} ${url.pathname.slice(0, 160)} · ${err.message}`.slice(0, 400) });
        }
        throw err;
      }
    }
    fail('Not found.', 404);
  };
}
