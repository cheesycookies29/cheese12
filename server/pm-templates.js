// Starter project templates: three typical projects (a client implementation, a government
// contract paid by deliverables, an internal IT project) that "+ New project" can start from.
// They are made once per database by migratePm (and again after "Erase all data"), coded TPL-0001
// and up so they never take a project code, and are ordinary templates afterwards: a Project
// Manager can change or delete them, and a deleted one is not made again. Demo data adds any that
// are missing, tagged as demo records.
//
// Dates are in working days from the template's start; "+ New project" moves them to the new
// project's start in working days too (shared/projects.js shiftWorkDays).
import { randomUUID } from 'node:crypto';
import { localDate } from './util.js';
import { DEFAULT_STATUSES, workCalendar, weekStart, addWorkDays, firstStatus, RANK_STEP } from '../shared/projects.js';

// [name, working day due, deliverable, billing %]
// [ref, title, milestone index (null: none, or the parent's), start, due, size (XS to XL), extra]
const STARTERS = [
  {
    starter: 'client-implementation', name: 'Client implementation', type: 'Client', days: 95,
    description: 'Starter template: a system implementation for a client, from kick-off to hypercare. Billing: 20% on requirements sign-off, 30% on UAT, 50% on acceptance. Change it to suit your team; new projects copy it.',
    milestones: [
      ['Kick-off and project plan', 5, false],
      ['Requirements sign-off', 20, true, 20],
      ['Build complete', 50, false],
      ['User acceptance testing passed', 65, true, 30],
      ['Go-live and acceptance', 75, true, 50],
      ['Hypercare ends', 95, false],
    ],
    tasks: [
      ['kick', 'Kick-off meeting with the client', 0, 0, 1, 'S', { checklist: ['Agenda and attendees', 'Introduce the teams and contacts', 'Agree the meeting schedule'] }],
      ['plan', 'Project plan and schedule', 0, 1, 5, 'S', { blockedBy: ['kick'] }],
      ['workshops', 'Requirements workshops', 1, 6, 14, 'M'],
      ['spec', 'Requirements document', 1, 10, 18, 'M', { blockedBy: ['workshops'] }],
      ['signoff', 'Requirements sign-off by the client', 1, 18, 20, 'XS', { blockedBy: ['spec'], priority: 'high' }],
      ['env', 'Set up the test and production environments', 2, 15, 25, 'M'],
      ['build', 'Configure and build', 2, 21, 48, null],
      ['b1', 'Set-up and master data', null, 21, 30, 'L', { parent: 'build' }],
      ['b2', 'Workflows and reports', null, 28, 42, 'XL', { parent: 'build' }],
      ['b3', 'Integrations and data migration', null, 35, 48, 'L', { parent: 'build' }],
      ['scripts', 'UAT test scripts', 3, 40, 50, 'M'],
      ['uat', 'UAT sessions with the client', 3, 51, 60, 'M', { blockedBy: ['build', 'scripts'] }],
      ['fixes', 'Fix the UAT findings', 3, 56, 64, 'M'],
      ['training', 'Train the client\'s users', 4, 62, 70, 'M', { checklist: ['Training manual', 'Book the venue', 'Attendance sheets'] }],
      ['golive', 'Go-live cut-over', 4, 72, 73, 'S', { priority: 'high', blockedBy: ['uat'], checklist: ['Go/no-go meeting', 'Final data migration', 'Announce the go-live'] }],
      ['accept', 'Certificate of acceptance signed', 4, 74, 75, 'XS'],
      ['hyper', 'Hypercare: daily check-ins with the client', 5, 76, 95, 'M'],
      ['close', 'Close-out report and handover to support', 5, 90, 95, 'S'],
    ],
  },
  {
    starter: 'government-contract', name: 'Government contract (with deliverables)', type: 'Government', days: 180,
    description: 'Starter template: a government contract paid by deliverables under the terms of reference, from the notice to proceed to the end of the warranty. Set each deliverable\'s name, date and billing % from the contract.',
    milestones: [
      ['Inception report accepted', 15, true, 15],
      ['Deliverable 1', 45, true, 25],
      ['Deliverable 2', 75, true, 25],
      ['Deliverable 3', 105, true, 20],
      ['Final acceptance', 120, true, 15],
      ['Warranty period ends', 180, false],
    ],
    tasks: [
      ['ntp', 'Notice to proceed received', 0, 0, 0, 'XS', { checklist: ['Notice of award', 'Contract signed', 'Performance security posted', 'Notice to proceed'] }],
      ['kick', 'Kick-off with the agency\'s project team', 0, 1, 3, 'S', { blockedBy: ['ntp'] }],
      ['inception', 'Write the inception report and work plan', 0, 3, 12, 'M', { blockedBy: ['kick'] }],
      ['sub0', 'Submit the inception report', 0, 13, 15, 'XS', { blockedBy: ['inception'], priority: 'high' }],
      ['d1', 'Work for deliverable 1', 1, 16, 42, 'XL'],
      ['sub1', 'Submit deliverable 1 with the acceptance form', 1, 43, 45, 'XS', { blockedBy: ['d1'] }],
      ['d2', 'Work for deliverable 2', 2, 46, 72, 'XL'],
      ['sub2', 'Submit deliverable 2 with the acceptance form', 2, 73, 75, 'XS', { blockedBy: ['d2'] }],
      ['d3', 'Work for deliverable 3', 3, 76, 102, 'XL'],
      ['sub3', 'Submit deliverable 3 with the acceptance form', 3, 103, 105, 'XS', { blockedBy: ['d3'] }],
      ['final', 'Final report and turnover documents', 4, 106, 118, 'M', { checklist: ['As-built documents', 'Training records', 'Turnover of accounts and passwords'] }],
      ['inspect', 'Inspection and acceptance committee visit', 4, 118, 120, 'S', { priority: 'high', blockedBy: ['final'] }],
      ['billing', 'Bill each accepted deliverable', null, 15, 120, 'S', { checklist: ['Inception report', 'Deliverable 1', 'Deliverable 2', 'Deliverable 3', 'Final acceptance'] }],
      ['warranty', 'Warranty support: respond to the agency\'s reports', 5, 121, 180, 'M'],
    ],
  },
  {
    starter: 'internal-it', name: 'Internal IT project', type: 'Internal', days: 40,
    description: 'Starter template: an internal IT project such as new equipment or a system rollout, from the plan to the close-out.',
    milestones: [
      ['Plan approved', 5, false],
      ['Equipment and licences ready', 20, false],
      ['Rollout done', 35, false],
      ['Closed out', 40, false],
    ],
    tasks: [
      ['scope', 'Scope, budget and schedule', 0, 0, 3, 'S'],
      ['approve', 'Approval from management', 0, 3, 5, 'XS', { blockedBy: ['scope'] }],
      ['quotes', 'Get three quotes and the purchase approval', 1, 5, 12, 'S', { blockedBy: ['approve'] }],
      ['order', 'Order and receive the equipment', 1, 12, 20, 'XS', { blockedBy: ['quotes'] }],
      ['assets', 'Record the equipment in IT Assets', 1, 18, 20, 'XS'],
      ['pilot', 'Pilot with one team', 2, 21, 25, 'S', { blockedBy: ['order'] }],
      ['rollout', 'Roll out to everyone', 2, 26, 35, 'M', { checklist: ['Schedule after office hours', 'Back up first', 'Tell the users what changes'] }],
      ['docs', 'Update the documentation and diagrams', 3, 34, 38, 'S'],
      ['lessons', 'Lessons learned and close-out', 3, 38, 40, 'XS'],
    ],
  },
];
export const STARTER_KEYS = STARTERS.map((s) => s.starter);

