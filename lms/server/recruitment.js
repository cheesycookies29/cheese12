// Recruitment in ATLAS People: a minimal slice for the HRIS requests PL-003 and PL-004.
//
//  - HR posts job openings (People → Recruitment → Job openings, permission hris.recruitment) and
//    follows the applications to each, with a simple status the applicant sees.
//  - People outside the school sign up from Job openings on the ATLAS home page, with basic
//    information only (PL-028). That makes a temporary **applicant** account (shared/roles.js), which
//    reaches only the jobs area of People. It closes settings.people.applicantAccountDays after
//    sign-up (365 by default), with a bell notice applicantWarnDays before; once closed it cannot sign
//    in, and a daily sweep removes it and the personal details in its applications
//    applicantPurgeDays later (0: when HR removes it). HR can extend an account.
//  - Employees apply with their own account from People self-service (PL-004, the owner's decision:
//    no second account). The application is Internal and linked to their employee record.
//
// Out of scope for now: ratings (EETE), the applicant pool, the PDS, attachments, appointment papers.
// Patterns: Academic's "Apply for admission" (sign-up, rate limit, validation), leave requests (the
// bell), Documents' sweep (a timer that is unref'd, so tests and shutdown are not held up).
import { randomUUID } from 'node:crypto';
import { HttpError, text, localDate } from './util.js';
import { hashPasswordAsync, validatePassword } from './auth.js';
import { validateUserFields } from './admin.js';
import { campusesFor, campusName } from './campus.js';
import { decidersFor, EMPLOYEE_ROLES, fmtDay, forgetUser } from './notifications.js';
import { t } from './validate.js';
import { salaryFor } from '../shared/gov-pay.js';
import { brandName } from '../shared/brand.js';
import {
  AUDIENCES, OPENING_STATUSES, HR_STATUSES, DECIDED, DEFAULT_PEOPLE_SETTINGS, PEOPLE_SETTING_LIMITS, DAY_MS,
  applicantExpired, openingAccepts, applicationStatusLabel,
} from '../shared/recruitment.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[0-9+()\-\s]{7,40}$/;
const OPENING_FIELDS = ['title', 'plantillaItem', 'salaryGrade', 'office', 'education', 'training', 'experience', 'eligibility', 'vacancies', 'description', 'closingDate', 'audience', 'status'];
const SETTING_LABELS = { applicantAccountDays: 'Applicant accounts last', applicantWarnDays: 'Warn applicants before closing', applicantPurgeDays: 'Remove closed applicant accounts after' };
const REMOVED = 'Removed applicant';

export const OPENING_BODY = {
  title: t.str(400), plantillaItem: t.str(200), plantillaItemId: t.str(100), salaryGrade: t.any(), campusId: t.str(100), office: t.str(400),
  education: t.str(2000), training: t.str(2000), experience: t.str(2000), eligibility: t.str(2000),
  vacancies: t.any(), description: t.str(8000), closingDate: t.str(20), audience: t.str(20), status: t.str(20),
};

