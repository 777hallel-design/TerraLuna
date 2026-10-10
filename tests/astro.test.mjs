import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { riseSet, PLACES } from '../app/js/astro.js';

// Reference times from Swiss Ephemeris swe.rise_trans for Jerusalem, October 2026.
const ref = JSON.parse(readFileSync(new URL('./fixtures/riseset-jerusalem-2026-10.json', import.meta.url)));
const place = PLACES.find((p) => p.id === 'jerusalem');
const a = Date.UTC(2026, 9, 1) / 1000;
const b = Date.UTC(2026, 10, 1) / 1000;

for (const body of ['moon', 'sun']) {
  test(`${body} rise/set within 3 minutes of Swiss Ephemeris`, () => {
    const got = riseSet(body, a, b, place);
    for (const kind of ['rise', 'set']) {
      assert.equal(got[kind].length, ref[body][kind].length, `${body} ${kind} count`);
      let worst = 0;
      got[kind].forEach((t, i) => { worst = Math.max(worst, Math.abs(t - ref[body][kind][i])); });
      assert.ok(worst <= 180, `${body} ${kind} worst error ${worst}s`);
    }
  });
}
