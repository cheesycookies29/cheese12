// Clock-in geotagging in the browser: reading the device location for a clock-in,
// and showing a recorded location to HR and administrators.
import { html, modal, badge } from './ui.js';
import { ctx } from './state.js';
import { LOCATION_STATUS, CLOCK_SOURCES, fmtDistance, hasOffice } from '/shared/geo.js';

// Resolves to { location: { lat, lng, accuracy } } or { locationError }; never rejects,
// so a missing location never stops anyone from clocking in.
export function readClockLocation() {
  if (!window.isSecureContext) return Promise.resolve({ locationError: 'insecure' });
  if (!navigator.geolocation) return Promise.resolve({ locationError: 'unsupported' });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ location: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (err) => resolve({ locationError: { 1: 'denied', 2: 'unavailable', 3: 'timeout' }[err.code] || 'unavailable' }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}

export const LOCATION_NOTICE = 'Your location is recorded when you clock in. Only HR and administrators can see it.';

// Short label for a recorded clock-in location: inside / outside the office, remote day, or why there is none.
export function locationPill(loc, { remote = false } = {}) {
  if (!loc) return html`<span class="muted small">—</span>`;
  if (loc.status !== 'ok') return html`<span class="geo-pill none" title="${LOCATION_STATUS[loc.status]}">No location</span>`;
  const dist = loc.distance == null ? '' : ` · ${fmtDistance(loc.distance)}`;
  if (loc.inside == null) return html`<span class="geo-pill ok">📍 Recorded</span>`;
  if (loc.inside) return html`<span class="geo-pill ok">📍 ${ctx.settings.location?.officeLabel || 'Office'}${dist}</span>`;
  return remote ? html`<span class="geo-pill remote">📍 Remote day${dist}</span>` : html`<span class="geo-pill out">📍 Outside office${dist}</span>`;
}

const mapUrl = (lat, lng) => {
  const d = 0.004;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
};

// Map and details of one clock-in. who: { name, date, timeIn, remote }.
export function openLocation(loc, who) {
  const office = ctx.settings.location || {};
  const when = new Date(loc.at).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const rows = [
    ['Recorded', when],
    ['Clocked in from', CLOCK_SOURCES[loc.source] || '—'],
    ...(loc.status === 'ok'
      ? [
          ['Coordinates', html`<span class="mono">${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}</span>`],
          ['Accuracy', loc.accuracy ? `± ${fmtDistance(loc.accuracy)}` : '—'],
          ['Distance from office', hasOffice(office) && loc.distance != null ? html`${fmtDistance(loc.distance)} ${loc.inside ? badge('Within radius', 'green') : who.remote ? badge('Remote day', 'blue') : badge('Outside radius', 'amber')}` : 'No office location set'],
        ]
      : [['Status', LOCATION_STATUS[loc.status]]]),
  ];
  modal({
    title: 'Clock-in location',
    subtitle: `${who.name} · ${who.date}${who.timeIn ? ` · in at ${who.timeIn}` : ''}`,
    submitLabel: null,
    wide: true,
    body: html`${loc.status === 'ok'
        ? html`<iframe class="geo-map" src="${mapUrl(loc.lat, loc.lng)}" title="Map of the clock-in location" loading="lazy" referrerpolicy="no-referrer"></iframe>
            <p class="small geo-links"><a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" rel="noopener">Open in Google Maps</a> · <a href="https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=18/${loc.lat}/${loc.lng}" target="_blank" rel="noopener">OpenStreetMap</a></p>`
        : html`<div class="notice"><p>No location was recorded for this clock-in: ${LOCATION_STATUS[loc.status].toLowerCase()}.</p></div>`}
      <dl class="fb-meta">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`,
  });
}
