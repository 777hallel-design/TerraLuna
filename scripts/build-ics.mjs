// Builds the subscribable calendar feeds in app/calendar/ from app/data/.
// Usage: node scripts/build-ics.mjs [--from 2025] [--to 2028]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { buildModel, ELEMENTS } from '../app/js/core.js';
import { buildICS, buildDailyICS } from '../app/js/ics.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const now = new Date().getUTCFullYear();
const y0 = arg('from', now - 1);
const y1 = arg('to', now + 2);

const dataDir = new URL('../app/data/', import.meta.url);
const outDir = new URL('../app/calendar/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const years = [];
for (let y = y0; y <= y1; y++) {
  const f = new URL(`${y}.json`, dataDir);
  if (existsSync(f)) years.push(JSON.parse(readFileSync(f)));
}
const model = buildModel(years);
const from = Date.UTC(y0, 0, 1) / 1000;
const to = Date.UTC(y1 + 1, 0, 1) / 1000;

const feeds = {
  all: { elements: Object.keys(ELEMENTS), unfavorable: true },
  ...Object.fromEntries(Object.keys(ELEMENTS).map((e) => [e, { elements: [e], unfavorable: true }])),
  unfavorable: { elements: [], unfavorable: true },
};
for (const lang of ['he', 'en']) {
  for (const [name, f] of Object.entries(feeds)) {
    const file = new URL(`terraluna-${name}-${lang}.ics`, outDir);
    writeFileSync(file, buildICS(model, { ...f, from, to, lang }));
    console.log('wrote', file.pathname);
  }
  // Daily summary in Israel time, with a reminder at 20:00 the evening before.
  const file = new URL(`terraluna-daily-${lang}.ics`, outDir);
  writeFileSync(file, buildDailyICS(model, { from, to, lang, tz: 'Asia/Jerusalem', reminder: 'evening' }));
  console.log('wrote', file.pathname);
}
