// Philippine holidays and how a day is classified for pay. Shared by the server (payroll, leave
// day counts) and the browser (DTR badges, the Holidays page), so no Node or DOM APIs here.
//
// Holidays are proclaimed each year by the President (regular holidays are also fixed by law,
// RA 9492 as amended). Eid'l Fitr and Eid'l Adha are proclaimed separately once their dates are
// known, and cities declare local holidays, so HR adds those on the Holidays page.

export const HOLIDAY_TYPES = {
  regular: 'Regular holiday',
  special: 'Special non-working day',
  'special-working': 'Special working day',
};

// Holidays that are days off. A special working day is an ordinary working day for pay.
export const isDayOff = (h) => h.type === 'regular' || h.type === 'special';

// National holidays per year, as proclaimed. HR loads a year from the Holidays page and can edit it.
export const PH_HOLIDAYS = {
  2026: {
    basis: 'Proclamation No. 1006, s. 2025',
    days: [
      ['2026-01-01', "New Year's Day", 'regular'],
      ['2026-02-17', 'Chinese New Year', 'special'],
      ['2026-02-25', 'EDSA People Power Revolution Anniversary', 'special-working'],
      ['2026-04-02', 'Maundy Thursday', 'regular'],
      ['2026-04-03', 'Good Friday', 'regular'],
      ['2026-04-04', 'Black Saturday', 'special'],
      ['2026-04-09', 'Araw ng Kagitingan', 'regular'],
      ['2026-05-01', 'Labor Day', 'regular'],
      ['2026-06-12', 'Independence Day', 'regular'],
      ['2026-08-21', 'Ninoy Aquino Day', 'special'],
      ['2026-08-31', 'National Heroes Day', 'regular'],
      ['2026-11-01', "All Saints' Day", 'special'],
      ['2026-11-02', "All Souls' Day", 'special'],
      ['2026-11-30', 'Bonifacio Day', 'regular'],
      ['2026-12-08', 'Feast of the Immaculate Conception of Mary', 'special'],
      ['2026-12-24', 'Christmas Eve', 'special'],
      ['2026-12-25', 'Christmas Day', 'regular'],
      ['2026-12-30', 'Rizal Day', 'regular'],
      ['2026-12-31', 'Last Day of the Year', 'special'],
    ],
  },
  2027: {
    basis: 'Proclamation No. 1427, s. 2026',
    days: [
      ['2027-01-01', "New Year's Day", 'regular'],
      ['2027-02-06', 'Chinese New Year', 'special'],
      ['2027-02-25', 'EDSA People Power Revolution Anniversary', 'special-working'],
      ['2027-03-25', 'Maundy Thursday', 'regular'],
      ['2027-03-26', 'Good Friday', 'regular'],
      ['2027-03-27', 'Black Saturday', 'special'],
      ['2027-04-09', 'Araw ng Kagitingan', 'regular'],
      ['2027-05-01', 'Labor Day', 'regular'],
      ['2027-06-12', 'Independence Day', 'regular'],
      ['2027-08-21', 'Ninoy Aquino Day', 'special'],
      ['2027-08-30', 'National Heroes Day', 'regular'],
      ['2027-11-01', "All Saints' Day", 'special'],
      ['2027-11-02', "All Souls' Day", 'special'],
      ['2027-11-30', 'Bonifacio Day', 'regular'],
      ['2027-12-08', 'Feast of the Immaculate Conception of Mary', 'special'],
      ['2027-12-24', 'Christmas Eve', 'special'],
      ['2027-12-25', 'Christmas Day', 'regular'],
      ['2027-12-30', 'Rizal Day', 'regular'],
      ['2027-12-31', 'Last Day of the Year', 'special'],
    ],
  },
};

export const presetYears = () => Object.keys(PH_HOLIDAYS).map(Number);

// The proclaimed list for a year as holiday records (without ids).
export function presetHolidays(year) {
  const p = PH_HOLIDAYS[year];
  if (!p) return [];
  return p.days.map(([date, name, type]) => ({ date, name, type, scope: 'national', basis: p.basis }));
}

// How a date counts for pay, from the holidays on it and whether it is a scheduled work day.
// Two regular holidays on one date (for example Araw ng Kagitingan on Maundy Thursday) make a
// double holiday; a regular holiday and a special day on one date count as the regular holiday.
export const DAY_TYPES = {
  ordinary: 'Ordinary working day',
  rest: 'Rest day',
  special: 'Special non-working day',
  specialRest: 'Special day on a rest day',
  regular: 'Regular holiday',
  regularRest: 'Regular holiday on a rest day',
  double: 'Double regular holiday',
  doubleRest: 'Double holiday on a rest day',
};

export function dayTypeFor(holidaysOnDate = [], scheduled = true) {
  const regular = holidaysOnDate.filter((h) => h.type === 'regular').length;
  const special = holidaysOnDate.some((h) => h.type === 'special');
  const base = regular >= 2 ? 'double' : regular === 1 ? 'regular' : special ? 'special' : null;
  if (!base) return scheduled ? 'ordinary' : 'rest';
  return scheduled ? base : `${base}Rest`;
}

// Regular holidays on a date (0, 1 or 2): each is a full day's pay even when not worked.
export const regularCount = (holidaysOnDate = []) => holidaysOnDate.filter((h) => h.type === 'regular').length;

// Holidays grouped by date, for quick lookup.
export function holidayIndex(holidays = []) {
  const map = new Map();
  for (const h of holidays) {
    if (!map.has(h.date)) map.set(h.date, []);
    map.get(h.date).push(h);
  }
  return map;
}