export function registerRecruitmentRoutes(route, ctx) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const nowMs = () => ctx.now().getTime();
  const iso = (ms = nowMs()) => new Date(ms).toISOString();
  const today = () => ctx.today();
  const people = () => ({ ...DEFAULT_PEOPLE_SETTINGS, ...(data().settings.people || {}) });
  const openings = () => (data().jobOpenings ||= []);
  const applications = () => (data().jobApplications ||= []);
  const userById = (id) => (id ? data().users.find((u) => u.id === id) : null);
  const employeeById = (id) => (id ? data().employees.find((e) => e.id === id) : null);
  const salaryOf = (o) => (o.salaryGrade ? salaryFor(o.salaryGrade, 1, today()) : null);
  // The date an account closes, as the screens and the bell show it.
  const closesOn = (u) => fmtDay(localDate(new Date(u.expiresAt)));

  // ----- Who is looking: a job applicant, or an employee with an active record -----
  function seeker(user) {
    if (user.role === 'applicant') return { external: true, emp: null };
    const emp = employeeById(user.employeeId);
    if (!emp || emp.status !== 'Active') fail('Job openings are for employees with an active employee record, and for job applicants. Ask HR to link your account to your employee record.', 403);
    return { external: false, emp };
  }
  // External applicants never see Internal-only openings; nobody sees drafts, closed ones or ones past
  // their closing date (an opening someone applied to stays readable to them in My applications).
  const visibleTo = (me, o) => openingAccepts(o, today()) && (o.audience === 'all' || !me.external);
  const publicOpenings = () => openings().filter((o) => openingAccepts(o, today()) && o.audience === 'all');

  // What an applicant (or anyone, signed out) reads about an opening: never who else applied.
  const openingPublic = (o) => ({
    id: o.id, title: o.title, plantillaItem: o.plantillaItem, salaryGrade: o.salaryGrade, monthlySalary: salaryOf(o),
    campusName: campusName(data(), o.campusId), office: o.office,
    education: o.education, training: o.training, experience: o.experience, eligibility: o.eligibility,
    vacancies: o.vacancies, description: o.description, closingDate: o.closingDate, audience: o.audience,
    accepting: openingAccepts(o, today()),
  });
  const mineOf = (user, o) => applications().find((a) => a.openingId === o.id && a.userId === user.id) || null;
  const canWithdraw = (a, o) => a.status !== 'withdrawn' && !DECIDED.includes(a.status) && Boolean(o) && o.status !== 'closed';
  const myView = (a) => {
    const o = openings().find((x) => x.id === a.openingId);
    return {
      id: a.id, openingId: a.openingId, title: o?.title || '(opening removed)', campusName: o ? campusName(data(), o.campusId) : '', office: o?.office || '',
      closingDate: o?.closingDate || null, openingStatus: o?.status || 'closed', internal: a.internal, note: a.note, status: a.status,
      statusNote: a.statusNote || '', createdAt: a.createdAt, updatedAt: a.updatedAt,
      canWithdraw: canWithdraw(a, o), canApplyAgain: a.status === 'withdrawn' && openingAccepts(o, today()),
    };
  };

  // ----- HR's view: only what HR needs to decide -----
  const hrCampusIds = (user) => new Set(campusesFor(data(), user).map((c) => c.id));
  const openingForHr = (user, id) => {
    const o = openings().find((x) => x.id === id);
    if (!o || !hrCampusIds(user).has(o.campusId)) fail('Job opening not found at your campuses.', 404);
    return o;
  };
  const countsOf = (o) => {
    const list = applications().filter((a) => a.openingId === o.id);
    const by = Object.fromEntries([...HR_STATUSES, 'withdrawn'].map((s) => [s, list.filter((a) => a.status === s).length]));
    return { total: list.length, active: list.length - by.withdrawn, internal: list.filter((a) => a.internal).length, external: list.filter((a) => !a.internal).length, byStatus: by };
  };
  // The plantilla item an opening was posted from (People → Plantilla → Post a job opening), if any.
  const itemOfOpening = (o) => {
    const i = o.plantillaItemId ? (data().plantillaItems || []).find((x) => x.id === o.plantillaItemId) : null;
    return i ? { id: i.id, itemNo: i.itemNo, positionTitle: i.positionTitle, status: i.status } : null;
  };
  const openingHr = (o) => ({ ...openingPublic(o), campusId: o.campusId, status: o.status, createdAt: o.createdAt, createdBy: o.createdBy, updatedAt: o.updatedAt || null, counts: countsOf(o), plantillaItemId: o.plantillaItemId || null, fromItem: itemOfOpening(o) });
  function nameOf(a) {
    if (a.removed) return REMOVED;
    const emp = a.internal ? employeeById(a.employeeId) : null;
    return emp ? `${emp.firstName} ${emp.lastName}` : userById(a.userId)?.name || REMOVED;
  }
  function applicationHr(a) {
    const u = a.removed ? null : userById(a.userId);
    const emp = a.internal ? employeeById(a.employeeId) : null;
    return {
      id: a.id, openingId: a.openingId, internal: a.internal, removed: Boolean(a.removed), name: nameOf(a),
      email: a.removed ? '' : u?.email || emp?.email || '', phone: a.removed ? '' : u?.phone || emp?.phone || '',
      // Internal: where the employee is now, from their record (PL-004).
      employee: emp ? { employeeNo: emp.employeeNo, position: emp.position || '', department: emp.department || '', salaryGrade: emp.salaryGrade || null, step: emp.step || null, campusName: campusName(data(), emp.campusId) } : null,
      accountClosed: Boolean(!a.internal && u && (u.status !== 'active' || applicantExpired(u, nowMs()))),
      note: a.note || '', status: a.status, statusNote: a.statusNote || '', createdAt: a.createdAt, updatedAt: a.updatedAt,
      history: (a.history || []).map((h) => ({ status: h.status, at: h.at, by: h.self ? 'Applicant' : h.by || '' })), // the applicant's own steps carry no name
    };
  }

  // ----- Telling people (the bell) -----
  const toHr = (o, entry, actorId) => ctx.notify(decidersFor(data(), 'hris.recruitment', { campusId: o.campusId, exclude: [actorId], roles: EMPLOYEE_ROLES }), { system: 'hris', link: `/hris/#/recruitment/${o.id}`, ...entry }, { actorId });

  // ----- Removing an applicant: the account goes; their applications stay as "removed applicant" -----
  function removeApplicant(u) {
    for (const a of applications().filter((x) => x.userId === u.id)) {
      a.userId = null;
      a.note = '';
      a.statusNote = '';
      a.removed = true;
      a.removedAt = iso();
      a.history = (a.history || []).map(({ status, at, by, self }) => ({ status, at, ...(self ? { self } : { by }) })); // HR's notes go
    }
    data().users = data().users.filter((x) => x.id !== u.id);
    forgetUser(data(), u.id);
    ctx.signOutEverywhere(u.id);
    ctx.tidyAvatars?.();
  }

  // ----- The daily sweep: the warning, closing, and removal after the purge days -----
  function sweep() {
    const now = nowMs();
    const s = people();
    let changed = false;
    for (const u of [...data().users]) {
      if (u.role !== 'applicant' || !u.expiresAt) continue;
      const ends = Date.parse(u.expiresAt);
      if (u.status === 'active' && ends > now && !u.expiryWarnedAt && ends - s.applicantWarnDays * DAY_MS <= now) {
        u.expiryWarnedAt = iso(now);
        ctx.notify([u.id], {
          system: 'hris', kind: 'applicant.expiring', title: `Your applicant account closes on ${closesOn(u)}`,
          body: 'After that you cannot sign in, and your account and applications are removed. Apply for any openings you want before then.', link: '/hris/#/jobs/mine',
        });
        changed = true;
      }
      if (u.status === 'active' && ends <= now) {
        u.status = 'expired';
        u.closedAt = iso(now);
        ctx.signOutEverywhere(u.id);
        ctx.audit({ kind: 'account', system: 'people', action: 'Applicant account closed: its time ran out', target: u, detail: `Open until ${u.expiresAt}` });
        changed = true;
      }
      // A selected applicant's details may become a personnel record: never removed automatically,
      // only by an HR person (Applicant accounts → Remove).
      const selected = applications().some((a) => a.userId === u.id && a.status === 'selected');
      if (u.status !== 'active' && !selected && s.applicantPurgeDays > 0 && ends + s.applicantPurgeDays * DAY_MS <= now) {
        ctx.audit({ kind: 'account', system: 'people', action: `Applicant account removed ${s.applicantPurgeDays} days after it closed`, targetName: u.name, detail: 'Its applications are kept as "removed applicant", without personal details.' });
        removeApplicant(u);
        changed = true;
      }
    }
    if (changed) save();
    return changed;
  }
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref?.(); // four times a day: the warning and the close are never late by more than that

  // ----- Signed out: the openings, and signing up (ATLAS home → Job openings) -----
  route('GET', '/api/jobs/openings', 'public', () => ({
    openings: publicOpenings().sort((a, b) => a.closingDate.localeCompare(b.closingDate)).map(openingPublic),
    accountDays: people().applicantAccountDays,
    purgeDays: people().applicantPurgeDays,
    signUpOpen: publicOpenings().length > 0,
  }), { audit: false });

  // Basic information only (PL-028): name, email, username, password, and a mobile number if they
  // like. The same password rules, rate limit and checks as "Apply for admission".
  function emailInUse(email) {
    const other = data().users.find((u) => String(u.email || '').toLowerCase() === email);
    if (!other) return;
    const home = `${brandName(data().settings.branding)} home page`;
    if (other.role === 'applicant' && other.status === 'active' && !applicantExpired(other, nowMs())) fail(`You already have an applicant account with this email. Sign in with it on the ${home}.`, 409);
    if (other.role === 'applicant') fail('Your applicant account with this email has closed. Ask HR to extend it if you still want to apply.', 409);
    fail(`This email belongs to an account you already have. Sign in with it on the ${home} instead: employees apply from People → Job openings.`, 409);
  }
  function signUpFields(body) {
    if (!publicOpenings().length) fail('There are no job openings right now, so sign-up is closed.', 403);
    const fields = validateUserFields({ ...body, role: 'applicant' }, data());
    if (!fields.email) fail('Email is required so HR can contact you.');
    emailInUse(fields.email);
    const phone = text(body.phone, 40);
    if (phone && !PHONE_RE.test(phone)) fail('That mobile number does not look right.');
    if (body.consent !== true) fail('Tick the box to say you have read the privacy notice.');
    return { ...fields, phone };
  }
  route('POST', '/api/jobs/signup', 'public', async ({ body, ip, agent }) => {
    signUpFields(body); // the answers first, before the slow hash
    validatePassword(body.password, data().settings.security);
    const passwordHash = await hashPasswordAsync(body.password);
    const fields = signUpFields(body); // again: someone may have taken the username or email meanwhile
    const at = nowMs();
    const user = {
      id: randomUUID(), ...fields, status: 'active', mustChangePassword: false, passwordHash, campusIds: [],
      createdAt: iso(at), expiresAt: iso(at + people().applicantAccountDays * DAY_MS), consentAt: iso(at),
    };
    data().users.push(user);
    save();
    ctx.audit({ kind: 'account', system: 'people', action: 'Signed up as a job applicant', actor: user, target: user, ip, agent, detail: `Open until ${user.expiresAt}` });
    return { ok: true, username: user.username, expiresAt: user.expiresAt };
  }, {
    limit: 'apply', audit: false,
    body: { name: t.str(200), email: t.str(320), username: t.str(200), password: t.str(1000), phone: t.str(60), consent: t.bool() },
  });

  // ----- Job applicants and employees (People → Job openings, My applications) -----
  route('GET', '/api/hris/jobs', 'hris', ({ user }) => {
    const me = seeker(user);
    return {
      openings: openings().filter((o) => visibleTo(me, o)).sort((a, b) => a.closingDate.localeCompare(b.closingDate)).map((o) => {
        const mine = mineOf(user, o);
        return { ...openingPublic(o), mine: mine ? { id: mine.id, status: mine.status } : null };
      }),
      applicant: me.external ? { expiresAt: user.expiresAt } : null,
      internal: !me.external,
    };
  }, { applicants: true, audit: false });
  route('GET', '/api/hris/jobs/:id', 'hris', ({ user, params }) => {
    const me = seeker(user);
    const o = openings().find((x) => x.id === params.id);
    const mine = o ? mineOf(user, o) : null;
    if (!o || (!visibleTo(me, o) && !mine)) fail('Job opening not found.', 404);
    return { ...openingPublic(o), mine: mine ? myView(mine) : null, applicant: me.external ? { expiresAt: user.expiresAt } : null, internal: !me.external };
  }, { applicants: true, audit: false });
  route('POST', '/api/hris/jobs/:id/apply', 'hris', ({ user, params, body }) => {
    const me = seeker(user);
    const o = openings().find((x) => x.id === params.id);
    const prior = o ? mineOf(user, o) : null;
    if (!o || (!visibleTo(me, o) && !prior)) fail('Job opening not found.', 404);
    if (!openingAccepts(o, today())) fail('This opening no longer takes applications.');
    if (prior && prior.status !== 'withdrawn') fail('You have already applied for this opening. See My applications.', 409);
    const at = iso();
    const note = text(body.note, 2000);
    let a = prior;
    if (a) {
      // A withdrawn application, sent again before the closing date: it starts over as Received.
      Object.assign(a, { status: 'received', note, statusNote: '', updatedAt: at, internal: !me.external, employeeId: me.emp?.id || null });
      a.history.push({ status: 'received', at, self: true });
    } else {
      a = {
        id: randomUUID(), openingId: o.id, userId: user.id, internal: !me.external, employeeId: me.emp?.id || null,
        note, status: 'received', statusNote: '', createdAt: at, updatedAt: at, history: [{ status: 'received', at, self: true }],
      };
      applications().push(a);
    }
    toHr(o, { kind: 'job.applied', title: `New application for ${o.title}`, body: `${nameOf(a)} · ${a.internal ? 'Internal' : 'External'}${prior ? ' · sent again after withdrawing' : ''}` }, user.id);
    save();
    return myView(a);
  }, { applicants: true, audit: false, body: { note: t.str(4000) } });
  route('GET', '/api/hris/my-applications', 'hris', ({ user }) => {
    const me = seeker(user);
    return {
      applications: applications().filter((a) => a.userId === user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(myView),
      applicant: me.external ? { expiresAt: user.expiresAt, purgeDays: people().applicantPurgeDays } : null,
    };
  }, { applicants: true, audit: false });
  route('POST', '/api/hris/my-applications/:id/withdraw', 'hris', ({ user, params }) => {
    seeker(user);
    const a = applications().find((x) => x.id === params.id && x.userId === user.id) || fail('Application not found.', 404);
    const o = openings().find((x) => x.id === a.openingId);
    if (a.status === 'withdrawn') fail('This application is already withdrawn.');
    if (DECIDED.includes(a.status)) fail('HR has decided on this application, so it can no longer be withdrawn. Contact HR.');
    if (!o || o.status === 'closed') fail('This opening is closed, so the application can no longer be withdrawn. Contact HR.');
    const at = iso();
    a.status = 'withdrawn';
    a.updatedAt = at;
    a.history.push({ status: 'withdrawn', at, self: true });
    toHr(o, { kind: 'job.withdrawn', title: `${nameOf(a)} withdrew their application for ${o.title}` }, user.id);
    save();
    return myView(a);
  }, { applicants: true, audit: false });

  // ----- HR: openings -----
  function cleanOpening(input, user, campusId, existing = null) {
    const merged = { ...(existing || {}), ...Object.fromEntries(OPENING_FIELDS.filter((k) => k in input).map((k) => [k, input[k]])) };
    const o = {
      title: text(merged.title, 160),
      plantillaItem: text(merged.plantillaItem, 80),
      salaryGrade: merged.salaryGrade === '' || merged.salaryGrade == null ? null : Math.round(Number(merged.salaryGrade)),
      office: text(merged.office, 160),
      education: text(merged.education, 1000),
      training: text(merged.training, 1000),
      experience: text(merged.experience, 1000),
      eligibility: text(merged.eligibility, 1000),
      vacancies: merged.vacancies === '' || merged.vacancies == null ? 1 : Math.round(Number(merged.vacancies)),
      description: text(merged.description, 4000),
      closingDate: text(merged.closingDate, 10),
      audience: AUDIENCES.some(([k]) => k === merged.audience) ? merged.audience : 'all',
      status: OPENING_STATUSES.some(([k]) => k === merged.status) ? merged.status : 'draft',
    };
    if (!o.title) fail('Position title is required.');
    if (o.salaryGrade != null && !(o.salaryGrade >= 1 && o.salaryGrade <= 33)) fail('Salary grade must be 1 to 33.');
    if (!(o.vacancies >= 1 && o.vacancies <= 999)) fail('Number of vacancies must be 1 to 999.');
    if (!DATE_RE.test(o.closingDate)) fail('Closing date is required.');
    if (o.status === 'open') {
      if (!o.education && !o.training && !o.experience && !o.eligibility) fail('Fill in the qualification standards before opening it.');
      if (o.closingDate < today() && (!existing || existing.status !== 'open' || existing.closingDate !== o.closingDate)) fail('The closing date has passed: pick a later date to open it.');
    }
    // Place of assignment: the campus HR is looking at, or another of theirs.
    const wanted = text(input.campusId, 100) || existing?.campusId || campusId;
    if (!hrCampusIds(user).has(wanted)) fail('Place the opening at one of your own campuses.', 403);
    o.campusId = wanted;
    // The plantilla item it was posted from (PL-027): a vacant item at one of HR's campuses. The
    // opening keeps the item number it was published with. Selecting an applicant changes nothing
    // on the item: HR links the person to it when the appointment is made.
    o.plantillaItemId = existing?.plantillaItemId || null;
    if ('plantillaItemId' in input && String(input.plantillaItemId || '') !== String(o.plantillaItemId || '')) {
      const id = text(input.plantillaItemId, 100);
      if (!id) o.plantillaItemId = null;
      else {
        const item = (data().plantillaItems || []).find((i) => i.id === id && hrCampusIds(user).has(i.campusId)) || fail('Plantilla item not found at your campuses.', 404);
        if (item.status !== 'vacant') fail(`Plantilla item ${item.itemNo} is not vacant.`);
        o.plantillaItemId = item.id;
        if (!o.plantillaItem) o.plantillaItem = item.itemNo;
      }
    }
    return o;
  }
  route('GET', '/api/hris/recruitment/openings', 'hris:hris.recruitment', ({ campusId }) => openings()
    .filter((o) => o.campusId === campusId)
    .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : OPENING_STATUSES.findIndex(([k]) => k === b.status) - OPENING_STATUSES.findIndex(([k]) => k === a.status)))
    .map(openingHr));
  route('POST', '/api/hris/recruitment/openings', 'hris:hris.recruitment', ({ body, user, campusId }) => {
    const o = { id: randomUUID(), ...cleanOpening(body, user, campusId), createdAt: iso(), createdBy: user.name };
    openings().push(o);
    save();
    return openingHr(o);
  }, { body: OPENING_BODY });
  route('GET', '/api/hris/recruitment/openings/:id', 'hris:hris.recruitment', ({ params, user }) => {
    const o = openingForHr(user, params.id);
    const list = applications().filter((a) => a.openingId === o.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ...openingHr(o), applications: list.map(applicationHr) };
  });
  route('PUT', '/api/hris/recruitment/openings/:id', 'hris:hris.recruitment', ({ params, body, user, campusId }) => {
    const o = openingForHr(user, params.id);
    Object.assign(o, cleanOpening(body, user, campusId, o), { updatedAt: iso(), updatedBy: user.name });
    save();
    return openingHr(o);
  }, { body: OPENING_BODY });
  route('DELETE', '/api/hris/recruitment/openings/:id', 'hris:hris.recruitment', ({ params, user }) => {
    const o = openingForHr(user, params.id);
    if (applications().some((a) => a.openingId === o.id)) fail('This opening has applications: close it instead, so they are kept.');
    data().jobOpenings = openings().filter((x) => x.id !== o.id);
    save();
    return { ok: true };
  });

  // ----- HR: an application's status (to the bell, and the audit log) -----
  route('PUT', '/api/hris/recruitment/applications/:id', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const o = openingForHr(user, a.openingId);
    if (a.userId === user.id) fail('You cannot decide on your own application. Another HR person does.', 403);
    if (a.removed) fail('This applicant was removed. The application is kept only so the counts stay true.');
    if (a.status === 'withdrawn') fail('The applicant withdrew this application.');
    const status = String(body.status || '');
    if (!HR_STATUSES.includes(status)) fail('Pick a status.');
    const note = text(body.note, 500);
    if (status === a.status && !note) return applicationHr(a);
    const from = a.status;
    const at = iso();
    Object.assign(a, { status, statusNote: note, updatedAt: at });
    a.history.push({ status, at, by: user.name, ...(note ? { note } : {}) });
    const label = applicationStatusLabel(status);
    ctx.notify([a.userId], {
      system: 'hris', kind: 'job.status', title: status === from ? `HR added a note on your application for ${o.title}` : `Your application for ${o.title}: ${label}`,
      body: note ? `Note from HR: ${note}` : `HR changed its status to ${label}.`, link: '/hris/#/jobs/mine',
    }, { actorId: user.id });
    ctx.audit({
      kind: 'change', system: 'people', action: 'Changed a job application\'s status', actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent,
      detail: `PUT /api/hris/recruitment/applications/${a.id}`,
      changes: [{ field: 'Status', from: applicationStatusLabel(from), to: label }, ...(note ? [{ field: 'Note to the applicant', from: '', to: note }] : [])],
    });
    save();
    return applicationHr(a);
  }, { audit: false, body: { status: t.str(40), note: t.str(2000) } });

  // ----- HR: applicant accounts (extend, remove) -----
  const applicantOr404 = (id) => data().users.find((u) => u.id === id && u.role === 'applicant') || fail('Applicant account not found.', 404);
  const applicantView = (u) => {
    const s = people();
    const closed = u.status !== 'active' || applicantExpired(u, nowMs());
    return {
      id: u.id, name: u.name, email: u.email || '', phone: u.phone || '', createdAt: u.createdAt, expiresAt: u.expiresAt, lastLoginAt: u.lastLoginAt || null,
      status: closed ? 'closed' : 'open', disabled: u.status === 'disabled',
      removeAfter: closed && s.applicantPurgeDays > 0 ? iso(Date.parse(u.expiresAt) + s.applicantPurgeDays * DAY_MS) : null,
      applications: applications().filter((a) => a.userId === u.id).length,
      warned: Boolean(u.expiryWarnedAt),
    };
  };
  route('GET', '/api/hris/recruitment/applicants', 'hris:hris.recruitment', () => ({
    applicants: data().users.filter((u) => u.role === 'applicant').sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).map(applicantView),
    settings: people(),
  }), { audit: false });
  route('POST', '/api/hris/recruitment/applicants/:id/extend', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const u = applicantOr404(params.id);
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 1095) fail('Extend by 1 to 1095 days.');
    const from = u.expiresAt;
    u.expiresAt = iso(Math.max(Date.parse(u.expiresAt) || 0, nowMs()) + days * DAY_MS);
    delete u.expiryWarnedAt; // a new warning comes before the new date
    if (u.status === 'expired') {
      u.status = 'active';
      delete u.closedAt;
    }
    ctx.audit({ kind: 'account', system: 'people', action: 'Extended a job applicant\'s account', actor: user, target: u, ip, agent, changes: [{ field: 'Open until', from, to: u.expiresAt }], detail: `${days} day${days === 1 ? '' : 's'}` });
    ctx.notify([u.id], { system: 'hris', kind: 'applicant.extended', title: `Your applicant account is open until ${closesOn(u)}`, body: 'HR extended it.', link: '/hris/#/jobs/mine' }, { actorId: user.id });
    save();
    return applicantView(u);
  }, { audit: false, body: { days: t.num() } });
  route('DELETE', '/api/hris/recruitment/applicants/:id', 'hris:hris.recruitment', ({ params, user, ip, agent }) => {
    const u = applicantOr404(params.id);
    ctx.audit({ kind: 'account', system: 'people', action: 'Removed a job applicant\'s account', actor: user, targetName: u.name, ip, agent, detail: 'Its applications are kept as "removed applicant", without personal details.' });
    removeApplicant(u);
    save();
    return { ok: true };
  }, { audit: false });

  // ----- Settings (HR settings in People; Settings center → ATLAS People → Job applicants) -----
  route('GET', '/api/hris/recruitment/settings', 'hris:hris.settings', () => people(), { audit: false });
  route('PUT', '/api/hris/recruitment/settings', 'hris:hris.settings', ({ body }) => {
    const next = people();
    for (const [k, [min, max]] of Object.entries(PEOPLE_SETTING_LIMITS)) {
      if (!(k in body) || body[k] === undefined) continue;
      const n = Number(body[k]);
      if (body[k] === '' || body[k] === null || !Number.isInteger(n) || n < min || n > max) fail(`${SETTING_LABELS[k]}: ${min} to ${max} days.`);
      next[k] = n;
    }
    if (next.applicantWarnDays >= next.applicantAccountDays) fail('Warn applicants fewer days before closing than their accounts last.');
    data().settings.people = next;
    save();
    return next;
  }, { body: { applicantAccountDays: t.any(), applicantWarnDays: t.any(), applicantPurgeDays: t.any() } });

  return { sweep, publicCount: () => publicOpenings().length };
}

