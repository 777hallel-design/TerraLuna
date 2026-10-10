// TerraLuna core: turns the raw Swiss Ephemeris events (app/data/<year>.json)
// into periods, day summaries and sowing windows. No DOM access, so the same
// module runs in the browser and in Node (scripts/build-ics.mjs, tests).

export const SIGNS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
];
export const GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
// Aries is fire, Taurus earth, Gemini air, Cancer water, and so on around the circle.
export const ELEMENT_ORDER = ['fire', 'earth', 'air', 'water'];
export const ELEMENTS = {
  earth: { part: 'root', icon: '🥕' },
  water: { part: 'leaf', icon: '🥬' },
  air: { part: 'flower', icon: '🌼' },
  fire: { part: 'fruit', icon: '🍅' },
};
export const signElement = (sign) => ELEMENT_ORDER[sign % 4];

export const DEFAULT_OPTIONS = {
  nodeHours: 6, // unfavourable window on each side of a lunar node
  perigeeHours: 12, // ... of perigee
  eclipseHours: 12, // ... of an eclipse
  hemisphere: 'north', // 'south' swaps ascending / descending moon
  overrides: [], // [{start, end, note, source}] unix seconds, e.g. from the Maria Thun calendar
  overrideReplaces: true, // overrides replace computed windows in the years they cover
};

const HOUR = 3600;
const DAY = 86400;

// ---------------------------------------------------------------- time zones

const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

export function zonedParts(unix, tz) {
  const p = {};
  for (const { type, value } of dtf(tz).formatToParts(new Date(unix * 1000))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

export function tzOffset(unix, tz) {
  const p = zonedParts(unix, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) / 1000 - unix;
}

/** Unix seconds of a wall-clock time in `tz`. */
export function zonedToUnix(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi) / 1000;
  const off = tzOffset(guess, tz);
  let t = guess - off;
  const off2 = tzOffset(t, tz);
  if (off2 !== off) t = guess - off2; // crossed a DST change
  return t;
}

// Date keys are 'YYYY-MM-DD' strings of local calendar days.
export const pad = (n) => String(n).padStart(2, '0');
export const makeKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}
export function addDays(key, n) {
  const { y, m, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return makeKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function weekday(key) {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function keyOf(unix, tz) {
  const p = zonedParts(unix, tz);
  return makeKey(p.y, p.m, p.d);
}
export function dayRange(key, tz) {
  const { y, m, d } = parseKey(key);
  const next = parseKey(addDays(key, 1));
  return [zonedToUnix(y, m, d, 0, 0, tz), zonedToUnix(next.y, next.m, next.d, 0, 0, tz)];
}

// ---------------------------------------------------------------- the model

function mergeEvents(lists) {
  // Year files overlap by a few days; keep one copy of each event.
  const all = lists.flat().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const e of all) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - e[0]) < 600 && last[1] === e[1]) continue;
    out.push(e);
  }
  return out;
}

function unionWindows(windows) {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      last.reasons.push(...w.reasons);
    } else {
      out.push({ start: w.start, end: w.end, reasons: [...w.reasons] });
    }
  }
  return out;
}

const yearOfUnix = (t) => new Date(t * 1000).getUTCFullYear();

/**
 * Build the queryable model from one or more consecutive year files.
 * @param {object[]} years  parsed app/data/<year>.json documents
 */
export function buildModel(years, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ys = [...years].sort((a, b) => a.year - b.year);
  if (!ys.length) throw new Error('no data');
  const start = ys[0].rangeStart;
  const end = ys[ys.length - 1].rangeEnd;
  const pick = (k) => mergeEvents(ys.map((y) => y[k]));

  const ingress = pick('signs');
  const signPeriods = [];
  let cur = { start, sign: ys[0].initialSign };
  for (const [t, sign] of ingress) {
    if (t <= start) { cur.sign = sign; continue; }
    signPeriods.push({ ...cur, end: t, element: signElement(cur.sign) });
    cur = { start: t, sign };
  }
  signPeriods.push({ ...cur, end, element: signElement(cur.sign) });

  const decl = pick('decl');
  const ascPeriods = [];
  const south = o.hemisphere === 'south';
  for (let i = 0; i < decl.length; i++) {
    const [t, type] = decl[i];
    const ascending = (type === 'min') !== south;
    if (i === 0 && t > start) ascPeriods.push({ start, end: t, ascending: !ascending });
    ascPeriods.push({ start: t, end: i + 1 < decl.length ? decl[i + 1][0] : end, ascending });
  }

  const phases = pick('phases').map(([t, q]) => ({ t, phase: ['new', 'first', 'full', 'last'][q] }));
  const nodes = pick('nodes').map(([t, dir]) => ({ t, dir }));
  const apsides = pick('apsides').map(([t, type, km]) => ({ t, type, km }));
  const eclipses = pick('eclipses').map(([t, body, kind]) => ({ t, body, kind }));

  const computed = [];
  const around = (t, h, reason) => computed.push({ start: t - h * HOUR, end: t + h * HOUR, reasons: [reason] });
  for (const n of nodes) around(n.t, o.nodeHours, { type: n.dir === 'asc' ? 'node-asc' : 'node-desc', t: n.t });
  for (const a of apsides) if (a.type === 'perigee') around(a.t, o.perigeeHours, { type: 'perigee', t: a.t, km: a.km });
  for (const e of eclipses) around(e.t, o.eclipseHours, { type: `eclipse-${e.body}`, t: e.t, kind: e.kind });

  const overrides = (o.overrides || []).filter((w) => w.end > w.start);
  const coveredYears = new Set(o.overrideReplaces ? overrides.map((w) => yearOfUnix(w.start)) : []);
  const kept = computed.filter((w) => !coveredYears.has(yearOfUnix((w.start + w.end) / 2)));
  const manual = overrides.map((w) => ({
    start: w.start, end: w.end, reasons: [{ type: 'manual', note: w.note || '', source: w.source || 'manual' }],
  }));
  const unfavorable = unionWindows([...kept, ...manual]);

  return {
    start, end, signPeriods, ascPeriods, phases, nodes, apsides, eclipses, unfavorable, decl,
    options: o, meta: { ayanamsa: ys[0].ayanamsa, ephemeris: ys[0].ephemeris, zodiac: ys[0].zodiac },
  };
}

