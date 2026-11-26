// Rating applicants, the applicant profile and the pool of applicants in ATLAS People's recruitment:
// the HRIS requests PL-018, PL-019, PL-020, part of PL-021, and PL-066. Registered from
// server/recruitment.js, which hands over its helpers and calls the hooks this returns (a decision,
// a removal, the daily sweep, the opening form).
//
//  - Assessment templates (HR settings → Assessment templates; shared/recruitment-assess.js): position
//    categories, each with a default template; criteria with weights that total exactly 100 (PL-066).
//    An opening gets a category and a template in its form. The first rating at an opening freezes
//    the template: a copy of that version is kept on the opening (o.assessment), so later edits to
//    the template never change a past rating.
//  - Rating (PL-018, PL-021 in part): HR scores each criterion 0 to 100 with an optional comment; the
//    weighted total is Σ score × weight / 100 (never above 100). Who rated and when is kept, and every
//    rating goes to the audit log. One assessor per application: several assessors with averaging is
//    not in this build. The applicant never sees scores (a question for the school: some processes
//    publish comparative assessment results).
//  - The comparative list: an opening's rated applicants ranked by total, a column per criterion;
//    CSV and a printable A4 landscape page.
//  - The applicant profile (PL-019): one person's details, account dates, every application with its
//    stage, outcome, rating and history, and their pool status; printable, with internal remarks and
//    ratings left out unless HR asks for them.
//  - The pool of applicants (PL-020): only people who ticked the box themselves (at sign-up or under
//    My applications; never ticked for them, and HR cannot tick it). When an application of theirs
//    ends Not selected or Not qualified they enter it; HR can also add one by hand, with a reason.
//    They stay settings.people.applicantPoolMonths months (12; 1 to 36; never longer than they
//    agreed to); an applicant account is kept open that long. The daily sweep takes them out at the
//    end, and the usual closing and removal follow. HR searches the pool and invites someone to apply
//    for an open opening (a bell notice with a link); the person applies themselves.
import { randomUUID } from 'node:crypto';
import { text, localDate } from './util.js';
import { t } from './validate.js';
import { campusName } from './campus.js';
import { fmtDay } from './notifications.js';
import { userCan } from '../shared/roles.js';
import {
  applicantDetails, stageLabel, stageInfo, meaningLabel, openingAccepts, applicantExpired, EDUCATION_LEVELS, educationLabel, DAY_MS,
} from '../shared/recruitment.js';
import {
  mergeAssessment, weightProblem, weightedTotal, ranksOf, scoreProblem, ASSESSMENT_LIMITS, DEFAULT_ASSESSMENT,
  addMonths, poolMonthsFor,
} from '../shared/recruitment-assess.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EDUCATION_ORDER = EDUCATION_LEVELS.map(([k]) => k);

// What a pool entry keeps about a person: the qualifications they gave (highest educational
// attainment and preferred campus; an employee's position, salary grade and campus), the openings
// they applied to, and their best rating in each position category. Refreshed whenever something
// changes while they are in the pool.
export function poolSnapshot(data, u, stagesCfg) {
  const cats = mergeAssessment(data.settings?.assessment).categories;
  const catLabel = (id) => cats.find((c) => c.id === id)?.label || (id ? '(a category since removed)' : '');
  const p = applicantDetails(u, (id) => campusName(data, id)) || {};
  const emp = u.role === 'applicant' ? null : data.employees.find((e) => e.id === u.employeeId);
  const apps = (data.jobApplications || []).filter((a) => a.userId === u.id);
  const openingOf = (id) => (data.jobOpenings || []).find((x) => x.id === id);
  const best = {};
  for (const a of apps) {
    const o = openingOf(a.openingId);
    if (!a.rating || !o) continue;
    const cat = o.assessment?.categoryId || o.categoryId || '';
    const key = cat || 'none';
    if (!best[key] || a.rating.total > best[key].total) best[key] = { categoryId: cat, categoryLabel: o.assessment?.categoryLabel || catLabel(cat) || 'No category', total: a.rating.total, openingTitle: o.title, complete: a.rating.complete };
  }
  return {
    qualifications: {
      education: p.education || '', educationLabel: p.educationLabel || '', campusId: p.campusId || '', campusName: p.campusName || '',
      ...(emp ? { position: emp.position || '', salaryGrade: emp.salaryGrade || null, campusId: emp.campusId, campusName: campusName(data, emp.campusId) } : {}),
    },
    openings: apps.map((a) => {
      const o = openingOf(a.openingId);
      return { openingId: a.openingId, title: o?.title || '(opening removed)', categoryId: o?.categoryId || '', categoryLabel: catLabel(o?.categoryId), stageLabel: stageLabel(stagesCfg, a.stage), status: a.status, at: a.updatedAt };
    }),
    bestRatings: Object.values(best),
  };
}

