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
//  - Rating (PL-018, PL-021): each criterion is scored 0 to 100 with an optional comment; the
//    weighted total is Σ score × weight / 100 (never above 100). HR names a selection board (a panel
//    of assessors) per opening; each assessor rates each applicant on their own (a draft, then
//    submitted) and sees nobody else's scores before submitting. The submitted ratings are combined
//    by the template's rule (average; average without the highest and lowest; board consensus entered
//    by the secretariat), per criterion. HR can always rate, as the HR office (one shared rating, as
//    before several assessors existed). Who rated and when is kept, and every rating, draft, consensus
//    and panel change goes to the audit log. The applicant never sees scores (a question for the
//    school: some processes publish comparative assessment results).
//  - A Performance rating criterion: a typed score with its source, or an adjectival rating converted
//    by the template's table; for external applicants not applicable (its weight spread over the
//    others) unless the template takes a typed score.
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
import { userCan, NON_STAFF_ROLES, ROLES, roleLabel } from '../shared/roles.js';
import {
  applicantDetails, stageLabel, stageInfo, meaningLabel, openingAccepts, applicantExpired, EDUCATION_LEVELS, educationLabel, DAY_MS,
} from '../shared/recruitment.js';
import {
  mergeAssessment, weightProblem, weightedTotal, ranksOf, scoreProblem, ASSESSMENT_LIMITS, DEFAULT_ASSESSMENT,
  addMonths, poolMonthsFor, skipSet, combineRating, combineLabel, DEFAULT_COMBINE, COMBINE_RULES, EXTERNAL_RULES, NOT_APPLICABLE,
  DEFAULT_ADJECTIVAL, twoDecimals, DEFAULT_BOARD,
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
    if (o.assessment) return { combine: DEFAULT_COMBINE, ...structuredClone(o.assessment), frozen: true };
    const tpl = templateOf(o.templateId);
    if (!tpl) return null;
    return {
      templateId: tpl.id, name: tpl.name, version: tpl.version, example: Boolean(tpl.example), combine: tpl.combine || DEFAULT_COMBINE,
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
      frozen: Boolean(o.assessment), frozenAt: o.assessment?.frozenAt || null, combine: tpl?.combine || DEFAULT_COMBINE,
      rated: applications().filter((a) => a.openingId === o.id && a.rating).length,
      panel: panelView(o),
    };
  }

  // ----- Who may rate: HR at the opening's campus, and the assessors named on its panel -----
  // An assessor is any active staff account (not a student, parent or job applicant). Naming them on
  // an opening's panel is what lets them see and rate that opening's applicants (the permission
  // hris.assess, given by the panel for that opening only); taking hris.assess away from an account
  // (Users & Access → Access) stops it rating even where it is named. HR (hris.recruitment) can
  // always rate, as the HR office.
  const isHrOf = (user, o) => userCan(user, 'hris.recruitment') && hrCampusIds(user).has(o.campusId);
  const panelOf = (o) => (Array.isArray(o.panel) ? o.panel : []);
  const onPanel = (o, user) => panelOf(o).some((p) => p.userId === user.id);
  const mayAssess = (u) => Boolean(u) && u.status === 'active' && !NON_STAFF_ROLES.includes(u.role) && ROLES[u.role] && !u.access?.remove?.includes('hris.assess');
  // A board member who is also an applicant to the same opening has a conflict of interest: they
  // neither rate its applicants nor open their documents (applying is refused while on the board).
  const appliedTo = (o, user) => applications().some((a) => a.openingId === o.id && a.userId === user.id && a.status !== 'withdrawn' && !a.removed);
  const conflicted = (o, user) => onPanel(o, user) && appliedTo(o, user);
  function openingForRater(user, id) {
    const o = openings().find((x) => x.id === id);
    if (o && conflicted(o, user)) fail('You have applied for this opening, so you cannot rate its applicants or open their documents while you are on its selection board. Ask HR.', 403);
    if (o && isHrOf(user, o)) return { o, hr: true };
    if (o && onPanel(o, user) && mayAssess(user)) return { o, hr: false };
    if (userCan(user, 'hris.recruitment')) fail('Job opening not found at your campuses.', 404);
    fail('You are not on the selection board of this opening. HR names the assessors of each opening.', 403);
  }
  // Whose rating someone makes: their own as a named assessor, else the HR office's (one shared
  // rating, as before several assessors: another HR person's rating replaces it, with its history).
  const slotOf = (o, user) => (onPanel(o, user) ? user.id : 'hr');
  const slotName = (o, r) => r.by || (r.slot === 'hr' ? 'HR office' : nameOfUser(r.slot));
  const nameOfUser = (id) => userById(id)?.name || 'Former assessor';
  const ratingsOf = (a) => (Array.isArray(a.ratings) ? a.ratings : []);
  // A named assessor sees nobody else's scores of an application until they submit their own, on
  // every screen (HR included, when named): the rating page, the comparative list, the opening's list
  // of applications and the applicant profile.
  const resultHidden = (a, o, user) => Boolean(o) && onPanel(o, user) && !ratingsOf(a).some((r) => r.slot === user.id && r.submittedAt);

  // ----- Combining (shared/recruitment-assess.js) -----
  // a.rating is the combined result of the submitted ratings (or the consensus), kept with the
  // application so the lists, the pool and the profile read it as before; null while nothing counts.
  function recombine(a, o) {
    const tpl = templateFor(o);
    if (!tpl) return (a.rating = null);
    const skip = skipSet(tpl.criteria, a.internal);
    const rule = tpl.combine || DEFAULT_COMBINE;
    const c = combineRating(tpl.criteria, ratingsOf(a), rule, a.consensus, skip);
    if (!c) {
      a.rating = null;
      return null;
    }
    const sub = ratingsOf(a).filter((r) => r.submittedAt);
    const single = rule !== 'consensus' && sub.length === 1 ? sub[0] : null;
    const scores = single ? structuredClone(single.scores) : c.scores; // one rating: its comments too
    const at = rule === 'consensus' ? a.consensus.at : sub.map((r) => r.submittedAt).sort().at(-1);
    a.rating = {
      version: tpl.version, templateId: tpl.templateId, rule, scores, total: c.total, complete: c.complete, count: c.count,
      by: rule === 'consensus' ? `Board consensus (entered by ${a.consensus.by})` : single ? single.by : `${sub.length} assessors`,
      byId: single?.byId || (rule === 'consensus' ? a.consensus.byId : null), at,
      history: single ? structuredClone(single.history || []) : [],
    };
    return a.rating;
  }
  // "Rated by 2 of 3 assessors": the panel, and anyone else whose rating counts (the HR office).
  function progressOf(a, o) {
    const done = new Set(ratingsOf(a).filter((r) => r.submittedAt).map((r) => r.slot));
    const all = new Set([...panelOf(o).map((p) => p.userId), ...done]);
    const tpl = templateFor(o);
    return { submitted: done.size, of: all.size, drafts: ratingsOf(a).filter((r) => !r.submittedAt).length, rule: tpl?.combine || DEFAULT_COMBINE, consensus: Boolean(a.consensus) };
  }

  // ----- Ratings -----
  // The applications of an opening with a combined rating (not withdrawn), and each one's rank by total.
  function ranked(o) {
    const list = applications().filter((a) => a.openingId === o.id && a.rating && a.status !== 'withdrawn');
    return { list, ranks: ranksOf(list.map((a) => ({ id: a.id, total: a.rating.total }))) };
  }
  const ranksAt = (o) => ranked(o).ranks;
  // A rating as HR or its assessor reads it: scores, comments, points, total, who and when.
  function ratingOf(r, tpl, skip) {
    if (!r) return null;
    const sum = weightedTotal(tpl?.criteria || [], r.scores, skip);
    return {
      version: r.version, scores: structuredClone(r.scores || {}), points: sum.points, total: r.total ?? sum.total, complete: r.complete ?? sum.complete,
      by: r.by, at: r.at, submittedAt: r.submittedAt ?? r.at ?? null, draft: Object.hasOwn(r, 'submittedAt') && !r.submittedAt,
      history: (r.history || []).map((x) => ({ total: x.total, by: x.by, at: x.at })),
      ...(r.slot ? { slot: r.slot } : {}),
    };
  }
  // The breakdown (HR only): each assessor's rating, and the consensus.
  const breakdownOf = (a, o, tpl, skip) => ratingsOf(a).map((r) => ({ ...ratingOf(r, tpl, skip), slot: r.slot, name: slotName(o, r), title: panelOf(o).find((p) => p.userId === r.slot)?.title || (r.slot === 'hr' ? 'HR office' : '') }));
  function ratingView(a, o, user, access) {
    const tpl = templateFor(o);
    const skip = tpl ? skipSet(tpl.criteria, a.internal) : new Set();
    const { list, ranks } = ranked(o);
    const slot = slotOf(o, user);
    const mine = ratingsOf(a).find((r) => r.slot === slot) || null;
    // A named assessor sees nobody else's scores until they submit their own (HR included, when named).
    const independent = slot !== 'hr' && !mine?.submittedAt;
    const seesResult = access.hr ? !independent : Boolean(mine?.submittedAt) && cfg().board.assessorsSeeResult;
    return {
      application: { id: a.id, name: nameOf(a), userId: a.removed ? null : a.userId, internal: a.internal, stage: a.stage, stageLabel: stageLabel(h.stages(), a.stage), status: a.status, removed: Boolean(a.removed), own: a.userId === user.id, note: a.note || '' },
      opening: { id: o.id, title: o.title, status: o.status, categoryLabel: categoryLabel(o.categoryId) },
      template: tpl, skip: [...skip],
      rating: ratingOf(mine, tpl, skip), // this person's own (or the HR office's)
      asAssessor: slot !== 'hr', hr: access.hr,
      combined: seesResult && a.rating ? { ...ratingOf(a.rating, tpl, skip), rule: a.rating.rule, count: a.rating.count } : null,
      breakdown: access.hr && !independent ? breakdownOf(a, o, tpl, skip) : null,
      consensus: access.hr && a.consensus ? ratingOf(a.consensus, tpl, skip) : null,
      progress: progressOf(a, o), panel: panelOf(o).length,
      rank: seesResult ? ranks.get(a.id) || null : null, rated: seesResult ? list.length : null,
      board: { seesResult: cfg().board.assessorsSeeResult, independent },
      documents: h.documentsOf ? h.documentsOf(a, o) : null,
    };
  }
  // A rating's scores from the form: 0 to 100 per criterion, with a comment; the performance rating
  // also with its source and, optionally, the adjectival rating it was converted from.
  function cleanScores(tpl, a, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Send a score for each criterion.');
    const skip = skipSet(tpl.criteria, a.internal);
    const scores = {};
    for (const c of tpl.criteria) {
      const x = input[c.id] && typeof input[c.id] === 'object' ? input[c.id] : {};
      const given = !(x.score === '' || x.score === null || x.score === undefined);
      if (skip.has(c.id)) {
        if (given || x.adjectival) fail(`${c.label}: ${NOT_APPLICABLE}`);
        continue;
      }
      let score = x.score;
      let adjectival = '';
      if (c.type === 'performance' && x.adjectival) {
        const row = (c.table || []).find((r) => r.label === String(x.adjectival)) || fail(`${c.label}: pick a rating from the template's list (${(c.table || []).map((r) => r.label).join(', ')}).`);
        adjectival = row.label;
        score = row.score;
      }
      const has = !(score === '' || score === null || score === undefined);
      const problem = scoreProblem(c.label, score);
      if (problem) fail(problem);
      const comment = text(x.comment, 500);
      const source = c.type === 'performance' ? text(x.source, ASSESSMENT_LIMITS.source) : '';
      if (has || comment || source) scores[c.id] = { score: has ? Number(score) : null, ...(comment ? { comment } : {}), ...(source ? { source } : {}), ...(adjectival ? { adjectival } : {}) };
    }
    const sum = weightedTotal(tpl.criteria, scores, skip);
    if (!sum.given) fail('Give a score for at least one criterion.');
    return { scores, sum, skip };
  }
  // The first rating at an opening (a draft, a submitted one or the consensus) fixes its template.
  function freeze(o, tpl, user, at, { ip, agent }) {
    if (o.assessment) return;
    const { frozen, ...copy } = tpl;
    o.assessment = { ...copy, frozenAt: at, frozenBy: user.name };
    ctx.audit({ kind: 'change', system: 'people', action: 'Fixed the assessment template of a job opening (first rating)', actor: user, target: { id: o.id, name: o.title }, ip, agent, detail: `${tpl.name}, version ${tpl.version} · ${combineLabel(tpl.combine)}` });
  }
  const scoreChanges = (tpl, before, scores) => {
    const was = (id) => before?.scores?.[id]?.score;
    return tpl.criteria.filter((c) => was(c.id) !== scores[c.id]?.score && !(was(c.id) == null && scores[c.id]?.score == null)).map((c) => ({ field: `${c.label} (${c.weight}%)`, from: was(c.id) ?? '', to: scores[c.id]?.score ?? '' }));
  };
  function checkRateable(a, user) {
    if (a.userId === user.id) fail('You cannot rate your own application. Another HR person does.', 403);
    if (a.removed) fail('This applicant was removed. The application is kept only so the counts stay true.');
    if (a.status === 'withdrawn') fail('The applicant withdrew this application.');
  }
  route('GET', '/api/hris/recruitment/applications/:id/rating', 'hris', ({ params, user }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const access = openingForRater(user, a.openingId);
    return ratingView(a, access.o, user, access);
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/applications/:id/rating', 'hris', ({ params, body, user, ip, agent }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const access = openingForRater(user, a.openingId);
    const { o } = access;
    checkRateable(a, user);
    const tpl = templateFor(o) || fail('Choose a position category and an assessment template for this opening first: Edit the opening.');
    const { scores, sum } = cleanScores(tpl, a, body.scores);
    const slot = slotOf(o, user);
    const submit = body.submit !== false; // the HR office's rating is always submitted
    a.ratings = ratingsOf(a);
    const had = progressOf(a, o).submitted;
    const before = a.ratings.find((r) => r.slot === slot) || null;
    if (before?.submittedAt && !submit) fail('You have submitted this rating. Change the scores and submit it again.');
    const at = iso();
    freeze(o, tpl, user, at, { ip, agent });
    const next = {
      slot, by: user.name, byId: user.id, at, submittedAt: submit ? at : null, version: o.assessment.version, scores, total: sum.total, complete: sum.complete,
      history: before?.submittedAt ? [...(before.history || []), { total: before.total, by: before.by, at: before.submittedAt }].slice(-20) : before?.history || [],
    };
    a.ratings = [...a.ratings.filter((r) => r.slot !== slot), next];
    const action = before?.submittedAt ? 'Changed the rating of a job application' : submit ? 'Rated a job application' : before ? 'Changed a draft rating of a job application' : 'Saved a draft rating of a job application';
    ctx.audit({
      kind: 'change', system: 'people', action,
      actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent,
      detail: `${o.assessment.name}, version ${o.assessment.version} · ${slot === 'hr' ? 'for the HR office' : 'as a member of the selection board'}${submit ? '' : ' · draft, not counted yet'}`,
      changes: [...scoreChanges(tpl, before, scores), { field: 'Weighted total', from: before ? before.total : '', to: sum.total }],
    });
    recombine(a, o);
    // Everyone on the panel has rated: HR is told (once, when the last one submits).
    const p = progressOf(a, o);
    if (submit && !before?.submittedAt && panelOf(o).length > 1 && p.submitted === p.of && had < p.of) {
      h.toHr(o, { kind: 'job.rated', title: `All ${p.of} assessors have rated ${nameOf(a)}`, body: `${o.title}${p.rule === 'consensus' ? ' · enter the board consensus' : ''}`, link: `/hris/#/recruitment/${o.id}/rate/${a.id}` }, user.id);
    }
    refreshEntry(a.userId);
    save();
    return ratingView(a, o, user, access);
  }, { audit: false, body: { scores: t.any(), submit: t.bool() } });

  // Board consensus: the secretariat (HR) enters one agreed score per criterion; it is the result.
  route('PUT', '/api/hris/recruitment/applications/:id/consensus', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const a = applications().find((x) => x.id === params.id) || fail('Application not found.', 404);
    const o = openingForHr(user, a.openingId);
    checkRateable(a, user);
    const tpl = templateFor(o) || fail('Choose a position category and an assessment template for this opening first: Edit the opening.');
    if (tpl.combine !== 'consensus') fail(`This opening's template combines the ratings by ${combineLabel(tpl.combine).toLowerCase()}, not by board consensus.`);
    const { scores, sum } = cleanScores(tpl, a, body.scores);
    const at = iso();
    freeze(o, tpl, user, at, { ip, agent });
    const before = a.consensus || null;
    a.consensus = {
      by: user.name, byId: user.id, at, version: o.assessment.version, scores, total: sum.total, complete: sum.complete,
      history: before ? [...(before.history || []), { total: before.total, by: before.by, at: before.at }].slice(-20) : [],
    };
    const p = progressOf(a, o);
    ctx.audit({
      kind: 'change', system: 'people', action: before ? 'Changed the board consensus rating of a job application' : 'Entered the board consensus rating of a job application',
      actor: user, target: { id: a.id, name: `${nameOf(a)} · ${o.title}` }, ip, agent,
      detail: `${o.assessment.name}, version ${o.assessment.version} · ${p.submitted} of ${p.of} assessors had rated`,
      changes: [...scoreChanges(tpl, before, scores), { field: 'Weighted total (consensus)', from: before ? before.total : '', to: sum.total }],
    });
    recombine(a, o);
    refreshEntry(a.userId);
    save();
    return ratingView(a, o, user, { o, hr: true });
  }, { audit: false, body: { scores: t.any() } });

  // ----- The selection board (panel) of an opening -----
  const panelView = (o) => panelOf(o).map((p) => {
    const u = userById(p.userId);
    const rated = applications().filter((a) => a.openingId === o.id && ratingsOf(a).some((r) => r.slot === p.userId && r.submittedAt)).length;
    return { userId: p.userId, name: u?.name || 'Former account', title: p.title || '', role: u ? roleLabel(u.role) : '', active: mayAssess(u), addedAt: p.addedAt, addedBy: p.addedBy || '', rated };
  });
  const rateableApps = (o) => applications().filter((a) => a.openingId === o.id && !a.removed && a.status !== 'withdrawn');
  route('GET', '/api/hris/recruitment/assessors', 'hris:hris.recruitment', ({ query }) => {
    const q = String(query.q || '').trim().toLowerCase();
    const emp = (u) => (u.employeeId ? employeeById(u.employeeId) : null);
    return data().users.filter((u) => mayAssess(u) && (!q || [u.name, u.username, emp(u)?.position, emp(u)?.department].some((x) => String(x || '').toLowerCase().includes(q))))
      .sort((x, y) => x.name.localeCompare(y.name)).slice(0, 50)
      .map((u) => ({ id: u.id, name: u.name, role: roleLabel(u.role), position: emp(u)?.position || '', department: emp(u)?.department || u.department || '' }));
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/openings/:id/panel', 'hris:hris.recruitment', ({ params, body, user, ip, agent }) => {
    const o = openingForHr(user, params.id);
    const input = Array.isArray(body.assessors) ? body.assessors : fail('Send the list of assessors.');
    if (input.length > ASSESSMENT_LIMITS.panel) fail(`A selection board has at most ${ASSESSMENT_LIMITS.panel} assessors.`);
    const seen = new Set();
    const applied = new Set(applications().filter((a) => a.openingId === o.id && a.status !== 'withdrawn').map((a) => a.userId));
    const at = iso();
    const before = panelOf(o);
    const next = input.map((x) => {
      const u = userById(text(x?.userId, 100)) || fail('Pick each assessor from the list of accounts.', 404);
      if (seen.has(u.id)) fail(`${u.name} is on the list twice.`);
      seen.add(u.id);
      if (!mayAssess(u)) fail(`${u.name} cannot be an assessor: only active staff accounts can${u.access?.remove?.includes('hris.assess') ? ' (rating applicants was taken away from this account under Users & Access)' : ''}.`);
      if (applied.has(u.id)) fail(`${u.name} has applied for this opening, so cannot be on its selection board.`);
      const old = before.find((p) => p.userId === u.id);
      return { userId: u.id, title: text(x?.title, 80), addedAt: old?.addedAt || at, addedBy: old?.addedBy || user.name };
    });
    // Someone who has submitted ratings here stays on the board: their ratings are part of the result.
    for (const p of before) {
      if (seen.has(p.userId)) continue;
      const rated = applications().filter((a) => a.openingId === o.id && ratingsOf(a).some((r) => r.slot === p.userId && r.submittedAt)).length;
      if (rated) fail(`${nameOfUser(p.userId)} has rated ${rated} applicant${rated === 1 ? '' : 's'} here, so stays on the selection board: those ratings are part of the result.`);
    }
    const removed = before.filter((p) => !seen.has(p.userId));
    const added = next.filter((p) => !before.some((b) => b.userId === p.userId));
    // Drafts of those taken off the board go.
    for (const a of applications().filter((x) => x.openingId === o.id)) if (removed.some((p) => ratingsOf(a).some((r) => r.slot === p.userId))) a.ratings = ratingsOf(a).filter((r) => !removed.some((p) => p.userId === r.slot));
    o.panel = next;
    const titled = next.filter((p) => before.find((b) => b.userId === p.userId && (b.title || '') !== p.title));
    if (added.length || removed.length || titled.length) {
      ctx.audit({
        kind: 'change', system: 'people', action: 'Changed the selection board of a job opening', actor: user, target: { id: o.id, name: o.title }, ip, agent,
        detail: `${next.length} assessor${next.length === 1 ? '' : 's'}`,
        changes: [...added.map((p) => ({ field: 'Assessor added', from: '', to: `${nameOfUser(p.userId)}${p.title ? ` (${p.title})` : ''}` })), ...removed.map((p) => ({ field: 'Assessor removed', from: nameOfUser(p.userId), to: '' })), ...titled.map((p) => ({ field: `Title of ${nameOfUser(p.userId)}`, from: before.find((b) => b.userId === p.userId).title || '', to: p.title }))],
      });
    }
    const n = rateableApps(o).length;
    if (added.length) {
      ctx.notify(added.map((p) => p.userId), {
        system: 'hris', kind: 'assess.panel', title: `You are on the selection board for ${o.title}`,
        body: `${n ? `${n} applicant${n === 1 ? '' : 's'} to rate. ` : ''}Your ratings to do are under People → Ratings to do. Rate each applicant on your own; you do not see the other assessors' scores before you submit yours.`,
        link: `/hris/#/assess/${o.id}`,
      }, { actorId: user.id });
    }
    for (const a of applications().filter((x) => x.openingId === o.id)) if (removed.length) recombine(a, o);
    save();
    return { panel: panelView(o) };
  }, { audit: false, body: { assessors: t.arr(t.obj({ userId: t.str(100), title: t.str(200) }), 50) } });

  // ----- An assessor's own screens: Ratings to do, and one opening -----
  const myPanels = (user) => (mayAssess(user) ? openings().filter((o) => onPanel(o, user)) : []);
  function toDoAt(o, user) {
    const apps = rateableApps(o).filter((a) => a.userId !== user.id);
    const mine = apps.map((a) => ratingsOf(a).find((r) => r.slot === user.id));
    return { applicants: apps.length, submitted: mine.filter((r) => r?.submittedAt).length, drafts: mine.filter((r) => r && !r.submittedAt).length, toDo: mine.filter((r) => !r?.submittedAt).length };
  }
  function assessorSummary(user) {
    const list = myPanels(user);
    if (!list.length) return null;
    return { openings: list.length, toDo: list.reduce((n, o) => n + (o.status === 'draft' ? 0 : toDoAt(o, user).toDo), 0) };
  }
  route('GET', '/api/hris/assess', 'hris', ({ user }) => ({
    openings: myPanels(user).filter((o) => o.status !== 'draft').sort((x, y) => (x.status === y.status ? x.closingDate.localeCompare(y.closingDate) : x.status === 'closed' ? 1 : -1)).map((o) => {
      const tpl = templateFor(o);
      return {
        id: o.id, title: o.title, office: o.office || '', campusName: campusName(data(), o.campusId), closingDate: o.closingDate, status: o.status,
        templateName: tpl?.name || '', rule: tpl?.combine || DEFAULT_COMBINE, myTitle: panelOf(o).find((p) => p.userId === user.id)?.title || '', ...toDoAt(o, user),
      };
    }),
  }), { audit: false });
  route('GET', '/api/hris/assess/openings/:id', 'hris', ({ params, user }) => {
    const { o, hr } = openingForRater(user, params.id);
    const tpl = templateFor(o);
    const { ranks } = ranked(o);
    const show = cfg().board.assessorsSeeResult;
    return {
      opening: { id: o.id, title: o.title, office: o.office || '', campusName: campusName(data(), o.campusId), closingDate: o.closingDate, status: o.status, plantillaItem: o.plantillaItem || '', salaryGrade: o.salaryGrade || null, education: o.education, training: o.training, experience: o.experience, eligibility: o.eligibility },
      template: tpl, onPanel: onPanel(o, user), hr,
      panel: panelView(o).map(({ name, title, rated }) => ({ name, title, ...(hr ? { rated } : {}) })),
      applications: rateableApps(o).filter((a) => a.userId !== user.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt)).map((a) => {
        const mine = ratingsOf(a).find((r) => r.slot === slotOf(o, user));
        const emp = a.internal ? employeeById(a.employeeId) : null;
        return {
          id: a.id, name: nameOf(a), internal: a.internal, createdAt: a.createdAt, note: a.note || '', stageLabel: stageLabel(h.stages(), a.stage),
          position: emp ? emp.position || '' : '',
          mine: mine ? { submitted: Boolean(mine.submittedAt), total: mine.total, at: mine.submittedAt || mine.at } : null,
          combined: a.rating && ((hr && !(onPanel(o, user) && !mine?.submittedAt)) || (show && mine?.submittedAt)) ? { total: a.rating.total, rank: ranks.get(a.id) || null } : null,
          progress: progressOf(a, o),
          documents: h.documentsSummary ? h.documentsSummary(a, o) : null,
        };
      }),
    };
  }, { audit: false });

  // The comparative list of an opening: the combined result, ranked, a column per criterion, and
  // (HR only) each assessor's rating.
  route('GET', '/api/hris/recruitment/openings/:id/comparative', 'hris:hris.recruitment', ({ params, user }) => {
    const o = openingForHr(user, params.id);
    const tpl = templateFor(o);
    const { list, ranks } = ranked(o);
    // A board member's list leaves out the applicants they have not rated (and submitted) yet.
    const hidden = list.filter((a) => resultHidden(a, o, user)).length;
    const rows = list.filter((a) => !resultHidden(a, o, user)).map((a) => {
      const skip = skipSet(tpl?.criteria || [], a.internal);
      const sum = weightedTotal(tpl?.criteria || [], a.rating.scores, skip);
      return {
        id: a.id, rank: ranks.get(a.id), name: nameOf(a), internal: a.internal, removed: Boolean(a.removed), userId: a.removed ? null : a.userId,
        stageLabel: stageLabel(h.stages(), a.stage), status: a.status, skip: [...skip],
        scores: Object.fromEntries(Object.entries(a.rating.scores).map(([k, v]) => [k, v.score])), points: sum.points,
        total: a.rating.total, complete: a.rating.complete, by: a.rating.by, at: a.rating.at, rule: a.rating.rule || DEFAULT_COMBINE,
        progress: progressOf(a, o),
        assessors: breakdownOf(a, o, tpl, skip).filter((r) => !r.draft).map((r) => ({ slot: r.slot, name: r.name, title: r.title, total: r.total, complete: r.complete, submittedAt: r.submittedAt, scores: Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, v.score])) })),
        consensus: Boolean(a.consensus),
      };
    }).sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
    const active = applications().filter((a) => a.openingId === o.id && a.status !== 'withdrawn' && !a.removed);
    const waiting = active.filter((a) => !a.rating);
    // Signature lines: each assessor on the panel (and anyone else who rated for the HR office is the secretariat).
    return {
      opening: { id: o.id, title: o.title, plantillaItem: o.plantillaItem || '', salaryGrade: o.salaryGrade || null, office: o.office || '', campusName: campusName(data(), o.campusId), vacancies: o.vacancies, closingDate: o.closingDate, status: o.status, categoryLabel: categoryLabel(o.categoryId) },
      template: tpl, rule: tpl?.combine || DEFAULT_COMBINE, rows, unrated: waiting.length, hiddenUntilRated: hidden,
      awaitingConsensus: tpl?.combine === 'consensus' ? waiting.filter((a) => ratingsOf(a).some((r) => r.submittedAt)).length : 0,
      panel: panelView(o).map(({ userId, name, title }) => ({ slot: userId, name, title })),
      print: { ...cfg().print },
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
      print: { ...c.print }, board: { ...DEFAULT_BOARD, ...(c.board || {}) },
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
        if (c?.type !== 'performance') return { id: cid, label: cl, description, weight };
        return { id: cid, label: cl, description, weight, type: 'performance', ...cleanTable(name, cl, c, now.templates.find((y) => y.id === text(x?.id, 60))?.criteria.find((y) => y.id === cid)) };
      });
      if (criteria.filter((c) => c.type === 'performance').length > 1) fail(`${name}: at most one Performance rating criterion.`);
      const problem = weightProblem({ name, criteria });
      if (problem) fail(problem);
      const combine = x?.combine === undefined ? (now.templates.find((y) => y.id === id)?.combine || DEFAULT_COMBINE) : String(x.combine);
      if (!COMBINE_RULES.some(([k]) => k === combine)) fail(`${name}: pick how the assessors' ratings are combined.`);
      const old = now.templates.find((y) => y.id === id);
      const sameCriteria = old && JSON.stringify(old.criteria) === JSON.stringify(criteria);
      const same = sameCriteria && (old.combine || DEFAULT_COMBINE) === combine;
      const changed = !old || !same || old.name !== name || old.categoryId !== categoryId || Boolean(old.retired) !== (x.retired === true);
      return {
        id, name, categoryId, version: old ? (same ? old.version : old.version + 1) : 1, combine, criteria,
        // An example stays marked as one until its criteria are changed (not only its rule): then it is the school's own.
        ...(old?.example && sameCriteria ? { example: true } : !old && x.example === true ? { example: true } : {}),
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
    const print = {
      title: caption(p.title, now.print.title) || DEFAULT_ASSESSMENT.print.title, signCaption: caption(p.signCaption, now.print.signCaption), signName: caption(p.signName, now.print.signName), signTitle: caption(p.signTitle, now.print.signTitle),
      boardCaption: caption(p.boardCaption, now.print.boardCaption), memberTitle: caption(p.memberTitle, now.print.memberTitle),
    };
    // The selection board's options.
    const b = body.board && typeof body.board === 'object' ? body.board : now.board;
    const board = { assessorsSeeResult: b.assessorsSeeResult === undefined ? Boolean(now.board?.assessorsSeeResult ?? DEFAULT_BOARD.assessorsSeeResult) : b.assessorsSeeResult === true };
    return { categories, templates, print, board };
  }
  // The performance rating's adjectival table (each rating and what it counts for, 0 to 100) and the
  // rule for external applicants. The built-in table is an example until it is changed.
  function cleanTable(tplName, label, c, old) {
    const L = ASSESSMENT_LIMITS;
    const rows = Array.isArray(c.table) ? c.table : DEFAULT_ADJECTIVAL;
    if (!rows.length) fail(`${tplName}, ${label}: list at least one adjectival rating.`);
    if (rows.length > L.table) fail(`${tplName}, ${label}: at most ${L.table} adjectival ratings.`);
    const seen = new Set();
    const table = rows.map((r) => {
      const l = text(r?.label, 200);
      if (!l) fail(`${tplName}, ${label}: every adjectival rating needs a name.`);
      if (l.length > L.label) fail(`${tplName}, ${label}: ${l.slice(0, 30)}… has more than ${L.label} characters.`);
      if (seen.has(l.toLowerCase())) fail(`${tplName}, ${label}: ${l} is listed twice.`);
      seen.add(l.toLowerCase());
      const n = Number(r?.score);
      if (r?.score === '' || r?.score == null || !Number.isFinite(n) || n < 0 || n > 100 || !twoDecimals(n)) fail(`${tplName}, ${label}: ${l} must count for 0 to 100, with at most two decimals.`);
      return { label: l, score: n };
    });
    const external = c.external === undefined ? 'spread' : String(c.external);
    if (!EXTERNAL_RULES.some(([k]) => k === external)) fail(`${tplName}, ${label}: pick what external applicants get.`);
    const asDefault = JSON.stringify(table) === JSON.stringify(DEFAULT_ADJECTIVAL);
    const example = asDefault && (!old || old.tableExample || c.tableExample === true);
    return { table, ...(example ? { tableExample: true } : {}), external };
  }
  route('GET', '/api/hris/recruitment/assessment', 'hris', ({ user }) => {
    if (!userCan(user, 'hris.recruitment') && !userCan(user, 'hris.settings')) fail('You do not have access to this.', 403);
    return { ...assessmentView(), defaults: DEFAULT_ASSESSMENT };
  }, { audit: false });
  route('PUT', '/api/hris/recruitment/assessment', 'hris:hris.settings', ({ body, user }) => {
    data().settings.assessment = cleanAssessment(body, user);
    save();
    return assessmentView();
  }, { body: { categories: t.any(), templates: t.any(), print: t.any(), board: t.any() } });

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
    h.onLeftPool?.(e.userId, why); // the pool keeps no files: those of applications that ended go
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
    const bare = (r) => r && (r.scores = Object.fromEntries(Object.entries(r.scores || {}).map(([k, v]) => [k, { score: v.score }])));
    for (const a of applications().filter((x) => x.userId === u.id)) {
      bare(a.rating);
      bare(a.consensus);
      ratingsOf(a).forEach(bare);
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
          rating: withRatings && a.rating && !resultHidden(a, o, user) ? {
            ...ratingOf(a.rating, tpl, skipSet(tpl?.criteria || [], a.internal)), rank: o ? ranksAt(o).get(a.id) || null : null, criteria: tpl?.criteria || [], templateName: tpl?.name || '',
            rule: a.rating.rule || DEFAULT_COMBINE, skip: [...skipSet(tpl?.criteria || [], a.internal)],
            assessors: o ? breakdownOf(a, o, tpl, skipSet(tpl?.criteria || [], a.internal)).filter((r) => !r.draft).map((r) => ({ name: r.name, title: r.title, total: r.total, submittedAt: r.submittedAt })) : [],
          } : null,
          rated: Boolean(a.rating),
          documents: h.profileDocuments ? h.profileDocuments(a, o) : [],
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
    cleanOpeningAssessment, openingAssessment, ranksAt, resultHidden, ratingSummary: (a, ranks) => (a.rating ? { total: a.rating.total, complete: a.rating.complete, rank: ranks.get(a.id) || null, by: a.rating.by, at: a.rating.at, rule: a.rating.rule || DEFAULT_COMBINE } : null),
    progressOf, openingForRater, onPanel, mayAssess, assessorSummary, panelOf,
    onDecided, onUndecided, onRemoveApplicant, sweepPool, poolSelf, optIn, entryOf, educationLabel,
  };
}

