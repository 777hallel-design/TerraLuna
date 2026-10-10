// iCalendar (RFC 5545) export, shared by the app and scripts/build-ics.mjs.
import { ELEMENTS, GLYPHS } from './core.js';
import { STRINGS } from './i18n.js';

const utcStamp = (unix) => new Date(unix * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

// Lines longer than 75 octets are folded; never split a UTF-8 character.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * @param {object} model   from buildModel
 * @param {object} o       {from, to, lang, elements: string[], unfavorable: bool, name, stamp}
 */
export function buildICS(model, o) {
  const t = STRINGS[o.lang || 'he'];
  const elements = new Set(o.elements ?? Object.keys(ELEMENTS));
  const stamp = utcStamp(o.stamp ?? Math.floor(Date.now() / 1000));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TerraLuna//Biodynamic calendar//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(o.name || `${t.appName} – ${t.tagline}`)}`,
    `X-WR-CALDESC:${esc(t.tagline)}`, 'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D',
  ];
  const event = (uid, start, end, summary, desc) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}@terraluna`, `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`, `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  };

  for (const p of model.signPeriods) {
    if (p.end <= o.from || p.start >= o.to || !elements.has(p.element)) continue;
    const g = t.guidance[p.element];
    event(`tl-${p.element}-${p.start}`, p.start, p.end,
      `${ELEMENTS[p.element].icon} ${t.dayType[p.element]} · ${GLYPHS[p.sign]} ${t.signs[p.sign]}`,
      [`${t.moonIn(t.signs[p.sign])} (${t.element[p.element]})`, '', `${t.summary.sow}: ${g.sow}`,
        `${t.summary.harvest}: ${g.harvest}`].join('\n'));
  }
  if (o.unfavorable !== false) {
    for (const w of model.unfavorable) {
      if (w.end <= o.from || w.start >= o.to) continue;
      const reasons = [...new Set(w.reasons.map((r) => t.reason[r.type] + (r.note ? ` – ${r.note}` : '')))];
      event(`tl-unf-${w.start}`, w.start, w.end, `⚠ ${t.unfavorableLong}`,
        [...reasons, '', t.guidance.unfavorable].join('\n'));
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