export function registerAssessmentRoutes(route, ctx, h) {
  const { fail, data, save, iso, nowMs, today, people, openings, applications, userById, employeeById, openingForHr, nameOf, hrCampusIds } = h;
  const cfg = () => (data().settings.assessment ||= mergeAssessment());
  const pool = () => (data().applicantPool ||= []);
  const categoryOf = (id) => (id ? cfg().categories.find((c) => c.id === id) : null) || null;
  const templateOf = (id) => (id ? cfg().templates.find((x) => x.id === id) : null) || null;
  const categoryLabel = (id) => categoryOf(id)?.label || (id ? '(a category since removed)' : '');
  const day = (at) => fmtDay(localDate(new Date(at)));

  // ----- Which template an opening rates with -----
  // The category's default: the one it names, or else its first template that is not retired.
  function defaultTemplateId(categoryId) {
    const c = categoryOf(categoryId);
    const named = templateOf(c?.templateId);
    if (named && !named.retired) return named.id;
    return cfg().templates.find((x) => x.categoryId === categoryId && !x.retired)?.id || '';
  }
  // The frozen copy once an application to it has been rated; until then the template as it is now.
  function templateFor(o) {
    if (o.assessment) return { ...structuredClone(o.assessment), frozen: true };
    const tpl = templateOf(o.templateId);
    if (!tpl) return null;
    return {
      templateId: tpl.id, name: tpl.name, version: tpl.version, example: Boolean(tpl.example),
      categoryId: o.categoryId || '', categoryLabel: categoryLabel(o.categoryId), criteria: structuredClone(tpl.criteria), frozen: false,
    };
  }
  // The opening form's category and template: the default template comes from the category; once a
  // rating is made, neither can change.
  function cleanOpeningAssessment(input, existing) {
    const before = { categoryId: existing?.categoryId || '', templateId: existing?.templateId || '' };
    const has = (k) => Object.hasOwn(input, k) && input[k] !== undefined && input[k] !== null;
    if (!has('categoryId') && !has('templateId')) return before;
    const categoryId = has('categoryId') ? text(input.categoryId, 100) : before.categoryId;
    let templateId = has('templateId') ? text(input.templateId, 100) : categoryId === before.categoryId ? before.templateId : '';
    if (categoryId && !categoryOf(categoryId)) fail('Pick a position category from the list.');
    if (categoryId && !templateId) templateId = defaultTemplateId(categoryId);
    if (templateId) {
      const tpl = templateOf(templateId) || fail('Pick an assessment template from the list.');
      if (tpl.retired && tpl.id !== before.templateId) fail(`${tpl.name} is retired: pick another assessment template.`);
    }
    if (existing?.assessment && (categoryId !== before.categoryId || templateId !== before.templateId)) {
      fail('Applications to this opening have been rated, so its position category and assessment template are fixed.');
    }
    return { categoryId, templateId };
  }
  // What HR's opening screens show about it.
  function openingAssessment(o) {
    const tpl = templateFor(o);
    return {
      categoryId: o.categoryId || '', categoryLabel: categoryLabel(o.categoryId), templateId: o.templateId || '',
      templateName: tpl?.name || '', templateVersion: tpl?.version || null, templateExample: Boolean(tpl?.example),
      frozen: Boolean(o.assessment), frozenAt: o.assessment?.frozenAt || null,
      rated: applications().filter((a) => a.openingId === o.id && a.rating).length,
    };
  }

  // ----- Ratings -----
  // The rated applications of an opening (not withdrawn), and each one's rank by total.
  function ranked(o) {
    const list = applications().filter((a) => a.openingId === o.id && a.rating && a.status !== 'withdrawn');
    return { list, ranks: ranksOf(list.map((a) => ({ id: a.id, total: a.rating.total }))) };
  }
  const ranksAt = (o) => ranked(o).ranks;
  // An application's rating as HR reads it: scores, comments, points, total, who and when.
  function ratingOf(a, tpl) {
    const r = a.rating;
    if (!r) return null;
    const sum = weightedTotal(tpl?.criteria || [], r.scores);
    return {
      version: r.version, scores: structuredClone(r.scores), points: sum.points, total: r.total, complete: r.complete,
      by: r.by, at: r.at, history: (r.history || []).map((x) => ({ total: x.total, by: x.by, at: x.at })),
    };
  }
  function ratingView(a, o, user) {
    const tpl = templateFor(o);
    const { list, ranks } = ranked(o);
    return {
      application: { id: a.id, name: nameOf(a), userId: a.removed ? null : a.userId, internal: a.internal, stage: a.stage, stageLabel: stageLabel(h.stages(), a.stage), status: a.status, removed: Boolean(a.removed), own: a.userId === user.id },
      opening: { id: o.id, title: o.title, status: o.status, categoryLabel: categoryLabel(o.categoryId) },
      template: tpl, rating: ratingOf(a, tpl), rank: ranks.get(a.id) || null, rated: list.length,
    };
  }
  route('GET', '/api/hris/recruitment/applications/:id/rating', 'hris:hris.recruitment', ({ params, user }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    return ratingView(a, openingForHr(user, a.openingId), user);
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/applications/:id/rating', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const o = openingForHr(user, a.openingId);
    if (a.userId === user.id) fail('You cannot rate your own application. Another HR person does.', 403);
    if (a.removed) fail('This applicant was removed. The application is kept only so the counts stay true.');
    if (a.status === 'withdrawn') fail('The applicant withdrew this application.');
    const tpl = templateFor(o) || fail('Choose a position category and an assessment template for this opening first: Edit the opening.');
    const input = body.scores && typeof body.scores === 'object' && !Array.isArray(body.scores) ? body.scores : fail('Send a score for each criterion.');
    const scores = {};
    for (const c of tpl.criteria) {
      const x = input[c.id] && typeof input[c.id] === 'object' ? input[c.id] : {};
      const problem = scoreProblem(c.label, x.score);
      if (problem) fail(problem);
      const comment = text(x.comment, 500);
      const given = !(x.score === '' || x.score === null || x.score === undefined);
      if (given || comment) scores[c.id] = { score: given ? Number(x.score) : null, ...(comment ? { comment } : {}) };
    }
    const sum = weightedTotal(tpl.criteria, scores);
    if (!sum.given) fail('Give a score for at least one criterion.');
    const at = iso();
    // The first rating at this opening fixes its template: a copy of this version stays on the opening.
    if (!o.assessment) {
      const { frozen, ...copy } = tpl;
      o.assessment = { ...copy, frozenAt: at, frozenBy: user.name };
      ctx.audit({ kind: 'change', system: 'people', action: 'Fixed the assessment template of a job opening (first rating)', actor: user, target: { id: o.id, name: o.title }, ip, agent, detail: `${tpl.name}, version ${tpl.version}` });
    }
    const before = a.rating || null;
    a.rating = {
      version: o.assessment.version, templateId: o.assessment.templateId, scores, total: sum.total, complete: sum.complete, by: user.name, byId: user.id, at,
      history: before ? [...(before.history || []), { total: before.total, by: before.by, at: before.at }].slice(-20) : [],
    };
    const was = (id) => before?.scores?.[id]?.score;
    ctx.audit({
      kind: 'change', system: 'people', action: before ? 'Changed the rating of a job application' : 'Rated a job application',
      actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent, detail: `${o.assessment.name}, version ${o.assessment.version}`,
      changes: [
        ...tpl.criteria.filter((c) => was(c.id) !== scores[c.id]?.score && !(was(c.id) == null && scores[c.id]?.score == null)).map((c) => ({ field: `${c.label} (${c.weight}%)`, from: was(c.id) ?? '', to: scores[c.id]?.score ?? '' })),
        { field: 'Weighted total', from: before ? before.total : '', to: sum.total },
      ],
    });
    refreshEntry(a.userId);
    save();
    return ratingView(a, o, user);
  }, { audit: false, body: { scores: t.any() } });

  // The comparative list of an opening: rated applicants ranked by total, a column per criterion.
  route('GET', '/api/hris/recruitment/openings/:id/comparative', 'hris:hris.recruitment', ({ params, user }) => {
    const o = openingForHr(user, params.id);
    const tpl = templateFor(o);
    const { list, ranks } = ranked(o);
    const rows = list.map((a) => {
      const sum = weightedTotal(tpl?.criteria || [], a.rating.scores);
      return {
        id: a.id, rank: ranks.get(a.id), name: nameOf(a), internal: a.internal, removed: Boolean(a.removed), userId: a.removed ? null : a.userId,
        stageLabel: stageLabel(h.stages(), a.stage), status: a.status,
        scores: Object.fromEntries(Object.entries(a.rating.scores).map(([k, v]) => [k, v.score])), points: sum.points,
        total: a.rating.total, complete: a.rating.complete, by: a.rating.by, at: a.rating.at,
      };
    }).sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
    const active = applications().filter((a) => a.openingId === o.id && a.status !== 'withdrawn' && !a.removed);
    return {
      opening: { id: o.id, title: o.title, plantillaItem: o.plantillaItem || '', salaryGrade: o.salaryGrade || null, office: o.office || '', campusName: campusName(data(), o.campusId), vacancies: o.vacancies, closingDate: o.closingDate, status: o.status, categoryLabel: categoryLabel(o.categoryId) },
      template: tpl, rows, unrated: active.filter((a) => !a.rating).length, print: { ...cfg().print },
      school: { name: data().settings.schoolName, address: data().hrSettings?.employerAddress || '' }, asOf: today(),
    };
  }, { audit: false });

  // ----- Settings: categories, templates and the comparative list's captions -----
  const usage = () => {
    const live = new Map(); // template id → openings that still follow it (not yet rated)
    const fixed = new Map(); // template id → openings with a frozen copy of it
    const cats = new Map();
    for (const o of openings()) {
      if (o.categoryId) cats.set(o.categoryId, (cats.get(o.categoryId) || 0) + 1);
      const id = o.assessment?.templateId || o.templateId;
      if (!id) continue;
      const m = o.assessment ? fixed : live;
      m.set(id, (m.get(id) || 0) + 1);
    }
    return { live, fixed, cats };
  };
  function assessmentView() {
    const c = cfg();
    const u = usage();
    return {
      categories: c.categories.map((x) => ({ ...x, openings: u.cats.get(x.id) || 0 })),
      templates: c.templates.map((x) => ({ ...structuredClone(x), openings: u.live.get(x.id) || 0, fixedOpenings: u.fixed.get(x.id) || 0 })),
      print: { ...c.print },
    };
  }
  const newId = (label, taken, fallback) => {
    const base = String(label).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || fallback;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
  function cleanAssessment(body, user) {
    const now = cfg();
    const u = usage();
    const L = ASSESSMENT_LIMITS;
    const label = (v, what, max = L.label) => {
      const s = text(v, 400);
      if (!s) fail(`Every ${what} needs a name.`);
      if (s.length > max) fail(`${s.slice(0, 30)}…: at most ${max} characters.`);
      return s;
    };
    // Position categories.
    const catIn = Array.isArray(body.categories) ? body.categories : now.categories;
    if (!catIn.length) fail('Keep at least one position category.');
    if (catIn.length > L.categories) fail(`At most ${L.categories} position categories.`);
    const catIds = new Set(now.categories.map((x) => x.id));
    const catNames = new Set();
    const seenCats = new Set();
    const categories = catIn.map((x) => {
      const name = label(x?.label, 'position category');
      if (catNames.has(name.toLowerCase())) fail(`Two position categories are called ${name}.`);
      catNames.add(name.toLowerCase());
      let id = text(x?.id, 60);
      if (id && !ID_RE.test(id)) fail(`${name}: that id cannot be used.`);
      if (!id) id = newId(name, catIds, 'category');
      if (seenCats.has(id)) fail(`${name} is in the list twice.`);
      seenCats.add(id);
      return { id, label: name, templateId: text(x?.templateId, 100) };
    });
    for (const old of now.categories) {
      if (!seenCats.has(old.id) && u.cats.get(old.id)) fail(`${old.label} is the position category of ${u.cats.get(old.id)} job opening${u.cats.get(old.id) === 1 ? '' : 's'}: rename it instead of removing it.`);
    }
    // Templates.
    const tplIn = Array.isArray(body.templates) ? body.templates : now.templates;
    if (!tplIn.length) fail('Keep at least one assessment template.');
    if (tplIn.length > L.templates) fail(`At most ${L.templates} assessment templates.`);
    const tplIds = new Set(now.templates.map((x) => x.id));
    const tplNames = new Set();
    const seenTpl = new Set();
    const at = iso();
    const templates = tplIn.map((x) => {
      const name = label(x?.name, 'assessment template', L.name);
      if (tplNames.has(name.toLowerCase())) fail(`Two assessment templates are called ${name}.`);
      tplNames.add(name.toLowerCase());
      let id = text(x?.id, 60);
      if (id && !ID_RE.test(id)) fail(`${name}: that id cannot be used.`);
      if (!id) id = newId(name, tplIds, 'template');
      if (seenTpl.has(id)) fail(`${name} is in the list twice.`);
      seenTpl.add(id);
      const categoryId = text(x?.categoryId, 100);
      if (categoryId && !seenCats.has(categoryId)) fail(`${name}: pick a position category from the list.`);
      const crit = Array.isArray(x?.criteria) ? x.criteria : [];
      if (crit.length > L.criteria) fail(`${name}: at most ${L.criteria} criteria.`);
      const cIds = new Set();
      const cNames = new Set();
      const criteria = crit.map((c) => {
        const cl = label(c?.label, 'criterion');
        if (cNames.has(cl.toLowerCase())) fail(`${name}: two criteria are called ${cl}.`);
        cNames.add(cl.toLowerCase());
        const description = text(c?.description, 1000);
        if (description.length > L.description) fail(`${name}, ${cl}: the description has at most ${L.description} characters.`);
        let cid = text(c?.id, 60);
        if (cid && (!ID_RE.test(cid) || cIds.has(cid))) cid = '';
        if (!cid) cid = newId(cl, cIds, 'criterion');
        cIds.add(cid);
        const weight = c?.weight === '' || c?.weight === null || c?.weight === undefined ? NaN : Number(c.weight);
        return { id: cid, label: cl, description, weight };
      });
      const problem = weightProblem({ name, criteria });
      if (problem) fail(problem);
      const old = now.templates.find((y) => y.id === id);
      const same = old && JSON.stringify(old.criteria) === JSON.stringify(criteria);
      const changed = !old || !same || old.name !== name || old.categoryId !== categoryId || Boolean(old.retired) !== (x.retired === true);
      return {
        id, name, categoryId, version: old ? (same ? old.version : old.version + 1) : 1, criteria,
        // An example stays marked as one until its criteria are changed: then it is the school's own.
        ...(old?.example && same ? { example: true } : !old && x.example === true ? { example: true } : {}),
        ...(x.retired === true ? { retired: true } : {}),
        ...(changed ? { updatedAt: at, updatedBy: user?.name || '' } : old?.updatedAt ? { updatedAt: old.updatedAt, updatedBy: old.updatedBy } : {}),
      };
    });
    for (const old of now.templates) {
      if (!seenTpl.has(old.id) && u.live.get(old.id)) fail(`${old.name} is the assessment template of ${u.live.get(old.id)} job opening${u.live.get(old.id) === 1 ? '' : 's'} not yet rated: pick another template there, or retire it, before removing it.`);
    }
    for (const c of categories) {
      if (c.templateId && !templates.some((x) => x.id === c.templateId)) fail(`${c.label}: pick its default template from the list.`);
      if (c.templateId && templates.find((x) => x.id === c.templateId).retired) fail(`${c.label}: its default template is retired. Pick another.`);
    }
    // The captions of the printed comparative list.
    const p = body.print && typeof body.print === 'object' ? body.print : now.print;
    const caption = (v, fallback) => {
      const s = text(v ?? fallback, 400);
      if (s.length > L.caption) fail(`A caption has at most ${L.caption} characters.`);
      return s;
    };
    const print = { title: caption(p.title, now.print.title) || DEFAULT_ASSESSMENT.print.title, signCaption: caption(p.signCaption, now.print.signCaption), signName: caption(p.signName, now.print.signName), signTitle: caption(p.signTitle, now.print.signTitle) };
    return { categories, templates, print };
  }
  route('GET', '/api/hris/recruitment/assessment', 'hris', ({ user }) => {
    if (!userCan(user, 'hris.recruitment') && !userCan(user, 'hris.settings')) fail('You do not have access to this.', 403);
    return { ...assessmentView(), defaults: DEFAULT_ASSESSMENT };
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/assessment', 'hris:hris.settings', ({ body, user }) => {
    data().settings.assessment = cleanAssessment(body, user);
    save();
    return assessmentView();
  }, { body: { categories: t.any(), templates: t.any(), print: t.any() } });

  // ----- The pool of applicants -----
  const entryOf = (userId) => pool().find((e) => e.userId === userId) || null;
  const monthsSetting = () => people().applicantPoolMonths;
  const snapshot = (u) => poolSnapshot(data(), u, h.stages());
  function refreshEntry(userId) {
    const e = userId ? entryOf(userId) : null;
    const u = e ? userById(userId) : null;
    if (e && u) Object.assign(e, snapshot(u));
  }
  // An applicant account is kept open for the time in the pool; the bell says until when.
  function coverAccount(u, until) {
    if (u.role !== 'applicant') return false;
    if (Date.parse(u.expiresAt) >= Date.parse(until)) return false;
    if (!u.poolExtendedFrom) u.poolExtendedFrom = u.expiresAt;
    u.expiresAt = until;
    delete u.expiryWarnedAt;
    if (u.status === 'expired') {
      u.status = 'active';
      delete u.closedAt;
    }
    return true;
  }
  // Puts someone who opted in into the pool (or renews their time there). how: 'auto' or 'hr'.
  function enter(u, { how, application = null, by = null, reason = '', ip, agent }) {
    if (!u.poolOptIn) return null;
    const at = iso();
    const months = poolMonthsFor(u.poolOptIn, monthsSetting());
    const until = addMonths(at, months);
    let e = entryOf(u.id);
    const renewed = Boolean(e);
    if (!e) {
      e = { id: randomUUID(), userId: u.id, internal: u.role !== 'applicant', employeeId: u.role === 'applicant' ? null : u.employeeId || null, enteredAt: at, how, applicationIds: [], invites: [] };
      pool().push(e);
    }
    Object.assign(e, { until, months, renewedAt: renewed ? at : null, ...snapshot(u) });
    if (application && !e.applicationIds.includes(application.id)) e.applicationIds.push(application.id);
    if (how === 'hr') Object.assign(e, { addedBy: by?.name || '', addedById: by?.id || null, reason });
    const extended = coverAccount(u, until);
    ctx.audit({
      kind: 'change', system: 'people', action: renewed ? 'Renewed a place in the pool of applicants' : how === 'hr' ? 'Added an applicant to the pool of applicants' : 'Applicant entered the pool of applicants',
      actor: by, target: u, ip, agent,
      detail: `${how === 'hr' ? `By HR: ${reason}` : application ? `After the outcome of an application (${stageLabel(h.stages(), application.stage)})` : ''} · until ${until}${extended ? ' · account kept open until then' : ''}`.replace(/^ · /, ''),
    });
    ctx.notify([u.id], {
      system: 'hris', kind: 'pool.entered', title: `You are in the pool of applicants until ${day(until)}`,
      body: `HR may invite you to apply for other openings.${extended ? ` Your applicant account stays open until ${day(until)}.` : ''} You can leave the pool at any time under My applications.`,
      link: '/hris/#/jobs/mine',
    });
    return e;
  }
  // Takes someone out of the pool. An applicant account kept open for the pool closes as usual: on
  // its own date, or now if that has passed (and is removed the usual number of days later).
  function leave(e, { why, by = null, reason = '', ip, agent, tell = true }) {
    data().applicantPool = pool().filter((x) => x.id !== e.id);
    const u = userById(e.userId);
    let closes = null;
    if (u?.poolExtendedFrom) {
      u.expiresAt = iso(Math.max(Date.parse(u.poolExtendedFrom) || 0, Math.min(nowMs(), Date.parse(u.expiresAt))));
      delete u.poolExtendedFrom;
      delete u.expiryWarnedAt;
      closes = u.expiresAt;
    }
    const ACTIONS = { ended: 'Left the pool of applicants: the time ended', self: 'Left the pool of applicants (their own choice)', hr: 'Removed an applicant from the pool of applicants', selected: 'Left the pool of applicants: selected for a position', undone: 'Left the pool of applicants: the outcome that put them there was undone', removed: 'Left the pool of applicants: the account was removed' };
    ctx.audit({ kind: 'change', system: 'people', action: ACTIONS[why], actor: by, target: u || { id: e.userId, name: 'Removed applicant' }, ip, agent, detail: [reason, closes ? `account closes ${closes}` : ''].filter(Boolean).join(' · ') });
    if (tell && u && why !== 'removed') {
      const title = why === 'ended' ? 'Your time in the pool of applicants has ended' : why === 'self' ? 'You left the pool of applicants' : why === 'selected' ? 'You left the pool of applicants: you were selected' : 'You are no longer in the pool of applicants';
      const close = closes ? (Date.parse(closes) <= nowMs() ? ' Your applicant account closes now, and is removed later as the sign-up notice said.' : ` Your applicant account closes on ${day(closes)}.`) : '';
      ctx.notify([u.id], { system: 'hris', kind: 'pool.left', title, body: `HR no longer keeps you in the pool for other openings.${close}`, link: '/hris/#/jobs/mine' });
    }
  }

  // Hooks for server/recruitment.js.
  // An application decided: Not selected or Not qualified puts someone who opted in into the pool;
  // Selected takes them out of it (they were hired).
  function onDecided(a, meaning, user, { ip, agent } = {}) {
    const u = userById(a.userId);
    if (!u || a.removed) return;
    if (meaning === 'not-selected') enter(u, { how: 'auto', application: a, ip, agent });
    else if (meaning === 'selected') {
      const e = entryOf(u.id);
      if (e) leave(e, { why: 'selected', by: user, ip, agent });
    } else refreshEntry(u.id);
  }
  // A decision moved back: if it was the only one that put them in the pool (not HR by hand), they leave it.
  function onUndecided(a, user, { ip, agent } = {}) {
    const e = entryOf(a.userId);
    if (!e) return;
    e.applicationIds = (e.applicationIds || []).filter((id) => id !== a.id);
    if (e.how === 'auto' && !e.applicationIds.length) leave(e, { why: 'undone', by: user, ip, agent });
    else refreshEntry(a.userId);
  }
  // The account is being removed: its pool entry goes, and ratings keep no comments (they may name the person).
  function onRemoveApplicant(u) {
    const e = entryOf(u.id);
    if (e) leave(e, { why: 'removed', tell: false });
    for (const a of applications().filter((x) => x.userId === u.id && x.rating)) {
      a.rating.scores = Object.fromEntries(Object.entries(a.rating.scores).map(([k, v]) => [k, { score: v.score }]));
    }
  }
  // The daily sweep: entries whose time has ended leave the pool (before the accounts are checked).
  function sweepPool() {
    let changed = false;
    for (const e of [...pool()]) {
      if (Date.parse(e.until) <= nowMs()) {
        leave(e, { why: 'ended' });
        changed = true;
      }
    }
    return changed;
  }

  // ----- The person's own opt-in (sign-up, My applications) -----
  const poolSelf = (u) => {
    const e = entryOf(u.id);
    return {
      optedIn: Boolean(u.poolOptIn), optedInAt: u.poolOptIn?.at || null, months: u.poolOptIn ? poolMonthsFor(u.poolOptIn, monthsSetting()) : monthsSetting(),
      inPool: Boolean(e), enteredAt: e?.enteredAt || null, until: e?.until || null,
      invites: (e?.invites || []).map((x) => ({ openingId: x.openingId, title: x.title, at: x.at })), // never ratings
    };
  };
  const optIn = () => ({ at: iso(), months: monthsSetting() });
  route('GET', '/api/hris/my-pool', 'hris', ({ user }) => poolSelf(user), { applicants: true, audit: false });
  route('PUT', '/api/hris/my-pool', 'hris', ({ user, body, ip, agent }) => {
    if (user.role !== 'applicant' && !employeeById(user.employeeId)) fail('The pool of applicants is for job applicants and for employees with an employee record.', 403);
    if (body.optIn === true) {
      if (!user.poolOptIn) {
        user.poolOptIn = optIn(user);
        ctx.audit({ kind: 'account', system: 'people', action: 'Agreed to be kept in the pool of applicants', actor: user, target: user, ip, agent, detail: `${user.poolOptIn.months} months` });
        // Already decided Not selected or Not qualified on an application: in the pool now.
        const decided = applications().filter((a) => a.userId === user.id && a.status === 'not-selected');
        if (decided.length && !applications().some((a) => a.userId === user.id && a.status === 'selected')) for (const a of decided) enter(user, { how: 'auto', application: a, ip, agent });
      }
    } else if (body.optIn === false) {
      if (user.poolOptIn) {
        delete user.poolOptIn;
        ctx.audit({ kind: 'account', system: 'people', action: 'Withdrew from the pool of applicants', actor: user, target: user, ip, agent });
        const e = entryOf(user.id);
        if (e) leave(e, { why: 'self', by: user, ip, agent, tell: false });
      }
    } else fail('Say whether to keep you in the pool (optIn: true or false).');
    save();
    return { ...poolSelf(user), expiresAt: user.role === 'applicant' ? user.expiresAt : null };
  }, { applicants: true, audit: false, body: { optIn: t.bool() } });

  // ----- HR: the pool page -----
  const poolRow = (e) => {
    const u = userById(e.userId);
    const emp = e.internal ? employeeById(e.employeeId || u?.employeeId) : null;
    return {
      id: e.id, userId: e.userId, name: emp ? `${emp.firstName} ${emp.lastName}` : u?.name || 'Removed applicant', email: u?.email || emp?.email || '', phone: u?.phone || emp?.phone || '',
      internal: e.internal, enteredAt: e.enteredAt, renewedAt: e.renewedAt || null, until: e.until, how: e.how, addedBy: e.addedBy || '', reason: e.reason || '',
      qualifications: e.qualifications || {}, openings: e.openings || [], bestRatings: e.bestRatings || [], invites: e.invites || [],
      accountOpen: Boolean(u && u.status === 'active' && !applicantExpired(u, nowMs())),
    };
  };
  // Search and filters: a word (name, email, an opening applied to), position category, education
  // attainment (at least), preferred campus, the rating range (best rating, in the category if one
  // is picked), and the date they entered.
  function filterPool(rows, q) {
    const word = String(q.q || '').trim().toLowerCase();
    const cat = String(q.category || '');
    const edu = String(q.education || '');
    const campus = String(q.campus || '');
    const min = q.min === undefined || q.min === '' ? null : Number(q.min);
    const max = q.max === undefined || q.max === '' ? null : Number(q.max);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : '';
    return rows.filter((r) => {
      if (word && ![r.name, r.email, ...r.openings.map((o) => o.title)].some((s) => String(s).toLowerCase().includes(word))) return false;
      if (cat && !r.openings.some((o) => o.categoryId === cat) && !r.bestRatings.some((b) => b.categoryId === cat)) return false;
      if (edu && EDUCATION_ORDER.indexOf(r.qualifications.education) < EDUCATION_ORDER.indexOf(edu)) return false;
      if (campus && r.qualifications.campusId !== campus) return false;
      if (min !== null || max !== null) {
        const totals = r.bestRatings.filter((b) => !cat || b.categoryId === cat).map((b) => b.total);
        if (!totals.length) return false;
        const best = Math.max(...totals);
        if ((min !== null && best < min) || (max !== null && best > max)) return false;
      }
      const entered = localDate(new Date(r.enteredAt));
      if ((from && entered < from) || (to && entered > to)) return false;
      return true;
    });
  }
  route('GET', '/api/hris/recruitment/pool', 'hris:hris.recruitment', ({ query, user }) => {
    const all = pool().map(poolRow).sort((a, b) => b.enteredAt.localeCompare(a.enteredAt));
    const rows = filterPool(all, query);
    const ids = hrCampusIds(user);
    return {
      entries: rows, total: all.length,
      months: monthsSetting(),
      categories: cfg().categories.map((c) => ({ id: c.id, label: c.label })),
      campuses: data().campuses.map((c) => ({ id: c.id, name: c.name })),
      education: EDUCATION_LEVELS.map(([id, label]) => ({ id, label })),
      // Openings HR may invite to: open, taking applications, at HR's campuses.
      openings: openings().filter((o) => ids.has(o.campusId) && openingAccepts(o, today())).map((o) => ({ id: o.id, title: o.title, audience: o.audience, campusName: campusName(data(), o.campusId), closingDate: o.closingDate, categoryId: o.categoryId || '' })),
    };
  }, { audit: false });
  route('POST', '/api/hris/recruitment/pool', 'hris:hris.recruitment', ({ body, user, ip, agent }) => {
    const u = userById(text(body.userId, 100)) || fail('Person not found.', 404);
    if (u.id === user.id) fail('You cannot add yourself to the pool.', 403);
    if (u.role !== 'applicant' && !employeeById(u.employeeId)) fail('Only job applicants and employees can be in the pool.');
    if (!u.poolOptIn) fail(`${u.name} has not agreed to be kept in the pool of applicants. Only they can tick it, under My applications.`, 409);
    if (entryOf(u.id)) fail(`${u.name} is already in the pool.`, 409);
    if (u.role === 'applicant' && (u.status !== 'active' || applicantExpired(u, nowMs()))) fail('Their applicant account has closed: extend it first.');
    const reason = text(body.reason, 500);
    if (!reason) fail('Give the reason for adding them. It is kept in the audit log.');
    const e = enter(u, { how: 'hr', by: user, reason, ip, agent });
    save();
    return poolRow(e);
  }, { audit: false, body: { userId: t.str(100), reason: t.str(2000) } });
  route('POST', '/api/hris/recruitment/pool/:id/remove', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const e = pool().find((x) => x.id === params.id) || fail('Not in the pool.', 404);
    const reason = text(body.reason, 500);
    if (!reason) fail('Give the reason for removing them. It is kept in the audit log.');
    leave(e, { why: 'hr', by: user, reason, ip, agent });
    save();
    return { ok: true };
  }, { audit: false, body: { reason: t.str(2000) } });
  route('POST', '/api/hris/recruitment/pool/:id/invite', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const e = pool().find((x) => x.id === params.id) || fail('Not in the pool.', 404);
    const u = userById(e.userId) || fail('Person not found.', 404);
    const o = openingForHr(user, text(body.openingId, 100));
    if (!openingAccepts(o, today())) fail(`${o.title} does not take applications now: invite to an open opening.`);
    if (o.audience === 'internal' && u.role === 'applicant') fail(`${o.title} is for employees only.`);
    if (u.role === 'applicant' && (u.status !== 'active' || applicantExpired(u, nowMs()))) fail('Their applicant account has closed.');
    const mine = applications().find((a) => a.openingId === o.id && a.userId === u.id && a.status !== 'withdrawn');
    if (mine) fail(`${u.name} has already applied for ${o.title}.`, 409);
    const before = (e.invites || []).find((x) => x.openingId === o.id);
    if (before) fail(`${u.name} was already invited to ${o.title} on ${day(before.at)}.`, 409);
    const note = text(body.note, 1000);
    const at = iso();
    (e.invites ||= []).push({ openingId: o.id, title: o.title, at, by: user.name, byId: user.id, ...(note ? { note } : {}) });
    ctx.notify([u.id], {
      system: 'hris', kind: 'pool.invited', title: `You are invited to apply for ${o.title}`,
      body: note ? `Note from HR: ${note}` : `HR thinks you may fit this opening. Read it and apply by ${fmtDay(o.closingDate)} if you are interested.`,
      link: `/hris/#/jobs/${o.id}`,
    }); // no actor: the applicant is told "HR office", never a name
    ctx.audit({ kind: 'change', system: 'people', action: 'Invited someone in the pool of applicants to apply', actor: user, target: u, ip, agent, detail: `${o.title}${note ? ` · ${note}` : ''}` });
    save();
    return poolRow(e);
  }, { audit: false, body: { openingId: t.str(100), note: t.str(2000) } });

  // ----- The applicant profile (PL-019) -----
  // query.remarks=1: with HR's internal remarks and reasons; query.ratings=1: with the ratings.
  route('GET', '/api/hris/recruitment/profiles/:userId', 'hris:hris.recruitment', ({ params, query, user }) => {
    const u = userById(params.userId);
    const mine = u ? applications().filter((a) => a.userId === u.id) : [];
    if (!u || (u.role !== 'applicant' && !mine.length && !entryOf(u.id))) fail('Applicant not found.', 404);
    const withRemarks = query.remarks === '1';
    const withRatings = query.ratings === '1';
    const ids = hrCampusIds(user);
    const here = mine.filter((a) => ids.has(openings().find((o) => o.id === a.openingId)?.campusId));
    const emp = u.role === 'applicant' ? null : employeeById(u.employeeId);
    const s = people();
    const closed = u.role === 'applicant' && (u.status !== 'active' || applicantExpired(u, nowMs()));
    const cfgStages = h.stages();
    const e = entryOf(u.id);
    return {
      id: u.id, name: emp ? `${emp.firstName} ${emp.lastName}` : u.name, email: u.email || emp?.email || '', phone: u.phone || emp?.phone || '',
      internal: Boolean(emp), role: u.role,
      details: applicantDetails(u, (id) => campusName(data(), id)),
      employee: emp ? { id: emp.id, employeeNo: emp.employeeNo || '', position: emp.position || '', department: emp.department || '', salaryGrade: emp.salaryGrade || null, step: emp.step || null, appointment: emp.appointment || '', campusName: campusName(data(), emp.campusId), status: emp.status } : null,
      account: u.role === 'applicant'
        ? { createdAt: u.createdAt, expiresAt: u.expiresAt, lastLoginAt: u.lastLoginAt || null, consentAt: u.consentAt || null, status: closed ? 'closed' : 'open', removeAfter: closed && s.applicantPurgeDays > 0 ? iso(Date.parse(u.expiresAt) + s.applicantPurgeDays * DAY_MS) : null, keptOpenForPool: Boolean(u.poolExtendedFrom) }
        : { createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null, employee: true },
      applications: here.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => {
        const o = openings().find((x) => x.id === a.openingId);
        const tpl = o ? templateFor(o) : null;
        const here2 = stageInfo(cfgStages, a.stage);
        return {
          id: a.id, openingId: a.openingId, title: o?.title || '(opening removed)', office: o?.office || '', campusName: o ? campusName(data(), o.campusId) : '', categoryLabel: categoryLabel(o?.categoryId),
          internal: a.internal, note: a.note || '', createdAt: a.createdAt, updatedAt: a.updatedAt,
          stageLabel: stageLabel(cfgStages, a.stage), status: a.status, outcome: here2.kind === 'outcome' ? { label: here2.label, meaning: meaningLabel(here2.meaning) } : null,
          rating: withRatings && a.rating ? { ...ratingOf(a, tpl), rank: o ? ranksAt(o).get(a.id) || null : null, criteria: tpl?.criteria || [], templateName: tpl?.name || '' } : null,
          rated: Boolean(a.rating),
          history: (a.history || []).map((x) => ({
            stageLabel: stageLabel(cfgStages, x.stage), at: x.at, by: x.self ? 'Applicant' : x.by || '', back: Boolean(x.back), note: x.note || '',
            ...(withRemarks ? { remark: x.remark || '', reason: x.reason || '' } : {}),
          })),
        };
      }),
      elsewhere: mine.length - here.length,
      pool: { optedIn: Boolean(u.poolOptIn), optedInAt: u.poolOptIn?.at || null, entry: e ? poolRow(e) : null },
      options: { remarks: withRemarks, ratings: withRatings },
      school: { name: data().settings.schoolName, address: data().hrSettings?.employerAddress || '' },
      printedBy: user.name, printedAt: iso(),
    };
  }, { audit: false });

  return {
    cleanOpeningAssessment, openingAssessment, ranksAt, ratingSummary: (a, ranks) => (a.rating ? { total: a.rating.total, complete: a.rating.complete, rank: ranks.get(a.id) || null, by: a.rating.by, at: a.rating.at } : null),
    onDecided, onUndecided, onRemoveApplicant, sweepPool, poolSelf, optIn, entryOf, educationLabel,
  };
}