// ----- Demo data: three open openings at the main campus (one Internal only), the demo
// applicant (applicant.demo) with an application, and an internal application by a demo employee.
// Every record has demo: true and goes with the demo school.
export function removeRecruitmentDemo(data) {
  const demoUsers = new Set(data.users.filter((u) => u.demo).map((u) => u.id));
  const demoOpenings = new Set((data.jobOpenings || []).filter((o) => o.demo).map((o) => o.id));
  data.jobApplications = (data.jobApplications || []).filter((a) => !a.demo && !demoOpenings.has(a.openingId) && !demoUsers.has(a.userId));
  data.jobOpenings = (data.jobOpenings || []).filter((o) => !o.demo);
}
export function addRecruitmentDemo(data, today, { main, person, userByName, now = Date.parse(`${today}T09:00:00`) }) {
  data.jobOpenings ||= [];
  data.jobApplications ||= [];
  const plus = (days) => localDate(new Date(new Date(`${today}T00:00:00`).getTime() + days * DAY_MS));
  const at = (daysAgo) => new Date(now - daysAgo * DAY_MS).toISOString();
  // An opening whose item is in the demo plantilla register is linked to it (Post a job opening).
  const itemId = (no) => (data.plantillaItems || []).find((i) => i.itemNo === no && i.status === 'vacant')?.id || null;
  const opening = (o) => {
    const rec = { id: randomUUID(), demo: true, campusId: main.id, createdAt: at(12), createdBy: 'Josefina Dimaculangan', vacancies: 1, description: '', plantillaItemId: itemId(o.plantillaItem), ...o };
    data.jobOpenings.push(rec);
    return rec;
  };
  const instructor = opening({
    title: 'Instructor I', plantillaItem: 'DEMO-INST1-0412-2026', salaryGrade: 12, office: 'College of Computing', vacancies: 2,
    education: "Master's degree in Information Technology, Computer Science or a related field", training: 'None required', experience: 'None required', eligibility: 'None required (RA 1080 for a licensed profession, where it applies)',
    description: 'Teaches undergraduate programming and laboratory courses, advises students and takes part in extension work.', closingDate: plus(21), audience: 'all', status: 'open',
  });
  const officer = opening({
    title: 'Administrative Officer II', plantillaItem: 'DEMO-ADOF2-0107-2026', salaryGrade: 11, office: 'Human Resources', vacancies: 1,
    education: "Bachelor's degree relevant to the job", training: 'None required', experience: 'None required', eligibility: 'Career Service (Professional) or second-level eligibility',
    description: 'Open to the school\'s employees for promotion or transfer: keeps personnel records, prepares appointments and service records.', closingDate: plus(14), audience: 'internal', status: 'open',
  });
  opening({
    title: 'Laboratory Technician I', plantillaItem: 'DEMO-LABT1-0033-2026', salaryGrade: 6, office: 'College of Agriculture',
    education: 'Completion of two years of college studies', training: 'None required', experience: 'None required', eligibility: 'Career Service (Subprofessional) or first-level eligibility',
    closingDate: plus(30), audience: 'all', status: 'open', createdAt: at(2),
  });
  // The demo applicant: signed up ten days ago, so the account is open for 355 more days.
  const created = now - 10 * DAY_MS;
  const days = { ...DEFAULT_PEOPLE_SETTINGS, ...(data.settings?.people || {}) }.applicantAccountDays;
  const applicant = person('applicant', 'applicant.demo', 'Carla Mendiola', {
    email: 'carla.mendiola@example.com', campusIds: [], phone: '09171234567', createdAt: new Date(created).toISOString(), expiresAt: new Date(created + days * DAY_MS).toISOString(), consentAt: new Date(created).toISOString(),
  });
  const application = (rec) => {
    const a = { id: randomUUID(), demo: true, statusNote: '', ...rec };
    data.jobApplications.push(a);
    return a;
  };
  application({
    openingId: instructor.id, userId: applicant.id, internal: false, employeeId: null,
    note: 'I finished my master\'s in information technology this year and have taught programming part-time for two years.',
    status: 'review', statusNote: 'Please bring your transcript of records to the interview.', createdAt: at(9), updatedAt: at(3),
    history: [{ status: 'received', at: at(9), self: true }, { status: 'review', at: at(3), by: 'Josefina Dimaculangan' }],
  });
  // An employee applying for a promotion from self-service (PL-004): Internal, linked to their record.
  const staff = userByName('staff.demo');
  if (staff?.employeeId) {
    application({
      openingId: officer.id, userId: staff.id, internal: true, employeeId: staff.employeeId,
      note: 'I would like to be considered for this promotion. I have kept the library\'s personnel files for five years.',
      status: 'received', createdAt: at(4), updatedAt: at(4), history: [{ status: 'received', at: at(4), self: true }],
    });
  }
}
