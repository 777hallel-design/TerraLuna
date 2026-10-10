import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeJournal, pendingJournal, pick, syncNow, useClientForTests } from '../app/js/sync.js';

test('merge: newest edit per day wins, empty text deletes', () => {
  const local = { journal: { '2026-10-10': 'old', '2026-10-11': 'keep' }, meta: { '2026-10-10': 100, '2026-10-11': 500 } };
  const changed = mergeJournal(local, [
    { day: '2026-10-10', text: 'new', client_updated: 200 },
    { day: '2026-10-11', text: 'stale', client_updated: 400 },
    { day: '2026-10-12', text: '', client_updated: 300 },
  ]);
  assert.equal(changed, true);
  assert.deepEqual(local.journal, { '2026-10-10': 'new', '2026-10-11': 'keep' });
  assert.equal(local.meta['2026-10-12'], 300);
});

test('pending: only entries edited after the last push, deletions included', () => {
  const rows = pendingJournal({ journal: { a: 'x' }, meta: { a: 50, b: 150, c: 10 } }, 100, 'u');
  assert.deepEqual(rows, [{ user_id: 'u', day: 'b', text: '', client_updated: 150 }]);
  assert.equal(pick(1, 2), 'remote');
  assert.equal(pick(3, 2), 'local');
});

// Minimal in-memory stand-in for the parts of supabase-js that sync uses.
function fakeSupabase(userId) {
  const tables = { journal_entries: [], profiles: [] };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
  const query = (name) => {
    let rows = () => tables[name].filter((r) => r.user_id === userId);
    const q = {
      select() { return q; },
      order(col) { const prev = rows; rows = () => [...prev()].sort((a, b) => (a[col] < b[col] ? -1 : 1)); return q; },
      gte(col, v) { const prev = rows; rows = () => prev().filter((r) => r[col] >= v); return q; },
      eq(col, v) { const prev = rows; rows = () => prev().filter((r) => r[col] === v); return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (ok) => ok({ data: rows().map((r) => ({ ...r })), error: null }),
      upsert: async (input, { onConflict }) => {
        const keys = onConflict.split(',');
        for (const row of [].concat(input)) {
          const hit = tables[name].find((r) => keys.every((k) => r[k] === row[k]));
          if (hit) Object.assign(hit, row, { server_updated: stamp() });
          else tables[name].push({ ...row, server_updated: stamp() });
        }
        return { error: null };
      },
    };
    return q;
  };
  return { tables, from: query, auth: { getSession: async () => ({ data: { session: { user: { id: userId, email: 'a@b.c' } } } }) } };
}

test('two devices converge through the server', async () => {
  const server = fakeSupabase('u1');
  useClientForTests(server);
  const phone = { journal: { '2026-10-10': 'זרעתי גזר' }, meta: { '2026-10-10': 1000 }, settings: { lang: 'he', myCrops: ['carrot'] }, settingsT: 1000, thun: [], thunT: 0 };
  const laptop = { journal: {}, meta: {}, settings: { lang: 'en' }, settingsT: 0, thun: [{ start: 1, end: 2, note: 'x' }], thunT: 2000 };

  await syncNow(phone);
  let r = await syncNow(laptop);
  assert.deepEqual(laptop.journal, { '2026-10-10': 'זרעתי גזר' });
  assert.equal(r.changed.settings, true);
  assert.deepEqual(laptop.settings, { lang: 'he', myCrops: ['carrot'] });
  assert.equal(laptop.thun.length, 1);

  // The laptop edits the entry and deletes nothing; the phone deletes another day.
  laptop.journal['2026-10-10'] = 'זרעתי גזר וסלק';
  laptop.meta['2026-10-10'] = Date.now() + 1000;
  await syncNow(laptop);
  r = await syncNow(phone);
  assert.equal(phone.journal['2026-10-10'], 'זרעתי גזר וסלק');
  assert.equal(phone.thun.length, 1);
  assert.equal(server.tables.journal_entries.length, 1);
});
