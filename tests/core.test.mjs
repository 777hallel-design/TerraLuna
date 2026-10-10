import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, dayInfo, findWindows, zonedToUnix, keyOf, signAt, SIGNS } from '../app/js/core.js';

const load = (y) => JSON.parse(readFileSync(new URL(`../app/data/${y}.json`, import.meta.url)));
const model = buildModel([load(2026), load(2027)]);
const utc = (s) => Date.parse(s) / 1000;

test('sidereal sign ingresses match astro-seek (Lahiri) within 2 minutes', () => {
  // astro-seek, Oct 2026, UT: Libra 11th 04:34, Scorpio 13th 13:43, Sagittarius 16th 01:18
  for (const [iso, sign] of [['2026-10-11T04:34Z', 'libra'], ['2026-10-13T13:43Z', 'scorpio'], ['2026-10-16T01:18Z', 'sagittarius']]) {
    const p = model.signPeriods.find((q) => SIGNS[q.sign] === sign && Math.abs(q.start - utc(iso)) < 120);
    assert.ok(p, `${sign} ingress near ${iso}`);
  }
  assert.equal(SIGNS[signAt(model, utc('2026-10-10T12:00Z')).sign], 'virgo');
});

test('new moon 10 Oct 2026 15:50 UT and full moon 26 Oct 04:12 UT', () => {
  assert.ok(model.phases.some((p) => p.phase === 'new' && Math.abs(p.t - utc('2026-10-10T15:50Z')) < 120));
  assert.ok(model.phases.some((p) => p.phase === 'full' && Math.abs(p.t - utc('2026-10-26T04:12Z')) < 120));
});

test('time zone conversion handles DST in Jerusalem', () => {
  assert.equal(zonedToUnix(2026, 7, 1, 0, 0, 'Asia/Jerusalem'), utc('2026-06-30T21:00Z'));
  assert.equal(zonedToUnix(2026, 12, 1, 0, 0, 'Asia/Jerusalem'), utc('2026-11-30T22:00Z'));
  assert.equal(keyOf(utc('2026-10-10T22:30Z'), 'Asia/Jerusalem'), '2026-10-11');
});

test('day info: segments cover the whole day and nodes are unfavourable', () => {
  const d = dayInfo(model, '2026-10-07', 'UTC');
  assert.equal(d.segments[0].start, d.start);
  assert.equal(d.segments.at(-1).end, d.end);
  assert.equal(d.nodes.length, 1);
  assert.ok(d.unfavorable.length >= 1);
  assert.ok(d.unfavorableSecs >= 7 * 3600);
});

test('overrides replace computed windows for their year', () => {
  const m = buildModel([load(2026)], { overrides: [{ start: utc('2026-10-07T00:00Z'), end: utc('2026-10-07T03:00Z'), note: 'Thun' }] });
  const d = dayInfo(m, '2026-10-07', 'UTC');
  assert.equal(d.unfavorable.length, 1);
  assert.equal(d.unfavorable[0].reasons[0].type, 'manual');
  assert.equal(m.unfavorable.filter((w) => w.reasons.some((r) => r.type !== 'manual') && new Date(w.start * 1000).getUTCFullYear() === 2026).length, 0);
});

test('windows never overlap unfavourable times', () => {
  const a = utc('2026-10-01T00:00Z');
  const w = findWindows(model, a, a + 60 * 86400, 'earth');
  assert.ok(w.length > 3);
  for (const x of w) for (const u of model.unfavorable) assert.ok(x.end <= u.start || x.start >= u.end);
});

test('zodiac is sidereal, not tropical', () => {
  assert.equal(model.meta.zodiac, 'sidereal-equal-30');
  // 10 Oct 2026 12:00 UT: tropical Libra 15°, sidereal (Lahiri) Virgo 21°
  assert.equal(SIGNS[signAt(model, utc('2026-10-10T12:00Z')).sign], 'virgo');
});

test('main moon phases are only named close to the exact moment', () => {
  assert.equal(dayInfo(model, '2026-10-10', 'UTC').moon.name, 'new');
  assert.equal(dayInfo(model, '2026-10-12', 'UTC').moon.name, 'waxing-crescent');
  assert.equal(dayInfo(model, '2026-10-26', 'UTC').moon.name, 'full');
});