// The next template code: TPL-0001, TPL-0002…
const nextCode = (projects) => `TPL-${String(projects.reduce((n, p) => Math.max(n, Number(String(p.code || '').match(/^TPL-(\d+)$/)?.[1] || 0)), 0) + 1).padStart(4, '0')}`;

// Adds the starter templates not in `data` yet (by their starter key). `demo` tags them as demo
// records. Returns how many were added.
export function addStarterTemplates(data, { demo = false } = {}) {
  const cal = workCalendar(data.settings || {}, data.holidays || []);
  const start = weekStart(localDate());
  const at = new Date().toISOString();
  const statuses = Array.isArray(data.pm?.statuses) && data.pm.statuses.length ? data.pm.statuses : DEFAULT_STATUSES;
  let added = 0;
  for (const s of STARTERS) {
    if (data.pmProjects.some((p) => p.starter === s.starter)) continue;
    const wd = (n) => addWorkDays(start, n, cal);
    const tag = demo ? { demo: true } : {};
    const p = {
      id: randomUUID(), code: nextCode(data.pmProjects), name: s.name, type: s.type, description: s.description, status: 'planning',
      startDate: start, endDate: wd(s.days), managerId: null, timeTracking: false, budgetHours: null, accountId: null, dealId: null, contractId: null,
      members: [], statuses: structuredClone(statuses), healthOverride: null, taskSeq: 0, version: 1, isTemplate: true, starter: s.starter,
      createdAt: at, createdBy: null, updatedAt: at, updatedBy: null, history: [{ at, by: null, field: 'created', from: '', to: 'starter template' }], ...tag,
    };
    data.pmProjects.push(p);
    const msIds = s.milestones.map(([name, due, deliverable, billingPercent], i) => {
      const m = { id: randomUUID(), projectId: p.id, name, dueDate: wd(due), deliverable, billingPercent: billingPercent ?? null, submittedAt: null, acceptedAt: null, acceptanceNote: '', order: i, version: 1, createdAt: at, updatedAt: at, ...tag };
      data.pmMilestones.push(m);
      return m.id;
    });
    const todo = firstStatus(p.statuses, 'todo')?.id || p.statuses[0].id;
    const byRef = {};
    s.tasks.forEach(([ref, title, mi, from, to, size, extra = {}], i) => {
      const t = {
        id: randomUUID(), projectId: p.id, key: `${p.code}-${++p.taskSeq}`, title, description: '', statusId: todo, priority: extra.priority || 'normal',
        assigneeId: null, startDate: wd(from), dueDate: wd(to), size: size ?? null, milestoneId: mi == null ? null : msIds[mi],
        parentId: extra.parent ? byRef[extra.parent].id : null, checklist: (extra.checklist || []).map((text) => ({ id: randomUUID(), text, done: false })),
        blockedBy: (extra.blockedBy || []).map((r) => byRef[r].id), ticketId: null, rank: (i + 1) * RANK_STEP, completedAt: null, watchers: [],
        version: 1, createdAt: at, createdBy: null, updatedAt: at, updatedBy: null, history: [{ at, by: null, field: 'created', from: '', to: '' }], ...tag,
      };
      byRef[ref] = t;
      data.pmTasks.push(t);
    });
    added++;
  }
  return added;
}
