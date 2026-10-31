// Helpers shared by learning-portal views.
import { html } from '../ui.js';
import { ctx } from '../shell.js';

// Is this module switched on for the signed-in user's account type?
export const has = (module) => Boolean(ctx.info?.modules?.includes(module));
export const isTeacher = () => ctx.user?.role === 'teacher';

export const classLabel = (c) => `${c.course.code} ${c.name}`;
export const classTitle = (c) => html`<strong>${c.course.code} ${c.name}</strong><small>${c.course.title}</small>`;

export function seatText(s) {
  const free = s.capacity - s.taken;
  return free > 0 ? `${free} of ${s.capacity} seats left` : `Full${s.waitlisted ? ` · ${s.waitlisted} waiting` : ''}`;
}

export const gradeText = (finalGrade, passed) => (finalGrade == null ? '—' : html`<strong>${finalGrade}</strong> <span class="badge ${passed ? 'green' : 'red'}">${passed ? 'Passed' : 'Failed'}</span>`);
