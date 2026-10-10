// iCalendar (RFC 5545) export, shared by the app and scripts/build-ics.mjs.
import { ELEMENTS, GLYPHS, dayInfo, keyOf, addDays } from './core.js';
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

export const REMINDERS = {
  none: null,
  evening: '-PT4H', // 20:00 the evening before
  morning: 'PT7H', // 07:00 on the day
};

/**
 * One all-day event per local day with a summary of the day, so a calendar
 * can remind you of it the evening before or in the morning.
 * @param {object} o  {from, to, lang, tz, reminder: keyof REMINDERS, name, stamp, elements}
 */
export function buildDailyICS(model, o) {
  const t = STRINGS[o.lang || 'he'];
  const tz = o.tz || 'Asia/Jerusalem';
  const stamp = utcStamp(o.stamp ?? Math.floor(Date.now() / 1000));
  const trigger = REMINDERS[o.reminder || 'none'];
  const elements = o.elements ? new Set(o.elements) : null;
  const time = (u) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(u * 1000);
  const arrow = t.dir === 'rtl' ? ' ← ' : ' → ';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TerraLuna//Biodynamic calendar//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(o.name || `${t.appName} – ${t.feeds.daily}`)}`, `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D',
  ];
  const last = keyOf(o.to - 1, tz);
  for (let key = keyOf(o.from, tz); key <= last; key = addDays(key, 1)) {
    const d = dayInfo(model, key, tz);
    if (elements && !d.elements.some((e) => elements.has(e))) continue;
    const parts = d.signs.map((p, i) => `${ELEMENTS[p.element].icon} ${t.part[p.element]}${i ? ` ${time(p.start)}` : ''}`);
    const unf = d.unfavorable.map((w) => `⚠ ${time(w.start)}–${time(w.end)}`);
    const desc = [];
    for (const p of d.signs) {
      const range = `${p.start > d.start ? time(p.start) : '00:00'}–${p.end < d.end ? time(p.end) : '24:00'}`;
      desc.push(`${range} ${t.dayType[p.element]} · ${t.signs[p.sign]}`);
    }
    for (const w of d.unfavorable) {
      desc.push(`⚠ ${t.unfavorableLong} ${time(w.start)}–${time(w.end)}: ${[...new Set(w.reasons.map((r) => t.reason[r.type]))].join('; ')}`);
    }
    desc.push('');
    for (const e of d.elements) desc.push(`${t.dayType[e]} – ${t.summary.sow}: ${t.guidance[e].sow} ${t.summary.harvest}: ${t.guidance[e].harvest}`);
    const date = key.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:tl-day-${date}@terraluna`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${addDays(key, 1).replace(/-/g, '')}`,
      `SUMMARY:${esc([parts.join(arrow), ...unf].join(' · '))}`, `DESCRIPTION:${esc(desc.join('\n'))}`, 'TRANSP:TRANSPARENT');
    if (trigger) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(parts.join(arrow))}`, `TRIGGER:${trigger}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
