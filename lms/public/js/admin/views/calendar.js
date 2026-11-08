// Admin panel → School calendar: the campus's school events, holidays and exams, with the term dates,
// on a month, week or list calendar. Pick a day to add an event on it; pick an event to change it.
import { api } from '../../api.js';
import { toast } from '../../ui.js';
import { ctx } from '../../shell.js';
import { can } from '/shared/roles.js';
import { calendarScreen } from '../../calendar-ui.js';
import { eventDialog } from './news.js';

export function schoolCalendarView(el, params, query) {
  const edit = can(ctx.user.role, 'news.manage');
  return calendarScreen(el, {
    title: 'School calendar',
    subtitle: `School events, holidays and exams at ${ctx.info.campusName || 'this campus'}, with the term dates. Students, teachers and parents see them on their own calendars, with their classes and due dates.`,
    endpoint: '/api/admin/calendar',
    query,
    hashBase: '#/calendar',
    admin: edit ? {
      onAdd: (date, done) => eventDialog(null, done, { date }),
      onEdit: async (entry, done) => {
        const events = await api.get('/api/admin/events');
        const ev = events.find((x) => x.id === entry.eventId);
        if (!ev) return toast('That event is no longer there.', 'error');
        eventDialog(ev, done);
      },
      onDelete: async (entry) => {
        await api.del(`/api/admin/events/${entry.eventId}`);
        toast('Event deleted.');
      },
    } : null,
  });
}