// ---------------------------------------------------------------- queries

const overlapping = (list, a, b) => list.filter((p) => p.end > a && p.start < b);
const within = (list, a, b) => list.filter((e) => e.t >= a && e.t < b);

export function signAt(model, t) {
  return model.signPeriods.find((p) => p.start <= t && t < p.end) || null;
}
export function ascendingAt(model, t) {
  const p = model.ascPeriods.find((q) => q.start <= t && t < q.end);
  return p ? p.ascending : null;
}
export function unfavorableAt(model, t) {
  return model.unfavorable.find((w) => w.start <= t && t < w.end) || null;
}

/** Moon age (0..1 of a synodic month), illumination and a phase name at time t. */
export function moonPhaseAt(model, t) {
  const news = model.phases.filter((p) => p.phase === 'new');
  let prev = null;
  let next = null;
  for (const p of news) {
    if (p.t <= t) prev = p;
    else { next = p; break; }
  }
  const SYNODIC = 29.530588 * DAY;
  let age;
  if (prev && next) age = (t - prev.t) / (next.t - prev.t);
  else if (prev) age = ((t - prev.t) % SYNODIC) / SYNODIC;
  else if (next) age = 1 - ((next.t - t) % SYNODIC) / SYNODIC;
  else age = 0;
  const illumination = (1 - Math.cos(2 * Math.PI * age)) / 2;
  // The four main phases are named only within about a day of the exact moment.
  const main = Math.round(age * 4) % 4;
  const near = Math.abs(age * 4 - Math.round(age * 4)) < 0.14;
  const name = near ? ['new', 'first', 'full', 'last'][main]
    : ['waxing-crescent', 'waxing-gibbous', 'waning-gibbous', 'waning-crescent'][Math.floor(age * 4)];
  return { age, illumination, name, waxing: age < 0.5 };
}

/**
 * Split [a, b) wherever the sign, the ascending state or an unfavourable
 * window changes. Each segment says what the moon is doing during it.
 */
export function segments(model, a, b) {
  const cuts = new Set([a, b]);
  const add = (t) => { if (t > a && t < b) cuts.add(t); };
  for (const p of overlapping(model.signPeriods, a, b)) { add(p.start); add(p.end); }
  for (const p of overlapping(model.ascPeriods, a, b)) { add(p.start); add(p.end); }
  for (const w of overlapping(model.unfavorable, a, b)) { add(w.start); add(w.end); }
  const ts = [...cuts].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const s = ts[i];
    const e = ts[i + 1];
    const mid = (s + e) / 2;
    const sp = signAt(model, mid);
    const unf = unfavorableAt(model, mid);
    out.push({
      start: s, end: e, sign: sp ? sp.sign : null, element: sp ? sp.element : null,
      ascending: ascendingAt(model, mid), unfavorable: unf,
    });
  }
  return out;
}

/** Everything the app shows for one local calendar day. */
export function dayInfo(model, key, tz) {
  const [a, b] = dayRange(key, tz);
  const segs = segments(model, a, b);
  const totals = { earth: 0, water: 0, air: 0, fire: 0 };
  const favorable = { earth: 0, water: 0, air: 0, fire: 0 };
  let unfavorableSecs = 0;
  for (const s of segs) {
    if (!s.element) continue;
    totals[s.element] += s.end - s.start;
    if (s.unfavorable) unfavorableSecs += s.end - s.start;
    else favorable[s.element] += s.end - s.start;
  }
  const main = Object.entries(totals).sort((x, y) => y[1] - x[1])[0];
  const mainElement = main[1] > 0 ? main[0] : null;
  const signs = overlapping(model.signPeriods, a, b).map((p) => ({ ...p }));
  const elements = [...new Set(signs.map((p) => p.element))];
  const noon = (a + b) / 2;
  return {
    key, start: a, end: b, segments: segs, totals, favorable, mainElement, elements, signs,
    unfavorableSecs,
    fullyUnfavorable: unfavorableSecs >= b - a - 60,
    unfavorable: overlapping(model.unfavorable, a, b),
    phaseEvents: within(model.phases, a, b),
    nodes: within(model.nodes, a, b),
    apsides: within(model.apsides, a, b),
    eclipses: within(model.eclipses, a, b),
    turning: within(model.decl.map(([t, type]) => ({ t, type })), a, b),
    ascending: ascendingAt(model, noon),
    ascChanges: overlapping(model.ascPeriods, a, b).length > 1,
    moon: moonPhaseAt(model, noon),
  };
}

/**
 * Good times for an element between a and b: runs of that element outside
 * unfavourable windows, split where the moon turns ascending / descending.
 */
export function findWindows(model, a, b, element, { minHours = 2 } = {}) {
  const out = [];
  for (const s of segments(model, a, b)) {
    if (s.element !== element || s.unfavorable) continue;
    const last = out[out.length - 1];
    if (last && last.end === s.start && last.ascending === s.ascending && last.sign === s.sign) last.end = s.end;
    else out.push({ start: s.start, end: s.end, sign: s.sign, element, ascending: s.ascending });
  }
  return out.filter((w) => w.end - w.start >= minHours * HOUR);
}

export function coversRange(model, a, b) {
  return model.start <= a && model.end >= b;
}
