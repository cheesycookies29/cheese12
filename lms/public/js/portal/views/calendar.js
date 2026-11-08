// Learn → Calendar: a student's or teacher's classes, due dates, exams, holidays, school events and
// term dates; for parents & guardians, each linked student's (public/js/calendar-ui.js).
import { ctx } from '../../shell.js';
import { calendarScreen } from '../../calendar-ui.js';

export function calendarView(el, params, query) {
  const role = ctx.user.role;
  return calendarScreen(el, {
    title: role === 'guardian' ? 'School calendar' : 'Calendar',
    subtitle: role === 'guardian' ? 'Your students\' classes and due dates, as far as each link allows, with holidays, exams and school events.'
      : role === 'teacher' ? 'Your sections\' meetings and due dates, with holidays, exams, school events and term dates.'
        : 'Your classes and what is due, with holidays, exams, school events and term dates.',
    endpoint: '/api/calendar',
    query,
    hashBase: '#/calendar',
    subscribe: true,
  });
}
