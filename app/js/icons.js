// Inline SVG icons. Element icons take their colour from the surrounding
// .el-* class (var(--c)); UI icons use currentColor.

const wrap = (body, { size = 20, cls = '', label = '' } = {}) =>
  `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">${body}</svg>`;

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // plant parts
  earth: '<path d="M13.2 7.3 3.6 20.4l13.1-9.6c1.9-1.4 2.1-4 .5-5.6-1.6-1.6-2.8-.4-4 2.1Z" fill="var(--c)"/>'
    + '<path d="M16.4 6.6c-.3-2 .4-3.7 2-4.6M17.4 7.6c2 .3 3.7-.4 4.6-2M16.9 7.1l3-3" fill="none" stroke="var(--leaf, #4f8a45)" stroke-width="1.7" stroke-linecap="round"/>'
    + '<path d="M9 13.2l1.6 1.2M7 16l1.4 1" stroke="var(--surface)" stroke-width="1.2" stroke-linecap="round"/>',
  water: '<path d="M4.5 19.5C4.5 10.6 10.6 4.5 20 4.5c0 9.4-6.1 15-15.5 15Z" fill="var(--c)"/>'
    + '<path d="M4.5 19.5 14.5 9.5M9.5 14.5h3.6M12 12V8.6" stroke="var(--surface)" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
  air: [0, 72, 144, 216, 288].map((a) => `<ellipse cx="12" cy="6.6" rx="3.1" ry="4.4" transform="rotate(${a} 12 12)" fill="var(--c)"/>`).join('')
    + '<circle cx="12" cy="12" r="3" fill="var(--brown)"/>',
  fire: '<circle cx="12" cy="14" r="7.4" fill="var(--c)"/>'
    + '<path d="M12 7.2V4M12 7.6 8.6 6.2M12 7.6l3.4-1.4M12 7.6 9.9 9.6M12 7.6l2.1 2" stroke="var(--leaf, #4f8a45)" stroke-width="1.7" stroke-linecap="round" fill="none"/>'
    + '<path d="M8.4 13.2a3.8 3.8 0 0 1 2-2.6" stroke="var(--surface)" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".8"/>',
  // ui
  warn: '<path d="M12 3.2 2.6 19.6h18.8L12 3.2Z" fill="var(--unf)"/><path d="M12 9.5v4.6M12 16.9v.2" stroke="var(--surface)" stroke-width="2" stroke-linecap="round"/>',
  up: `<path d="M12 19V5M6 11l6-6 6 6" ${STROKE}/>`,
  down: `<path d="M12 5v14M6 13l6 6 6-6" ${STROKE}/>`,
  sprout: `<path d="M12 21v-9M12 12c0-4-3-6.5-7.5-6.5 0 4 3 6.5 7.5 6.5ZM12 14c0-3.5 2.6-6 6.8-6 0 3.6-2.6 6-6.8 6Z" ${STROKE}/>`,
  grid: `<rect x="3.5" y="4.5" width="17" height="16" rx="2.5" ${STROKE}/><path d="M3.5 9.5h17M8.5 3v3M15.5 3v3M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" ${STROKE}/>`,
  calendar: `<rect x="3.5" y="4.5" width="17" height="16" rx="2.5" ${STROKE}/><path d="M3.5 9.5h17M8.5 3v3M15.5 3v3M12 12.5v5M9.5 15h5" ${STROKE}/>`,
  book: `<path d="M12 6.5C10 5 7 4.5 3.5 5v13.5c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5ZM12 6.5V20" ${STROKE}/>`,
  sliders: `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" ${STROKE}/><circle cx="15" cy="6" r="2" ${STROKE}/><circle cx="9" cy="12" r="2" ${STROKE}/><circle cx="17" cy="18" r="2" ${STROKE}/>`,
  print: `<path d="M7 8V3.5h10V8M7 17H4.5V10a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7H17" ${STROKE}/><rect x="7" y="13.5" width="10" height="7" rx="1" ${STROKE}/>`,
  speaker: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" ${STROKE}/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" ${STROKE}/>`,
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5ZM10 20.5a2 2 0 0 0 4 0" ${STROKE}/>`,
  close: `<path d="M6 6l12 12M18 6 6 18" ${STROKE}/>`,
  prev: `<path d="M15 5l-7 7 7 7" ${STROKE}/>`,
  next: `<path d="M9 5l7 7-7 7" ${STROKE}/>`,
  link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" ${STROKE}/>`,
  sun: `<circle cx="12" cy="12" r="4" ${STROKE}/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" ${STROKE}/>`,
  moon: `<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" ${STROKE}/>`,
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" fill="currentColor"/>',
  info: `<circle cx="12" cy="12" r="8.5" ${STROKE}/><path d="M12 11v5.5M12 7.8v.2" ${STROKE}/>`,
};

export const svg = (name, opts) => wrap(PATHS[name], opts);

/** Moon drawn at a given age (0 new, 0.5 full) as seen from the northern hemisphere. */
export function moonSvg(age, { size = 18, south = false } = {}) {
  const a = ((south ? 1 - age : age) % 1 + 1) % 1;
  const r = 9;
  const rx = Math.abs(Math.cos(2 * Math.PI * a)) * r;
  const waxing = a < 0.5;
  const outer = waxing ? 1 : 0;
  const crescent = a < 0.25 || a > 0.75;
  const term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
  const lit = a > 0.985 || a < 0.015 ? ''
    : `<path d="M12 3A${r} ${r} 0 0 ${outer} 12 21A${rx.toFixed(2)} ${r} 0 0 ${term} 12 3Z" fill="var(--moon-lit)"/>`;
  return wrap(`<circle cx="12" cy="12" r="${r}" fill="var(--moon-dark)"/>${lit}<circle cx="12" cy="12" r="${r}" fill="none" stroke="var(--moon-edge)" stroke-width="1"/>`, { size, cls: 'moon' });
}
export const PHASE_AGE = { new: 0, first: 0.25, full: 0.5, last: 0.75 };