// ----- Demo data: ratings on the demo openings, and people in the pool -----
// Called from addRecruitmentDemo once the applications exist. rate: [[application, scores in the
// template's order (null: not yet), rater, days ago]]; pooled: [[user, days ago they entered]].
export function addAssessmentDemo(data, { now, rate, pooled, stagesCfg, months = 12 }) {
  data.applicantPool ||= [];
  const settings = mergeAssessment(data.settings?.assessment);
  for (const [a, scores, by, daysAgo] of rate) {
    const o = data.jobOpenings.find((x) => x.id === a.openingId);
    const tpl = settings.templates.find((x) => x.id === o?.templateId);
    if (!tpl) continue;
    if (!o.assessment) {
      o.assessment = {
        templateId: tpl.id, name: tpl.name, version: tpl.version, example: Boolean(tpl.example), categoryId: o.categoryId,
        categoryLabel: settings.categories.find((c) => c.id === o.categoryId)?.label || '', criteria: structuredClone(tpl.criteria),
        frozenAt: new Date(now - (daysAgo + 1) * DAY_MS).toISOString(), frozenBy: by,
      };
    }
    const s = Object.fromEntries(tpl.criteria.map((c, i) => [c.id, { score: scores[i] ?? null }]).filter(([, v]) => v.score !== null));
    const sum = weightedTotal(tpl.criteria, s);
    a.rating = { version: tpl.version, templateId: tpl.id, scores: s, total: sum.total, complete: sum.complete, by, byId: null, at: new Date(now - daysAgo * DAY_MS).toISOString(), history: [] };
  }
  for (const [u, daysAgo] of pooled) {
    const enteredAt = new Date(now - daysAgo * DAY_MS).toISOString();
    const until = addMonths(enteredAt, months);
    u.poolOptIn = { at: u.createdAt, months };
    if (u.role === 'applicant' && Date.parse(u.expiresAt) < Date.parse(until)) {
      u.poolExtendedFrom = u.expiresAt;
      u.expiresAt = until;
    }
    const apps = data.jobApplications.filter((a) => a.userId === u.id && a.status === 'not-selected');
    data.applicantPool.push({
      id: randomUUID(), demo: true, userId: u.id, internal: u.role !== 'applicant', employeeId: u.role === 'applicant' ? null : u.employeeId || null,
      enteredAt, until, months, how: 'auto', renewedAt: null, applicationIds: apps.map((a) => a.id), invites: [], ...poolSnapshot(data, u, stagesCfg),
    });
  }
}
export function removeAssessmentDemo(data, demoUsers) {
  data.applicantPool = (data.applicantPool || []).filter((e) => !e.demo && !demoUsers.has(e.userId));
}
