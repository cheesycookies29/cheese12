// CUSTOM APP → events: the counts on Event control and My queue (invited, checked in, not yet arrived,
// waiting for a table, seated, reserved, seats left). Recounted from the guests every time, never
// stored; every claim counts toward a table whatever its status (shared/customapp/seating.js).
import { isConfirmed, isReserved } from '../../../shared/customapp/seating.js';

export function eventCounts(state) {
  const guests = state.guests.filter((g) => g.active !== false);
  const capacity = state.tables.filter((t) => t.active).reduce((n, t) => n + t.capacity, 0);
  const claims = state.guests.filter((g) => g.seat).length;
  const here = guests.filter((g) => g.arrival?.state === 'checked_in');
  return {
    invited: guests.length, checkedIn: here.length, notArrived: guests.filter((g) => g.arrival?.state === 'expected').length,
    waiting: here.filter((g) => !g.seat).length, seated: guests.filter((g) => isConfirmed(g.seat)).length, reserved: guests.filter((g) => isReserved(g.seat)).length,
    capacity, seatsLeft: Math.max(0, capacity - claims), released: guests.filter((g) => g.released && !g.seat).length,
  };
}
