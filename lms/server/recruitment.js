// Recruitment in ATLAS People: the HRIS requests PL-003, PL-004 and PL-015.
//
//  - HR posts job openings (People → Recruitment → Job openings, permission hris.recruitment) and
//    moves the applications to each through the school's recruitment stages (PL-015): any later
//    stage, back one stage with a reason, or a final outcome; one at a time or several at once. Each
//    move is kept in the application's history (who, when, a note to the applicant, an internal
//    remark), goes to the applicant's bell with a link to their tracker, and to the audit log.
//  - The stages are a lookup list with fixed meanings (shared/recruitment.js, HR settings →
//    Recruitment stages): in-progress stages HR adds, renames, reorders and retires (never deletes
//    once used), and final outcomes whose meaning never changes (Selected, Not selected, Withdrawn).
//  - The applicant sees a tracker of the stages (done, current, to come, with dates), what happens at
//    the current one, the notes HR wrote to them and the outcome; never HR's internal remarks or who
//    in HR moved it ("HR office").
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
// Stage changes are not tied to dates or deadlines (no time limits per stage).
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
  AUDIENCES, OPENING_STATUSES, DECIDED, IN_PROGRESS, MEANINGS, DEFAULT_PEOPLE_SETTINGS, PEOPLE_SETTING_LIMITS, DAY_MS, STAGE_LIMITS,
  OUTCOME_MEANING, OPTIONAL_OUTCOMES, DEFAULT_RECRUITMENT_STAGES,
  applicantExpired, openingAccepts, mergeRecruitmentStages, legacyStage, stageInfo, stageLabel, firstStage, previousStage, trackerOf, meaningLabel,
} from '../shared/recruitment.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[0-9+()\-\s]{7,40}$/;
const OPENING_FIELDS = ['title', 'plantillaItem', 'salaryGrade', 'office', 'education', 'training', 'experience', 'eligibility', 'vacancies', 'description', 'closingDate', 'audience', 'status'];
const SETTING_LABELS = { applicantAccountDays: 'Applicant accounts last', applicantWarnDays: 'Warn applicants before closing', applicantPurgeDays: 'Remove closed applicant accounts after' };
const REMOVED = 'Removed applicant';
const HR_OFFICE = 'HR office'; // who the applicant is told moved their application: never the HR person's name
const STAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_BULK = 500;

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

  // ----- The stages (settings.recruitmentStages; shared/recruitment.js) -----
  const stages = () => data().settings.recruitmentStages || mergeRecruitmentStages();
  // Every stage or outcome an application is at, or has been at.
  const usedStages = () => {
    const used = new Map();
    for (const a of applications()) {
      for (const id of new Set([a.stage, ...(a.history || []).map((h) => h.stage)])) used.set(id, (used.get(id) || 0) + 1);
    }
    return used;
  };

  // What an applicant reads about their own application: the tracker, the notes addressed to them,
  // and the outcome. Built field by field, so HR's internal remarks, the reasons for moving back and
  // who in HR made each change never reach it.
  const notesOf = (a) => (a.history || []).filter((h) => h.note).map((h) => ({ at: h.at, stage: stageLabel(stages(), h.stage), note: h.note, from: HR_OFFICE }));
  const myView = (a) => {
    const o = openings().find((x) => x.id === a.openingId);
    const cfg = stages();
    const tracker = trackerOf(cfg, a);
    return {
      id: a.id, openingId: a.openingId, title: o?.title || '(opening removed)', campusName: o ? campusName(data(), o.campusId) : '', office: o?.office || '',
      closingDate: o?.closingDate || null, openingStatus: o?.status || 'closed', internal: a.internal, note: a.note,
      status: a.status, stage: a.stage, stageLabel: stageLabel(cfg, a.stage), stageSince: tracker.current.since,
      statusNote: a.statusNote || '', createdAt: a.createdAt, updatedAt: a.updatedAt,
      tracker, notes: notesOf(a),
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
  // Counts per meaning (in progress, selected, not selected, withdrawn) and per stage or outcome.
  const countsOf = (o) => {
    const list = applications().filter((a) => a.openingId === o.id);
    const by = Object.fromEntries(MEANINGS.map(([m]) => [m, list.filter((a) => a.status === m).length]));
    const byStage = {};
    for (const a of list) byStage[a.stage] = (byStage[a.stage] || 0) + 1;
    return { total: list.length, active: list.length - by.withdrawn, internal: list.filter((a) => a.internal).length, external: list.filter((a) => !a.internal).length, byStatus: by, byStage };
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
  // Where HR may move an application from where it is: any later stage, the outcomes, and (with a
  // reason) back one stage; a decided application only back to the stage it was at before.
  function movesOf(a) {
    const cfg = stages();
    const here = stageInfo(cfg, a.stage);
    if (a.removed || a.status === 'withdrawn') return { forward: [], outcomes: [], back: null };
    if (here.kind === 'outcome') return { forward: [], outcomes: [], back: stageBeforeDecision(a)?.id || null };
    return {
      forward: cfg.stages.filter((s, i) => !s.retired && i > here.index).map((s) => s.id),
      outcomes: cfg.outcomes.filter((x) => !x.retired && x.id !== 'withdrawn').map((x) => x.id),
      back: previousStage(cfg, a.stage)?.id || null,
    };
  }
  // The in-progress stage a decided application was at before the decision (not a retired one).
  function stageBeforeDecision(a) {
    const cfg = stages();
    for (const h of [...(a.history || [])].reverse()) {
      const s = stageInfo(cfg, h.stage);
      if (s.kind === 'stage' && !s.retired) return s;
    }
    return firstStage(cfg);
  }
  function applicationHr(a) {
    const u = a.removed ? null : userById(a.userId);
    const emp = a.internal ? employeeById(a.employeeId) : null;
    const cfg = stages();
    return {
      id: a.id, openingId: a.openingId, internal: a.internal, removed: Boolean(a.removed), name: nameOf(a),
      email: a.removed ? '' : u?.email || emp?.email || '', phone: a.removed ? '' : u?.phone || emp?.phone || '',
      // Internal: where the employee is now, from their record (PL-004).
      employee: emp ? { employeeNo: emp.employeeNo, position: emp.position || '', department: emp.department || '', salaryGrade: emp.salaryGrade || null, step: emp.step || null, campusName: campusName(data(), emp.campusId) } : null,
      accountClosed: Boolean(!a.internal && u && (u.status !== 'active' || applicantExpired(u, nowMs()))),
      note: a.note || '', status: a.status, stage: a.stage, stageLabel: stageLabel(cfg, a.stage), statusNote: a.statusNote || '', createdAt: a.createdAt, updatedAt: a.updatedAt,
      // Everything, for HR: the applicant's own steps carry no name; remarks and reasons are HR's own.
      history: (a.history || []).map((h) => ({
        stage: h.stage, stageLabel: stageLabel(cfg, h.stage), at: h.at, by: h.self ? 'Applicant' : h.migrated ? '' : h.by || '',
        note: h.note || '', remark: h.remark || '', reason: h.reason || '', back: Boolean(h.back), bulk: Boolean(h.bulk), migrated: Boolean(h.migrated),
      })),
      moves: movesOf(a),
      own: false,
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
      a.history = (a.history || []).map(({ stage, at, by, self, applied, back, migrated }) => ({ stage, at, ...(self ? { self } : { by }), ...(applied ? { applied } : {}), ...(back ? { back } : {}), ...(migrated ? { migrated } : {}) })); // notes, remarks and reasons go
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
        return { ...openingPublic(o), mine: mine ? { id: mine.id, status: mine.status, stage: mine.stage, stageLabel: stageLabel(stages(), mine.stage) } : null };
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
    const first = firstStage(stages()).id; // the first stage is assigned on applying
    if (a) {
      // A withdrawn application, sent again before the closing date: it starts over at the first stage.
      Object.assign(a, { stage: first, status: IN_PROGRESS, note, statusNote: '', updatedAt: at, internal: !me.external, employeeId: me.emp?.id || null });
      a.history.push({ stage: first, at, self: true, applied: true });
    } else {
      a = {
        id: randomUUID(), openingId: o.id, userId: user.id, internal: !me.external, employeeId: me.emp?.id || null,
        note, stage: first, status: IN_PROGRESS, statusNote: '', createdAt: at, updatedAt: at, history: [{ stage: first, at, self: true, applied: true }],
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
  // One application with its tracker (People → My applications → the application). Only the
  // applicant's own: any other is "not found".
  route('GET', '/api/hris/my-applications/:id', 'hris', ({ user, params }) => {
    const me = seeker(user);
    const a = applications().find((x) => x.id === params.id && x.userId === user.id) || fail('Application not found.', 404);
    return { ...myView(a), applicant: me.external ? { expiresAt: user.expiresAt } : null };
  }, { applicants: true, audit: false });
  route('POST', '/api/hris/my-applications/:id/withdraw', 'hris', ({ user, params }) => {
    seeker(user);
    const a = applications().find((x) => x.id === params.id && x.userId === user.id) || fail('Application not found.', 404);
    const o = openings().find((x) => x.id === a.openingId);
    if (a.status === 'withdrawn') fail('This application is already withdrawn.');
    if (DECIDED.includes(a.status)) fail('HR has decided on this application, so it can no longer be withdrawn. Contact HR.');
    if (!o || o.status === 'closed') fail('This opening is closed, so the application can no longer be withdrawn. Contact HR.');
    const at = iso();
    a.stage = 'withdrawn';
    a.status = 'withdrawn';
    a.updatedAt = at;
    a.history.push({ stage: 'withdrawn', at, self: true });
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
    return { ...openingHr(o), applications: list.map((a) => ({ ...applicationHr(a), own: a.userId === user.id })), stages: stagesView() };
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

  // ----- HR: moving applications through the stages (to the bell, the history and the audit log) -----
  // Whether `a` may go to `target`, and how: forward (any later stage), an outcome, back (one stage,
  // with a reason), or a note at the same stage. Throws the reason it may not.
  function planMove(user, a, target, { reason = '', bulk = false } = {}) {
    if (a.userId === user.id) fail('You cannot decide on your own application. Another HR person does.', 403);
    if (a.removed) fail('This applicant was removed. The application is kept only so the counts stay true.');
    if (a.status === 'withdrawn') fail('The applicant withdrew this application.');
    const cfg = stages();
    const to = stageInfo(cfg, target);
    const here = stageInfo(cfg, a.stage);
    if (to.kind === 'unknown') fail('Pick a stage or a final outcome.');
    if (to.id === 'withdrawn') fail('Only the applicant can withdraw an application.');
    if (to.id === here.id) return { kind: 'note', to, here };
    if (to.retired) fail(`${to.label} is retired: pick another stage.`);
    if (here.kind === 'outcome') {
      const before = stageBeforeDecision(a);
      if (to.kind === 'outcome') fail(`This application is already decided (${here.label}). Move it back to ${before.label} first.`);
      if (to.id !== before.id) fail(`A decided application can only go back to ${before.label}, the stage it was at before the decision.`);
      if (bulk) fail('Move applications back one at a time, each with its reason.');
      if (!reason) fail('Give the reason for moving it back. It is kept in the history and the audit log, not shown to the applicant.');
      return { kind: 'back', to, here };
    }
    if (to.kind === 'outcome') return { kind: 'outcome', to, here };
    if (to.index > here.index) return { kind: 'forward', to, here };
    const prev = previousStage(cfg, here.id);
    if (!prev || to.id !== prev.id) fail(`You can move an application back one stage at a time${prev ? `: to ${prev.label}` : ''}.`);
    if (bulk) fail('Move applications back one at a time, each with its reason.');
    if (!reason) fail('Give the reason for moving it back. It is kept in the history and the audit log, not shown to the applicant.');
    return { kind: 'back', to, here };
  }
  // Make a planned move: the history, the bell (linked to the applicant's tracker), the audit log.
  function doMove(user, a, o, plan, { note, remark, reason, bulk, ip, agent }) {
    const at = iso();
    const { to, here } = plan;
    if (plan.kind !== 'note') Object.assign(a, { stage: to.id, status: to.meaning });
    if (note) a.statusNote = note; // the latest note, for the list
    a.updatedAt = at;
    a.history.push({
      stage: to.id, at, by: user.name, byId: user.id,
      ...(note ? { note } : {}), ...(remark ? { remark } : {}), ...(plan.kind === 'back' ? { back: true, reason } : {}), ...(bulk ? { bulk: true } : {}),
    });
    if (plan.kind !== 'note' || note) {
      const moved = plan.kind === 'back' ? `HR moved it back to ${to.label}.` : to.kind === 'outcome' ? `The outcome: ${to.label}.` : `It is now at ${to.label}.`;
      ctx.notify([a.userId], {
        system: 'hris', kind: 'job.status', title: plan.kind === 'note' ? `HR added a note on your application for ${o.title}` : `Your application for ${o.title}: ${to.label}`,
        body: note ? `Note from HR: ${note}` : moved, link: `/hris/#/jobs/mine/${a.id}`,
      }); // no actor: the bell would show the HR person's name, and the applicant is told "HR office" only
    }
    ctx.audit({
      kind: 'change', system: 'people', action: plan.kind === 'note' ? 'Added a note to a job application' : plan.kind === 'back' ? 'Moved a job application back a stage' : 'Moved a job application to another stage',
      actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent,
      detail: bulk ? `Moved with ${bulk} applications at once` : `PUT /api/hris/recruitment/applications/${a.id}`,
      changes: [
        ...(plan.kind !== 'note' ? [{ field: 'Stage', from: here.label, to: to.label }] : []),
        ...(plan.kind === 'back' ? [{ field: 'Reason for moving back', from: '', to: reason }] : []),
        ...(note ? [{ field: 'Note to the applicant', from: '', to: note }] : []),
        ...(remark ? [{ field: 'Internal remark', from: '', to: remark }] : []),
      ],
    });
  }
  // `status` (the names before the stages: received, review, shortlisted, selected…) still works, mapped
  // as the migration maps them, for callers written before PL-015.
  const moveInput = (body) => ({ stage: String(body.stage || (body.status ? legacyStage(stages(), String(body.status)) : '')), note: text(body.note, 1000), remark: text(body.remark, 1000), reason: text(body.reason, 500) });

  route('PUT', '/api/hris/recruitment/applications/:id', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const o = openingForHr(user, a.openingId);
    const m = moveInput(body);
    const plan = planMove(user, a, m.stage, m);
    if (plan.kind === 'note' && !m.note && !m.remark) fail('Pick another stage, or write a note to the applicant or an internal remark.');
    doMove(user, a, o, plan, { ...m, ip, agent });
    save();
    return applicationHr(a);
  }, { audit: false, body: { stage: t.str(60), status: t.str(40), note: t.str(4000), remark: t.str(4000), reason: t.str(2000) } });

  // Several applications to one opening, to one stage or outcome, with one note: all of them or none
  // (if one cannot go, nothing moves and HR is told which and why). Never back: that needs a reason each.
  route('POST', '/api/hris/recruitment/openings/:id/move', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const o = openingForHr(user, params.id);
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))];
    if (!ids.length) fail('Tick the applications to move.');
    if (ids.length > MAX_BULK) fail(`Move at most ${MAX_BULK} applications at once.`);
    const m = moveInput(body);
    const plans = ids.map((id) => {
      const a = applications().find((x) => x.id === id && x.openingId === o.id);
      if (!a) return { error: 'Application not found in this opening.', id };
      try {
        const plan = planMove(user, a, m.stage, { bulk: true });
        if (plan.kind === 'note') return { error: `already at ${plan.to.label}`, a };
        return { a, plan };
      } catch (err) {
        if (err.status === 404) throw err;
        return { error: err.message, a };
      }
    });
    const bad = plans.filter((p) => p.error);
    if (bad.length) {
      const named = bad.slice(0, 5).map((p) => `${p.a ? nameOf(p.a) : 'An application'}: ${p.error.replace(/\.$/, '')}`).join('; ');
      fail(`Nothing was moved. ${named}${bad.length > 5 ? `; and ${bad.length - 5} more` : ''}.`);
    }
    for (const { a, plan } of plans) doMove(user, a, o, plan, { ...m, reason: '', bulk: plans.length, ip, agent });
    save();
    return { moved: plans.length, stage: stageLabel(stages(), m.stage) };
  }, { audit: false, body: { ids: t.arr(t.str(100), MAX_BULK + 1), stage: t.str(60), note: t.str(4000), remark: t.str(4000) } });

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
    ctx.notify([u.id], { system: 'hris', kind: 'applicant.extended', title: `Your applicant account is open until ${closesOn(u)}`, body: 'HR extended it.', link: '/hris/#/jobs/mine' }); // no actor: applicants never see HR's names
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

  // ----- Recruitment stages (HR settings → Recruitment stages; Settings center → ATLAS People) -----
  // Each with how many applications are at it now and have ever been at it (a used one is never deleted).
  function stagesView() {
    const cfg = stages();
    const used = usedStages();
    const now = new Map();
    for (const a of applications()) now.set(a.stage, (now.get(a.stage) || 0) + 1);
    const row = (x, extra) => ({ ...x, retired: Boolean(x.retired), used: used.get(x.id) || 0, current: now.get(x.id) || 0, ...extra });
    return {
      stages: cfg.stages.map((x) => row(x, { meaning: IN_PROGRESS })),
      outcomes: cfg.outcomes.map((x) => row(x, { meaning: OUTCOME_MEANING[x.id], meaningLabel: meaningLabel(OUTCOME_MEANING[x.id]), optional: OPTIONAL_OUTCOMES.includes(x.id), applicantOnly: x.id === 'withdrawn' })),
    };
  }
  // A stage's id: from its label, made unique ("Background check" → background-check).
  function newStageId(label, taken) {
    const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'stage';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }
  function cleanStages(body) {
    const cfg = stages();
    const used = usedStages();
    const input = Array.isArray(body.stages) ? body.stages : fail('Send the list of stages.');
    if (input.length > STAGE_LIMITS.stages) fail(`At most ${STAGE_LIMITS.stages} stages.`);
    const taken = new Set([...cfg.stages.map((x) => x.id), ...Object.keys(OUTCOME_MEANING)]);
    const seenIds = new Set();
    const labels = new Set();
    const checkText = (x, what) => {
      const label = text(x.label, 200);
      const description = text(x.description, 2000);
      if (!label) fail(`Every ${what} needs a label.`);
      if (label.length > STAGE_LIMITS.label) fail(`${label.slice(0, 30)}…: a label has at most ${STAGE_LIMITS.label} characters.`);
      if (description.length > STAGE_LIMITS.description) fail(`${label}: the description has at most ${STAGE_LIMITS.description} characters.`);
      if (labels.has(label.toLowerCase())) fail(`Two stages or outcomes are called ${label}: give each its own label.`);
      labels.add(label.toLowerCase());
      return { label, description };
    };
    const out = input.map((x) => {
      const t2 = checkText(x || {}, 'stage');
      let id = text(x.id, 60);
      if (id && (OUTCOME_MEANING[id] || !STAGE_ID_RE.test(id))) fail(`${t2.label}: that stage id cannot be used.`);
      if (!id) {
        id = newStageId(t2.label, taken);
        taken.add(id);
      }
      if (seenIds.has(id)) fail(`${t2.label} is in the list twice.`);
      seenIds.add(id);
      return { id, ...t2, ...(x.retired === true ? { retired: true } : {}) };
    });
    // A stage an application is at, or has been at, is never deleted: it can be retired.
    for (const old of cfg.stages) {
      if (!seenIds.has(old.id) && used.get(old.id)) fail(`${old.label} has been used by ${used.get(old.id)} application${used.get(old.id) === 1 ? '' : 's'}: retire it instead of removing it, so their history keeps its meaning.`);
    }
    if (!out.some((x) => !x.retired)) fail('Keep at least one stage that is not retired: new applications start at the first one.');
    // The final outcomes are fixed: the same ones, in the same order; only labels and descriptions change.
    const outcomes = Array.isArray(body.outcomes) ? body.outcomes : cfg.outcomes;
    const ids = outcomes.map((x) => x?.id);
    if (ids.length !== cfg.outcomes.length || cfg.outcomes.some((x) => !ids.includes(x.id))) fail('The final outcomes are fixed (Selected, Not qualified, Not selected, Withdrawn): only their labels and descriptions can change.');
    const fixed = cfg.outcomes.map((old) => {
      const x = outcomes.find((y) => y.id === old.id);
      const t2 = checkText(x, 'outcome');
      if (x.retired === true && !OPTIONAL_OUTCOMES.includes(old.id)) fail(`${t2.label} is a fixed outcome and cannot be retired.`);
      return { id: old.id, ...t2, ...(x.retired === true ? { retired: true } : {}) };
    });
    return { stages: out, outcomes: fixed };
  }
  route('GET', '/api/hris/recruitment/stages', 'hris:hris.settings', () => ({ ...stagesView(), defaults: DEFAULT_RECRUITMENT_STAGES }), { audit: false });
  route('PUT', '/api/hris/recruitment/stages', 'hris:hris.settings', ({ body }) => {
    data().settings.recruitmentStages = cleanStages(body);
    save();
    return stagesView();
  }, {
    body: {
      stages: t.arr(t.obj({ id: t.str(100), label: t.str(400), description: t.str(4000), retired: t.bool() }), 100),
      outcomes: t.arr(t.obj({ id: t.str(100), label: t.str(400), description: t.str(4000), retired: t.bool() }), 20),
    },
  });

  return { sweep, publicCount: () => publicOpenings().length };
}

// ----- Demo data: three open openings at the main campus (one Internal only), the demo
// applicant (applicant.demo) and five more job applicants with applications at every stage, HR's notes,
// and an internal application by a demo employee.
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
  const lab = opening({
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
  // Demo applications across the stages, with HR's notes to the applicants (and one internal remark,
  // which the applicant never sees). Each entry of a history: [stage, days ago, note, remark].
  const HR = 'Josefina Dimaculangan';
  const hrId = userByName('hr.demo')?.id || null;
  const application = (rec, steps) => {
    const history = steps.map(([stage, daysAgo, note, remark], i) => ({
      stage, at: at(daysAgo), ...(i === 0 ? { self: true, applied: true } : { by: HR, byId: hrId }), ...(note ? { note } : {}), ...(remark ? { remark } : {}),
    }));
    const last = history.at(-1);
    const a = {
      id: randomUUID(), demo: true, internal: false, employeeId: null, note: '', ...rec,
      stage: last.stage, status: OUTCOME_MEANING[last.stage] || IN_PROGRESS, statusNote: [...history].reverse().find((h) => h.note)?.note || '',
      createdAt: history[0].at, updatedAt: last.at, history,
    };
    data.jobApplications.push(a);
    return a;
  };
  // More demo job applicants (outsiders), each with their own temporary account.
  const outsider = (username, name, daysAgo) => {
    const made = now - daysAgo * DAY_MS;
    return person('applicant', username, name, {
      email: `${username.replace('.demo', '')}@example.com`, campusIds: [], createdAt: new Date(made).toISOString(), expiresAt: new Date(made + days * DAY_MS).toISOString(), consentAt: new Date(made).toISOString(),
    });
  };
  const fmt = (d) => fmtDay(plus(d));
  application({
    openingId: instructor.id, userId: applicant.id,
    note: 'I finished my master\'s in information technology this year and have taught programming part-time for two years.',
  }, [
    ['received', 9],
    ['screening', 6, 'Thank you for applying. Please send a scanned copy of your transcript of records to the HR office by email.'],
    ['assessment', 3, `You are invited to the written examination and interview on ${fmt(4)} at 9:00 at the HR office, Administration Building. Please bring a valid ID and your original transcript of records.`, 'Meets the education standard. Ask the college for a teaching demonstration slot.'],
  ]);
  application({ openingId: instructor.id, userId: outsider('dlumbres.demo', 'Diego Lumbres', 11).id, note: 'Licensed professional teacher with five years of teaching computer subjects in senior high school.' }, [
    ['received', 11], ['screening', 8], ['assessment', 5, `Your examination and interview are on ${fmt(-2)} at 9:00 at the HR office.`], ['deliberation', 1],
  ]);
  application({ openingId: instructor.id, userId: outsider('pquimbo.demo', 'Paolo Quimbo', 7).id, note: 'I am a software developer and would like to teach.' }, [
    ['received', 7], ['screening', 2, 'Please send a copy of your certificate of employment showing your work as a developer.'],
  ]);
  application({ openingId: instructor.id, userId: outsider('byap.demo', 'Bianca Yap', 8).id, note: 'I am finishing my master\'s thesis this semester.' }, [
    ['received', 8], ['screening', 5], ['not-qualified', 4, 'The position needs a completed master\'s degree. You are welcome to apply again once you have finished it.'],
  ]);
  application({ openingId: instructor.id, userId: outsider('hordonez.demo', 'Hazel Ordonez', 1).id, note: '' }, [['received', 1]]);
  application({ openingId: lab.id, userId: outsider('jbustamante.demo', 'Jun Bustamante', 2).id, note: 'Two years as a laboratory aide in a soils testing laboratory.' }, [['received', 2]]);
  // An employee applying for a promotion from self-service (PL-004): Internal, linked to their record.
  const staff = userByName('staff.demo');
  if (staff?.employeeId) {
    application({
      openingId: officer.id, userId: staff.id, internal: true, employeeId: staff.employeeId,
      note: 'I would like to be considered for this promotion. I have kept the library\'s personnel files for five years.',
    }, [['received', 4], ['screening', 2, 'Your service record is complete. We will tell you the date of the interview.']]);
  }
}