// ----- Demo data: ratings on the demo openings, a selection board, and people in the pool -----
// Called from addRecruitmentDemo once the applications exist. rate: [[application, scores in the
// template's order (null: not yet), rater, days ago, rater's id]] (the HR office's rating);
// panel: { opening, members: [[user, title]], ratings: [[application, user, scores, days ago, submitted]] };
// pooled: [[user, days ago they entered]].
export function addAssessmentDemo(data, { now, rate, panel = null, pooled, stagesCfg, months = 12 }) {
  data.applicantPool ||= [];
  const settings = mergeAssessment(data.settings?.assessment);
  const tplOf = (o) => settings.templates.find((x) => x.id === o?.templateId);
  const freeze = (o, tpl, by, daysAgo) => {
    o.assessment ||= {
      templateId: tpl.id, name: tpl.name, version: tpl.version, example: Boolean(tpl.example), combine: tpl.combine || DEFAULT_COMBINE, categoryId: o.categoryId,
      categoryLabel: settings.categories.find((c) => c.id === o.categoryId)?.label || '', criteria: structuredClone(tpl.criteria),
      frozenAt: new Date(now - (daysAgo + 1) * DAY_MS).toISOString(), frozenBy: by,
    };
  };
  const scoresOf = (tpl, scores) => Object.fromEntries(tpl.criteria.map((c, i) => [c.id, { score: scores[i] ?? null }]).filter(([, v]) => v.score !== null));
  const combine = (a, o) => {
    const tpl = o.assessment;
    const skip = skipSet(tpl.criteria, a.internal);
    const c = combineRating(tpl.criteria, a.ratings, tpl.combine, a.consensus, skip);
    const sub = a.ratings.filter((r) => r.submittedAt);
    a.rating = c ? {
      version: tpl.version, templateId: tpl.templateId, rule: tpl.combine, scores: sub.length === 1 ? structuredClone(sub[0].scores) : c.scores, total: c.total, complete: c.complete, count: c.count,
      by: sub.length === 1 ? sub[0].by : `${sub.length} assessors`, byId: sub.length === 1 ? sub[0].byId : null, at: sub.map((r) => r.submittedAt).sort().at(-1), history: [],
    } : null;
  };
  for (const [a, scores, by, daysAgo, byId = null] of rate) {
    const o = data.jobOpenings.find((x) => x.id === a.openingId);
    const tpl = tplOf(o);
    if (!tpl) continue;
    freeze(o, tpl, by, daysAgo);
    const s = scoresOf(tpl, scores);
    const sum = weightedTotal(tpl.criteria, s);
    const at = new Date(now - daysAgo * DAY_MS).toISOString();
    a.ratings = [{ slot: 'hr', by, byId, at, submittedAt: at, version: tpl.version, scores: s, total: sum.total, complete: sum.complete, history: [] }];
    combine(a, o);
  }
  // The selection board: three assessors on one opening, each with their own ratings (one still a draft).
  if (panel?.opening) {
    const o = panel.opening;
    const tpl = tplOf(o);
    o.panel = panel.members.filter(([u]) => u).map(([u, title]) => ({ userId: u.id, title, addedAt: new Date(now - 6 * DAY_MS).toISOString(), addedBy: panel.by, demo: true }));
    for (const [a, u, scores, daysAgo, submitted] of panel.ratings) {
      if (!tpl || !u) continue;
      freeze(o, tpl, panel.by, daysAgo);
      const s = scoresOf(tpl, scores);
      const sum = weightedTotal(tpl.criteria, s);
      const at = new Date(now - daysAgo * DAY_MS).toISOString();
      a.ratings = [...(a.ratings || []).filter((r) => r.slot !== u.id), { slot: u.id, by: u.name, byId: u.id, at, submittedAt: submitted ? at : null, version: tpl.version, scores: s, total: sum.total, complete: sum.complete, history: [] }];
      combine(a, o);
    }
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
