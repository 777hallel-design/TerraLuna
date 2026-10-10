import * as C from './core.js';
import { STRINGS, CROPS } from './i18n.js';
import { buildICS } from './ics.js';

// ---------------------------------------------------------------- storage

const store = {
  get(k, d) {
    try { const v = localStorage.getItem(`tl.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(`tl.${k}`, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const DEFAULTS = {
  lang: 'he', tz: browserTz, weekStart: null, hemisphere: 'north', theme: 'auto', scale: 1,
  contrast: false, motion: false, patterns: false,
  nodeHours: C.DEFAULT_OPTIONS.nodeHours, perigeeHours: C.DEFAULT_OPTIONS.perigeeHours,
  eclipseHours: C.DEFAULT_OPTIONS.eclipseHours, myCrops: [],
};
const settings = { ...DEFAULTS, ...store.get('settings', {}) };
let thun = store.get('thun', []); // [{start, end, note}] unix seconds
const journal = store.get('journal', {});

const state = { view: store.get('view', 'month'), date: null, available: [], data: new Map(), model: null, modelKey: '', days: new Map() };

const $ = (sel, root = document) => root.querySelector(sel);
const t = () => STRINGS[settings.lang];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const weekStart = () => settings.weekStart ?? (settings.lang === 'he' ? 0 : 1);
const now = () => Math.floor(Date.now() / 1000);
const todayKey = () => C.keyOf(now(), settings.tz);
const locale = () => (settings.lang === 'he' ? 'he-IL' : 'en-GB');

// ---------------------------------------------------------------- formatting

function fmtTime(unix) {
  return new Intl.DateTimeFormat(locale(), { timeZone: settings.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(unix * 1000);
}
const keyDate = (key) => { const { y, m, d } = C.parseKey(key); return new Date(Date.UTC(y, m - 1, d, 12)); };
function fmtKey(key, opts) {
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...opts }).format(keyDate(key));
}
/** "13:43", or "Tue 13:43" when the time is on another day than `key`. */
function fmtTimeOn(unix, key) {
  const k = C.keyOf(unix, settings.tz);
  if (k === key) return fmtTime(unix);
  return `${fmtKey(k, { weekday: 'short', day: 'numeric', month: 'numeric' })} ${fmtTime(unix)}`;
}
function fmtDateTime(unix) {
  return `${fmtKey(C.keyOf(unix, settings.tz), { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(unix)}`;
}
const MOON_EMOJI = { new: '🌑', 'waxing-crescent': '🌒', first: '🌓', 'waxing-gibbous': '🌔', full: '🌕', 'waning-gibbous': '🌖', last: '🌗', 'waning-crescent': '🌘' };
const icon = (el) => (el ? C.ELEMENTS[el].icon : '');
const signName = (s) => `${C.GLYPHS[s]} ${t().signs[s]}`;
const ascText = (asc) => (asc == null ? '' : asc ? t().ascending : t().descending);
const arrow = (asc) => (asc == null ? '' : `<span class="arrow ${asc ? 'up' : 'down'}" aria-hidden="true">${asc ? '↑' : '↓'}</span>`);
const rng = (a, b) => `<bdi>${a}</bdi> – <bdi>${b}</bdi>`;
const reasonText = (w) => [...new Set(w.reasons.map((r) => t().reason[r.type] + (r.note ? ` – ${r.note}` : '')))].join('; ');

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ---------------------------------------------------------------- data

async function loadIndex() {
  const res = await fetch('data/index.json');
  state.available = (await res.json()).years;
}

async function ensureYears(y0, y1) {
  const lo = Math.max(y0, state.available[0]);
  const hi = Math.min(y1, state.available[state.available.length - 1]);
  const want = [];
  for (let y = lo; y <= hi; y++) if (!state.data.has(y)) want.push(y);
  await Promise.all(want.map(async (y) => {
    const res = await fetch(`data/${y}.json`);
    state.data.set(y, await res.json());
  }));
  // Keep the loaded range contiguous so periods join up.
  const ys = [...state.data.keys()].sort((a, b) => a - b);
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) {
    if (!state.data.has(y)) state.data.set(y, await (await fetch(`data/${y}.json`)).json());
  }
  rebuildModel();
}

function rebuildModel() {
  const key = [[...state.data.keys()].sort().join(','), settings.hemisphere, settings.nodeHours, settings.perigeeHours,
    settings.eclipseHours, JSON.stringify(thun)].join('|');
  if (key === state.modelKey) return;
  state.modelKey = key;
  state.model = C.buildModel([...state.data.values()], {
    hemisphere: settings.hemisphere, nodeHours: +settings.nodeHours, perigeeHours: +settings.perigeeHours,
    eclipseHours: +settings.eclipseHours, overrides: thun.map((w) => ({ ...w, source: 'thun' })),
  });
  state.days.clear();
}

function day(key) {
  if (!state.days.has(key)) state.days.set(key, C.dayInfo(state.model, key, settings.tz));
  return state.days.get(key);
}
const hasDay = (key) => {
  const [a, b] = C.dayRange(key, settings.tz);
  return state.model && C.coversRange(state.model, a, b);
};
const yearOf = (key) => C.parseKey(key).y;

// ---------------------------------------------------------------- descriptions

/** Day types in order, with change times: "Root day until 13:43, then leaf day". */
function dayTypeText(info) {
  const parts = [];
  const signs = info.signs.filter((p) => p.end > info.start && p.start < info.end);
  signs.forEach((p, i) => {
    const name = t().dayType[p.element];
    if (signs.length === 1) parts.push(name);
    else if (i === 0) parts.push(`${name} ${t().until} ${fmtTime(p.end)}`);
    else if (i === signs.length - 1) parts.push(`${t().then} ${name} ${t().from}${fmtTime(p.start)}`);
    else parts.push(`${name} ${fmtTime(p.start)}–${fmtTime(p.end)}`);
  });
  return parts.join(', ');
}

/** "Moon in ♌ Leo until 13:43, then ♍ Virgo" */
function signText(info) {
  const tt = t();
  const ps = info.signs;
  if (ps.length === 1) return esc(tt.moonIn(signName(ps[0].sign)));
  return esc(tt.moonIn(ps.map((p, i) => (i === 0 ? `${signName(p.sign)} ${tt.until} ${fmtTime(p.end)}`
    : `${tt.then} ${signName(p.sign)}`)).join(', ')));
}

function dayLabel(info) {
  const tt = t();
  const bits = [fmtKey(info.key, { weekday: 'long', day: 'numeric', month: 'long' }), dayTypeText(info)];
  for (const w of info.unfavorable) bits.push(`${tt.unfavorable} ${fmtTimeOn(w.start, info.key)}–${fmtTimeOn(w.end, info.key)}`);
  if (info.ascending != null) bits.push(ascText(info.ascending));
  for (const p of info.phaseEvents) bits.push(tt.phase[p.phase]);
  const mine = myCropsFor(info);
  if (mine.length) bits.push(`${tt.myCrops}: ${mine.map((c) => c.name[settings.lang]).join(', ')}`);
  return bits.join('. ');
}

function myCropsFor(info) {
  const els = new Set(Object.entries(info.favorable).filter(([, s]) => s >= 2 * 3600).map(([e]) => e));
  return CROPS.filter((c) => settings.myCrops.includes(c.id) && els.has(c.element));
}

function speechText(info) {
  const tt = t();
  const lines = [dayLabel(info) + '.'];
  for (const el of info.elements) lines.push(`${tt.dayType[el]}: ${tt.guidance[el].sow} ${tt.guidance[el].harvest}`);
  if (info.unfavorable.length) lines.push(tt.guidance.unfavorable);
  if (info.ascending != null) lines.push(info.ascending ? tt.guidance.ascending : tt.guidance.descending);
  return lines.join(' ');
}

// ---------------------------------------------------------------- shared pieces

function segBar(info) {
  const total = info.end - info.start;
  return `<div class="bar" aria-hidden="true">${info.segments.map((s) =>
    `<span class="seg el-${s.element || 'none'}${s.unfavorable ? ' unf' : ''}" style="flex:${((s.end - s.start) / total).toFixed(4)}"><span class="seg-fill"></span></span>`).join('')}</div>`;
}

function phaseMark(info) {
  const p = info.phaseEvents[0];
  return p ? `<span aria-hidden="true" title="${esc(t().phase[p.phase])}">${MOON_EMOJI[p.phase]}</span>` : '';
}

// ---------------------------------------------------------------- month view

function renderMonth(view) {
  const tt = t();
  const { y, m } = C.parseKey(state.date);
  const first = C.makeKey(y, m, 1);
  const startOffset = (C.weekday(first) - weekStart() + 7) % 7;
  const gridStart = C.addDays(first, -startOffset);
  const weeks = Math.ceil((startOffset + C.daysInMonth(y, m)) / 7);
  const today = todayKey();
  let html = `<div class="month" role="grid" aria-label="${esc(fmtKey(first, { month: 'long', year: 'numeric' }))}"><div role="row" style="display:contents">`;
  for (let i = 0; i < 7; i++) {
    const wd = (weekStart() + i) % 7;
    html += `<div class="dow" role="columnheader"><abbr title="${tt.weekdays[wd]}">${tt.weekdaysShort[wd]}</abbr></div>`;
  }
  html += '</div>';
  for (let w = 0; w < weeks; w++) {
    html += '<div role="row" style="display:contents">';
    for (let i = 0; i < 7; i++) {
      const key = C.addDays(gridStart, w * 7 + i);
      html += `<div role="gridcell" style="display:contents">${dayCell(key, { other: C.parseKey(key).m !== m, today: key === today })}</div>`;
    }
    html += '</div>';
  }
  view.innerHTML = `${html}</div>`;
  wireGrid(view);
}

function dayCell(key, { other, today }) {
  const tt = t();
  const n = C.parseKey(key).d;
  if (!hasDay(key)) return `<button type="button" class="cell el-none${other ? ' other' : ''}" data-key="${key}" tabindex="-1" disabled><span class="num">${n}</span></button>`;
  const info = day(key);
  const els = info.elements;
  const icons = els.map((e) => `<span aria-hidden="true">${icon(e)}</span>`).join('') + (info.unfavorable.length ? '<span aria-hidden="true">⚠️</span>' : '');
  const label = els.map((e) => tt.part[e]).join(settings.lang === 'he' ? ' ← ' : ' → ');
  const mine = myCropsFor(info).length ? '<span class="mine" aria-hidden="true">🌱</span>' : '';
  const cls = ['cell', `el-${info.mainElement || 'none'}`, other && 'other', today && 'today', key === state.date && 'selected', info.fullyUnfavorable && 'unf-all'].filter(Boolean).join(' ');
  return `<button type="button" class="${cls}" data-key="${key}" tabindex="${key === state.date ? 0 : -1}" aria-label="${esc(dayLabel(info))}"${today ? ' aria-current="date"' : ''}>
    <span class="num"><span>${n}</span></span>
    <span class="icons">${icons}</span>
    <span class="label">${esc(label)}</span>
    ${segBar(info)}
    <span class="meta">${phaseMark(info)}${arrow(info.ascending)}</span>${mine}${journal[key] ? '<span class="noted" aria-hidden="true"></span>' : ''}
  </button>`;
}

function wireGrid(view) {
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (b && !b.disabled) { state.date = b.dataset.key; openDay(b.dataset.key); }
  });
  view.addEventListener('keydown', (e) => {
    const b = e.target.closest('.cell[data-key]');
    if (!b) return;
    const rtl = t().dir === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
    if (step == null) return;
    e.preventDefault();
    const key = C.addDays(b.dataset.key, step);
    const target = view.querySelector(`.cell[data-key="${key}"]`);
    if (target && !target.classList.contains('other')) { setSelected(view, key); target.focus(); } else go(key);
  });
}

function setSelected(view, key) {
  state.date = key;
  view.querySelectorAll('.cell[data-key]').forEach((c) => {
    c.tabIndex = c.dataset.key === key ? 0 : -1;
    c.classList.toggle('selected', c.dataset.key === key);
  });
  syncHash();
}

// ---------------------------------------------------------------- week view

function renderWeek(view) {
  const tt = t();
  const start = C.addDays(state.date, -((C.weekday(state.date) - weekStart() + 7) % 7));
  const today = todayKey();
  let html = '<div class="week"><div></div>';
  const keys = [...Array(7)].map((_, i) => C.addDays(start, i));
  for (const k of keys) {
    html += `<button type="button" class="head${k === today ? ' today' : ''}" data-key="${k}" aria-label="${esc(hasDay(k) ? dayLabel(day(k)) : k)}">
      ${tt.weekdaysShort[C.weekday(k)]}<b>${C.parseKey(k).d}</b></button>`;
  }
  html += `<div class="hours" aria-hidden="true">${[...Array(24)].map((_, h) => `<span>${C.pad(h)}</span>`).join('')}</div>`;
  for (const k of keys) {
    html += '<div class="col" aria-hidden="true">';
    if (hasDay(k)) {
      const info = day(k);
      const total = info.end - info.start;
      for (const s of mergeForDisplay(info.segments)) {
        const top = ((s.start - info.start) / total) * 100;
        const h = ((s.end - s.start) / total) * 100;
        const text = s.unfavorable ? `⚠️ ${tt.unfavorable}` : `${icon(s.element)} ${tt.part[s.element]}`;
        html += `<div class="blk el-${s.element}${s.unfavorable ? ' unf' : ''}" data-key="${k}" style="top:${top}%;height:${h}%">${h > 5 ? `${text} <small>${fmtTime(s.start)}</small>` : ''}</div>`;
      }
      const n = now();
      if (n >= info.start && n < info.end) html += `<div class="now" style="top:${((n - info.start) / total) * 100}%"></div>`;
    }
    html += '</div>';
  }
  view.innerHTML = `${html}</div>`;
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (b) { state.date = b.dataset.key; openDay(b.dataset.key); }
  });
}

/** Join neighbouring segments that only differ in ascending state. */
function mergeForDisplay(segs) {
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.element === s.element && !!last.unfavorable === !!s.unfavorable && last.sign === s.sign) last.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

// ---------------------------------------------------------------- hour view

function renderHour(view) {
  const tt = t();
  if (!hasDay(state.date)) { view.innerHTML = `<p>${tt.noData}</p>`; return; }
  const info = day(state.date);
  const { y, m, d } = C.parseKey(state.date);
  const n = now();
  const events = dayEvents(info);
  let html = '<ol class="hours-list">';
  for (let h = 0; h < 24; h++) {
    const a = C.zonedToUnix(y, m, d, h, 0, settings.tz);
    const b = h === 23 ? info.end : C.zonedToUnix(y, m, d, h + 1, 0, settings.tz);
    if (b <= a) continue; // skipped by a DST change
    const segs = info.segments.filter((s) => s.end > a && s.start < b);
    const main = segs.reduce((x, s) => (Math.min(s.end, b) - Math.max(s.start, a) > Math.min(x.end, b) - Math.max(x.start, a) ? s : x), segs[0]);
    const unf = segs.some((s) => s.unfavorable);
    const changes = segs.slice(1).map((s) => `→ ${icon(s.element)} ${tt.part[s.element]}${s.unfavorable ? ' ⚠️' : ''} ${fmtTime(s.start)}`);
    const here = events.filter((e) => e.t >= a && e.t < b).map((e) => `${e.icon} ${esc(e.text)} ${fmtTime(e.t)}`);
    html += `<li class="el-${main.element}${unf ? ' unf' : ''}${n >= a && n < b ? ' now' : ''}"${n >= a && n < b ? ' aria-current="time"' : ''}>
      <time datetime="${new Date(a * 1000).toISOString()}">${fmtTime(a)}</time>
      <span><span aria-hidden="true">${icon(main.element)}</span> <b>${tt.dayType[main.element]}</b> · ${signName(main.sign)}${main.unfavorable ? ` · ⚠️ ${tt.unfavorable}` : ''}
        ${changes.length ? `<br><small>${changes.join(' ')}</small>` : ''}${here.length ? `<br><small>${here.join(' · ')}</small>` : ''}</span>
      <span class="flags">${arrow(main.ascending)} ${ascText(main.ascending)}</span>
    </li>`;
  }
  view.innerHTML = `${html}</ol>`;
}

function dayEvents(info) {
  const tt = t();
  const ev = [];
  for (const p of info.phaseEvents) ev.push({ t: p.t, icon: MOON_EMOJI[p.phase], text: tt.phase[p.phase] });
  for (const x of info.nodes) ev.push({ t: x.t, icon: '☊', text: tt.reason[x.dir === 'asc' ? 'node-asc' : 'node-desc'] });
  for (const x of info.apsides) ev.push({ t: x.t, icon: x.type === 'perigee' ? '⊕' : '⊖', text: `${x.type === 'perigee' ? tt.reason.perigee : tt.apogee} (${x.km.toLocaleString(locale())} km)` });
  for (const x of info.eclipses) ev.push({ t: x.t, icon: '◐', text: tt.reason[`eclipse-${x.body}`] });
  for (const x of info.turning) ev.push({ t: x.t, icon: x.type === 'min' ? '↑' : '↓', text: tt.turning[settings.hemisphere === 'south' ? (x.type === 'min' ? 'max' : 'min') : x.type] });
  for (const p of info.signs) if (p.start >= info.start && p.start < info.end) ev.push({ t: p.start, icon: C.GLYPHS[p.sign], text: tt.moonIn(tt.signs[p.sign]) });
  return ev.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- day detail

function dayDetail(key, inDialog) {
  const tt = t();
  if (!hasDay(key)) return `<p>${tt.noData}</p>`;
  const info = day(key);
  const el = info.mainElement;
  const headId = inDialog ? 'day-title' : 'day-view-title';
  const types = info.elements.map((e) => tt.dayType[e]).join(settings.lang === 'he' ? ' ← ' : ' → ');
  let html = `<div class="sheet-head"><div><h2 id="${headId}">${esc(fmtKey(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2></div>
    ${inDialog ? `<button type="button" class="btn icon" data-close aria-label="${tt.close}">✕</button>` : ''}</div>`;

  html += `<section class="day-hero el-${el}" aria-labelledby="${headId}-sum">
    <div class="row"><span class="big" aria-hidden="true">${info.elements.map(icon).join('')}</span>
    <div><h3 id="${headId}-sum">${esc(types)}</h3><p style="margin:0">${signText(info)}</p></div></div>
    <p style="margin:0">${MOON_EMOJI[info.moon.name]} ${tt.phase[info.moon.name]} (${Math.round(info.moon.illumination * 100)}% ${tt.illum}) · ${arrow(info.ascending)} ${ascText(info.ascending)}</p>
    <div class="row"><button type="button" class="btn small" data-speak>🔊 ${tt.summary.readAloud}</button>
    <button type="button" class="btn small" data-ics>📅 ${tt.summary.addDay}</button></div></section>`;

  for (const w of info.unfavorable) {
    html += `<div class="warn" role="note"><b>⚠️ ${tt.unfavorableLong}: ${rng(fmtTimeOn(w.start, key), fmtTimeOn(w.end, key))}</b><br>${esc(reasonText(w))}<br><small>${tt.guidance.unfavorable}</small></div>`;
  }

  html += `<section class="day-card"><h3>${tt.summary.timeline}</h3><ol class="timeline">`;
  for (const s of mergeForDisplay(info.segments)) {
    html += `<li class="el-${s.element}${s.unfavorable ? ' unf' : ''}"><time>${rng(fmtTime(s.start), s.end === info.end ? '24:00' : fmtTime(s.end))}</time>
      <span>${icon(s.element)} <b>${tt.dayType[s.element]}</b> · ${signName(s.sign)} (${tt.element[s.element]})${s.unfavorable ? ` · ⚠️ <b>${tt.unfavorable}</b>` : ''}</span></li>`;
  }
  html += '</ol></section><div class="grid2">';

  for (const e of info.elements) {
    const g = tt.guidance[e];
    const crops = CROPS.filter((c) => c.element === e);
    html += `<section class="day-card el-${e}" style="border-top:6px solid var(--c)"><h3>${icon(e)} ${tt.dayType[e]} · ${tt.element[e]}</h3>
      <p><b>${tt.summary.sow}:</b> ${g.sow}</p><p><b>${tt.summary.harvest}:</b> ${g.harvest}</p>
      <b>${tt.summary.crops}:</b><ul class="chips">${crops.map((c) => `<li class="chip${settings.myCrops.includes(c.id) ? ' mine' : ''}">${esc(c.name[settings.lang])}</li>`).join('')}</ul></section>`;
  }

  const notes = [];
  if (info.ascending != null) notes.push(info.ascending ? tt.guidance.ascending : tt.guidance.descending);
  if (['new', 'full'].includes(info.moon.name) || info.phaseEvents.some((p) => ['new', 'full'].includes(p.phase))) {
    notes.push(tt.guidance.phase[info.phaseEvents.find((p) => ['new', 'full'].includes(p.phase))?.phase || info.moon.name]);
  } else notes.push(tt.guidance.phase[info.moon.waxing ? 'waxing' : 'waning']);
  const events = dayEvents(info);
  html += `<section class="day-card"><h3>${tt.summary.moon}</h3>${notes.map((n) => `<p>${n}</p>`).join('')}
    ${events.length ? `<h4>${tt.summary.events}</h4><dl class="facts">${events.map((e) => `<dt>${fmtTime(e.t)}</dt><dd>${e.icon} ${esc(e.text)}</dd>`).join('')}</dl>` : ''}</section>`;

  html += `<section class="day-card"><h3><label for="note-${key}">${tt.summary.notes}</label></h3>
    <textarea id="note-${key}" data-note="${key}" placeholder="${esc(tt.summary.notesHint)}">${esc(journal[key] || '')}</textarea></section></div>`;
  return html;
}

function wireDetail(root, key) {
  root.querySelector('[data-close]')?.addEventListener('click', () => root.closest('dialog').close());
  const speak = root.querySelector('[data-speak]');
  if (!('speechSynthesis' in window)) speak?.remove();
  speak?.addEventListener('click', () => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speechText(day(key)));
    u.lang = settings.lang === 'he' ? 'he-IL' : 'en-GB';
    speechSynthesis.speak(u);
  });
  root.querySelector('[data-ics]')?.addEventListener('click', () => {
    const info = day(key);
    downloadICS(buildICS(state.model, { from: info.start, to: info.end, lang: settings.lang }), `terraluna-${key}.ics`);
  });
  const ta = root.querySelector('[data-note]');
  ta?.addEventListener('input', () => {
    if (ta.value.trim()) journal[key] = ta.value; else delete journal[key];
    store.set('journal', journal);
  });
}

function openDay(key) {
  const dlg = $('#dlg-day');
  const body = $('#day-body');
  body.innerHTML = dayDetail(key, true);
  wireDetail(body, key);
  dlg.onclose = () => { syncHash(); if (state.view === 'month') render(); };
  dlg.showModal();
  body.scrollTop = 0;
  syncHash();
}

function renderDay(view) {
  view.innerHTML = dayDetail(state.date, false);
  wireDetail(view, state.date);
}

// ---------------------------------------------------------------- year view

function renderYear(view) {
  const tt = t();
  const y = yearOf(state.date);
  const today = todayKey();
  let html = '<div class="year">';
  for (let m = 1; m <= 12; m++) {
    const first = C.makeKey(y, m, 1);
    const off = (C.weekday(first) - weekStart() + 7) % 7;
    html += `<section class="mini"><h3><button type="button" data-month="${first}">${esc(fmtKey(first, { month: 'long' }))}</button></h3><div class="g">`;
    for (let i = 0; i < 7; i++) html += `<span class="dow" aria-hidden="true">${tt.weekdaysShort[(weekStart() + i) % 7]}</span>`;
    for (let i = 0; i < off; i++) html += '<span></span>';
    for (let d = 1; d <= C.daysInMonth(y, m); d++) {
      const key = C.makeKey(y, m, d);
      if (!hasDay(key)) { html += `<span>${d}</span>`; continue; }
      const info = day(key);
      const cls = ['d', `el-${info.mainElement}`, info.fullyUnfavorable && 'unf-all', info.unfavorable.length && 'has-unf', key === today && 'today'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-key="${key}" aria-label="${esc(dayLabel(info))}">${d}</button>`;
    }
    html += '</div></section>';
  }
  view.innerHTML = `${html}</div>`;
  view.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) { state.date = mb.dataset.month; setView('month'); return; }
    const b = e.target.closest('[data-key]');
    if (b) { state.date = b.dataset.key; openDay(b.dataset.key); }
  });
}

// ---------------------------------------------------------------- finder

function renderFinder() {
  const tt = t();
  const body = $('#finder-body');
  const sel = store.get('finder', { crop: settings.myCrops[0] || 'carrot', action: 'sow', days: 60 });
  if (!tt.actions[sel.action]) sel.action = 'sow';
  if (!CROPS.some((c) => c.id === sel.crop)) sel.crop = 'carrot';
  const groups = Object.keys(C.ELEMENTS).map((e) => `<optgroup label="${icon(e)} ${tt.part[e]}">${CROPS.filter((c) => c.element === e)
    .map((c) => `<option value="${c.id}"${c.id === sel.crop ? ' selected' : ''}>${esc(c.name[settings.lang])}</option>`).join('')}</optgroup>`).join('');
  body.innerHTML = `<div class="sheet-head"><h2 id="finder-title">${tt.finderTitle}</h2><button type="button" class="btn icon" data-close aria-label="${tt.close}">✕</button></div>
    <div class="row">
      <label class="field">${tt.finderCrop}<select id="f-crop">${groups}</select></label>
      <label class="field">${tt.finderAction}<select id="f-action">${Object.entries(tt.actions).map(([k, v]) => `<option value="${k}"${k === sel.action ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">${tt.finderRange}<select id="f-days">${[14, 30, 60, 90, 180].map((n) => `<option value="${n}"${n === +sel.days ? ' selected' : ''}>${tt.rangeDays(n)}</option>`).join('')}</select></label>
    </div><p id="f-note" class="muted"></p><ol class="windows" id="f-out" aria-live="polite"></ol>`;
  body.querySelector('[data-close]').addEventListener('click', () => $('#dlg-finder').close());
  const run = async () => {
    const crop = CROPS.find((c) => c.id === $('#f-crop').value);
    const action = $('#f-action').value;
    const days = +$('#f-days').value;
    store.set('finder', { crop: crop.id, action, days });
    const a = Math.max(now(), C.dayRange(todayKey(), settings.tz)[0]);
    const b = a + days * 86400;
    await ensureYears(yearOf(todayKey()), new Date(b * 1000).getUTCFullYear());
    const preferAsc = action === 'harvest' ? crop.element !== 'earth' : null;
    $('#f-note').textContent = action === 'harvest' ? (crop.element === 'earth' ? tt.finderNoteHarvestRoot : tt.finderNoteHarvest) : '';
    const wins = C.findWindows(state.model, a, b, crop.element, { minHours: 2 });
    $('#f-out').innerHTML = wins.length ? wins.map((w) => {
      const best = preferAsc != null && w.ascending === preferAsc;
      const k = C.keyOf(w.start, settings.tz);
      return `<li class="el-${w.element}"><button type="button" data-key="${k}">${rng(fmtDateTime(w.start), fmtDateTime(w.end))}</button>
        <span>${tt.hours(Math.round((w.end - w.start) / 3600))} · ${signName(w.sign)} · ${arrow(w.ascending)} ${ascText(w.ascending)}${best ? ` · <span class="best">★ ${tt.finderBest}</span>` : ''}</span></li>`;
    }).join('') : `<li>${tt.finderNone}</li>`;
  };
  body.querySelectorAll('select').forEach((s) => s.addEventListener('change', run));
  $('#f-out').addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (b) { $('#dlg-finder').close(); go(b.dataset.key); openDay(b.dataset.key); }
  });
  run();
}

// ---------------------------------------------------------------- subscribe / export

function downloadICS(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSubscribe() {
  const tt = t();
  const body = $('#subscribe-body');
  const base = new URL('calendar/', location.href);
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  let html = `<div class="sheet-head"><h2 id="subscribe-title">${tt.subscribeTitle}</h2><button type="button" class="btn icon" data-close aria-label="${tt.close}">✕</button></div>
    <p>${tt.subscribeIntro}</p>${local ? '<p class="warn">⚠️ Subscriptions need the app to be published on a public address (e.g. GitHub Pages). Downloads work everywhere.</p>' : ''}`;
  for (const [id, label] of Object.entries(tt.feeds)) {
    const https = new URL(`terraluna-${id}-${settings.lang}.ics`, base).href;
    const webcal = https.replace(/^https?:/, 'webcal:');
    const elIcon = C.ELEMENTS[id] ? icon(id) : id === 'unfavorable' ? '⚠️' : '🌙';
    html += `<div class="feed"><b>${elIcon} ${label}</b><div class="row">
      <a class="btn small" href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener">${tt.google}</a>
      <a class="btn small" href="${esc(webcal)}">${tt.apple}</a>
      <a class="btn small" href="https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(`${tt.appName} – ${label}`)}" target="_blank" rel="noopener">${tt.outlook}</a>
      <a class="btn small" href="${esc(https)}" download>${tt.download}</a>
      <button type="button" class="btn small" data-copy="${esc(https)}">${tt.copy}</button></div></div>`;
  }
  html += `<fieldset style="margin-top:1rem"><legend>${tt.exportCustom}</legend>
    <div class="row">${Object.keys(C.ELEMENTS).map((e) => `<label class="check"><input type="checkbox" name="x-el" value="${e}" checked> ${icon(e)} ${tt.part[e]}</label>`).join('')}
    <label class="check"><input type="checkbox" id="x-unf" checked> ⚠️ ${tt.unfavorable}</label></div>
    <div class="row"><label class="field">${tt.exportMonths}<input type="number" id="x-months" min="1" max="36" value="12"></label>
    <button type="button" class="btn primary" id="x-go">${tt.exportBtn}</button></div></fieldset><p class="muted"><small>${tt.feedNote}</small></p>`;
  body.innerHTML = html;
  body.querySelector('[data-close]').addEventListener('click', () => $('#dlg-subscribe').close());
  body.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast(tt.copied); } catch { prompt('', b.dataset.copy); }
  }));
  $('#x-go').addEventListener('click', async () => {
    const months = Math.min(36, Math.max(1, +$('#x-months').value || 12));
    const a = C.dayRange(todayKey(), settings.tz)[0];
    const b = a + months * 30.44 * 86400;
    await ensureYears(yearOf(todayKey()), new Date(b * 1000).getUTCFullYear());
    const elements = [...body.querySelectorAll('[name="x-el"]:checked')].map((i) => i.value);
    downloadICS(buildICS(state.model, { from: a, to: Math.min(b, state.model.end), lang: settings.lang, elements, unfavorable: $('#x-unf').checked }), 'terraluna.ics');
  });
}

// ---------------------------------------------------------------- settings

function parseThun(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[,\t;]/).map((s) => s.trim());
    const parse = (s) => {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(s || '');
      return m ? C.zonedToUnix(+m[1], +m[2], +m[3], +m[4], +m[5], settings.tz) : null;
    };
    const start = parse(parts[0]);
    const end = parse(parts[1]);
    if (start == null || end == null || end <= start) throw new Error(t().set.thunError(line));
    out.push({ start, end, note: parts.slice(2).join(', ') });
  }
  return out;
}
function thunText() {
  const f = (u) => { const p = C.zonedParts(u, settings.tz); return `${p.y}-${C.pad(p.m)}-${C.pad(p.d)} ${C.pad(p.h)}:${C.pad(p.mi)}`; };
  return thun.map((w) => `${f(w.start)}, ${f(w.end)}${w.note ? `, ${w.note}` : ''}`).join('\n');
}

function renderSettings() {
  const tt = t();
  const s = tt.set;
  const body = $('#settings-body');
  let zones = [settings.tz];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* old browser */ }
  if (!zones.includes(settings.tz)) zones.unshift(settings.tz);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  const check = (k, label) => `<label class="check"><input type="checkbox" data-set="${k}"${settings[k] ? ' checked' : ''}> ${label}</label>`;
  const meta = state.model?.meta || { ephemeris: 'Swiss Ephemeris', ayanamsa: 'lahiri' };
  body.innerHTML = `<div class="sheet-head"><h2 id="settings-title">${tt.settings}</h2><button type="button" class="btn icon" data-close aria-label="${tt.close}">✕</button></div>
  <fieldset><legend>${s.language} · ${s.timezone}</legend>
    <label class="field">${s.language}<select data-set="lang">${opt('he', 'עברית', settings.lang)}${opt('en', 'English', settings.lang)}</select></label>
    <label class="field">${s.timezone}<select data-set="tz">${zones.map((z) => opt(z, z, settings.tz)).join('')}</select></label>
    <label class="field">${s.weekStart}<select data-set="weekStart">${opt('', '—', settings.weekStart ?? '')}${[0, 1, 6].map((d) => opt(d, tt.weekdays[d], settings.weekStart ?? '')).join('')}</select></label>
    <label class="field">${s.hemisphere}<select data-set="hemisphere">${opt('north', s.north, settings.hemisphere)}${opt('south', s.south, settings.hemisphere)}</select></label>
  </fieldset>
  <fieldset><legend>${s.theme}</legend>
    <label class="field">${s.theme}<select data-set="theme">${opt('auto', s.themeAuto, settings.theme)}${opt('light', s.themeLight, settings.theme)}${opt('dark', s.themeDark, settings.theme)}</select></label>
    <label class="field">${s.textSize}<span class="row"><button type="button" class="btn small" data-scale="-1" aria-label="${s.textSize} −">A−</button>
      <output id="scale-out">${Math.round(settings.scale * 100)}%</output><button type="button" class="btn small" data-scale="1" aria-label="${s.textSize} +">A+</button></span></label>
    ${check('contrast', s.contrast)}${check('motion', s.motion)}${check('patterns', s.patterns)}
  </fieldset>
  <fieldset><legend>${tt.myCrops}</legend><p class="muted">${tt.myCropsHint}</p>
    ${Object.keys(C.ELEMENTS).map((e) => `<h4>${icon(e)} ${tt.part[e]}</h4><div class="crop-pick">${CROPS.filter((c) => c.element === e).map((c) =>
      `<label class="check"><input type="checkbox" data-crop="${c.id}"${settings.myCrops.includes(c.id) ? ' checked' : ''}> ${esc(c.name[settings.lang])}</label>`).join('')}</div>`).join('')}
  </fieldset>
  <fieldset><legend>${s.buffers}</legend><div class="row">
    ${['nodeHours', 'perigeeHours', 'eclipseHours'].map((k) => `<label class="field">${s[k]}<input type="number" min="0" max="48" step="1" data-set="${k}" value="${settings[k]}"></label>`).join('')}</div>
  </fieldset>
  <fieldset><legend>${s.thun}</legend><p class="muted">${s.thunHint}</p>
    <textarea id="thun" dir="ltr" placeholder="${esc(s.thunExample)}">${esc(thunText())}</textarea>
    <div class="row"><button type="button" class="btn primary" id="thun-save">${s.thunSave}</button><span id="thun-msg" role="status"></span></div>
  </fieldset>
  <fieldset><legend>${s.data}</legend><div class="row">
    <button type="button" class="btn small" id="j-export">${s.exportJournal}</button>
    <label class="btn small">${s.importJournal}<input type="file" id="j-import" accept="application/json" class="sr"></label></div>
    <p class="muted"><small>${esc(s.about(meta))}</small></p>
  </fieldset>`;
  body.querySelector('[data-close]').addEventListener('click', () => $('#dlg-settings').close());
  body.querySelectorAll('[data-set]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.set;
    let v = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (k === 'weekStart') v = v === '' ? null : +v;
    if (inp.type === 'number') v = Math.max(0, Math.min(48, +v || 0));
    settings[k] = v;
    saveSettings();
    if (k === 'lang') renderSettings();
  }));
  body.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    settings.scale = Math.round(Math.min(1.6, Math.max(0.85, settings.scale + 0.1 * b.dataset.scale)) * 100) / 100;
    $('#scale-out').textContent = `${Math.round(settings.scale * 100)}%`;
    saveSettings();
  }));
  body.querySelectorAll('[data-crop]').forEach((inp) => inp.addEventListener('change', () => {
    settings.myCrops = inp.checked ? [...settings.myCrops, inp.dataset.crop] : settings.myCrops.filter((c) => c !== inp.dataset.crop);
    saveSettings();
  }));
  $('#thun-save').addEventListener('click', () => {
    try {
      thun = parseThun($('#thun').value);
      store.set('thun', thun);
      $('#thun-msg').textContent = s.thunSaved(thun.length);
      rebuildModel();
      render();
    } catch (e) { $('#thun-msg').textContent = e.message; }
  });
  $('#j-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ journal, settings, thun }, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'terraluna-journal.json' }).click();
  });
  $('#j-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      Object.assign(journal, d.journal || {});
      store.set('journal', journal);
      if (Array.isArray(d.thun)) { thun = d.thun; store.set('thun', thun); rebuildModel(); }
      render();
      toast('✓');
    } catch { toast('✗'); }
  });
}

function saveSettings() {
  store.set('settings', settings);
  applySettings();
  rebuildModel();
  state.days.clear();
  render();
}

function renderGuide() {
  const tt = t();
  const body = $('#guide-body');
  const meta = state.model?.meta || { ephemeris: 'Swiss Ephemeris', ayanamsa: 'lahiri' };
  body.innerHTML = `<div class="sheet-head"><h2 id="guide-title">${tt.guideTitle}</h2><button type="button" class="btn icon" data-close aria-label="${tt.close}">✕</button></div>
    <p><b>${esc(tt.zodiacBadge)}</b><br>${esc(tt.zodiacNote)}</p>${tt.guideBody.map((p) => `<p>${esc(p)}</p>`).join('')}<p class="muted"><small>${esc(tt.set.about(meta))}</small></p>`;
  body.querySelector('[data-close]').addEventListener('click', () => $('#dlg-guide').close());
}

// ---------------------------------------------------------------- shell

function applySettings() {
  const tt = t();
  const root = document.documentElement;
  root.lang = settings.lang;
  root.dir = tt.dir;
  if (settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = settings.theme;
  root.style.setProperty('--font-scale', settings.scale);
  root.classList.toggle('contrast', !!settings.contrast);
  root.classList.toggle('reduce-motion', !!settings.motion);
  root.classList.toggle('patterns', !!settings.patterns);
  document.title = `${tt.appName} · ${tt.tagline}`;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = tt[el.dataset.t]; });
  document.querySelectorAll('[data-view]').forEach((b) => { b.textContent = tt.views[b.dataset.view]; });
  $('#legend').innerHTML = Object.keys(C.ELEMENTS).map((e) => `<span><i class="swatch el-${e}"></i>${icon(e)} ${tt.part[e]} (${tt.element[e]})</span>`).join('')
    + `<span><i class="swatch unf"></i>⚠️ ${tt.unfavorable}</span><span>${arrow(true)} ${tt.ascending}</span><span>${arrow(false)} ${tt.descending}</span>`
    + `<span><b title="${esc(tt.zodiacNote)}">${tt.zodiacBadge}</b></span>`;
}

function title() {
  const k = state.date;
  switch (state.view) {
    case 'year': return String(yearOf(k));
    case 'month': return fmtKey(k, { month: 'long', year: 'numeric' });
    case 'week': {
      const s = C.addDays(k, -((C.weekday(k) - weekStart() + 7) % 7));
      return `${fmtKey(s, { day: 'numeric', month: 'short' })} – ${fmtKey(C.addDays(s, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    default: return fmtKey(k, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
}

function neededYears() {
  const y = yearOf(state.date);
  if (state.view === 'month' || state.view === 'week') return [yearOf(C.addDays(state.date, -40)), yearOf(C.addDays(state.date, 40))];
  return [y, y];
}

async function render() {
  const view = $('#view');
  const [y0, y1] = neededYears();
  await ensureYears(y0, y1);
  const fresh = view.cloneNode(false); // drop old listeners
  view.replaceWith(fresh);
  $('#title').textContent = title();
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  ({ hour: renderHour, day: renderDay, week: renderWeek, month: renderMonth, year: renderYear })[state.view](fresh);
  syncHash();
}

function syncHash() {
  const h = `#/${state.view}/${state.date}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function readHash() {
  const m = /^#\/(hour|day|week|month|year)\/(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
  if (m) { state.view = m[1]; state.date = m[2]; return true; }
  return false;
}

function setView(v) {
  state.view = v;
  store.set('view', v);
  render();
}

function go(key) {
  const first = `${state.available[0]}-01-01`;
  const last = `${state.available[state.available.length - 1]}-12-31`;
  state.date = key < first ? first : key > last ? last : key;
  render();
}

function step(dir) {
  const { y, m, d } = C.parseKey(state.date);
  if (state.view === 'month') { const nm = new Date(Date.UTC(y, m - 1 + dir, 1)); go(C.makeKey(nm.getUTCFullYear(), nm.getUTCMonth() + 1, Math.min(d, C.daysInMonth(nm.getUTCFullYear(), nm.getUTCMonth() + 1)))); }
  else if (state.view === 'year') go(C.makeKey(y + dir, m, Math.min(d, C.daysInMonth(y + dir, m))));
  else go(C.addDays(state.date, dir * (state.view === 'week' ? 7 : 1)));
}

function wire() {
  $('#prev').addEventListener('click', () => step(-1));
  $('#next').addEventListener('click', () => step(1));
  $('#today').addEventListener('click', () => go(todayKey()));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  const openers = { finder: renderFinder, subscribe: renderSubscribe, settings: renderSettings, guide: renderGuide };
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    openers[b.dataset.open]();
    $(`#dlg-${b.dataset.open}`).showModal();
  }));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  window.addEventListener('hashchange', () => { if (readHash()) render(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 't' || e.key === 'T' || e.key === 'א') go(todayKey());
  });
}

async function main() {
  applySettings();
  wire();
  $('#view').innerHTML = `<p>${t().loading}</p>`;
  await loadIndex();
  if (!readHash()) state.date = todayKey();
  await render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

main();
