// Sync between devices through Supabase. The app keeps working from local
// storage; sync pulls what changed elsewhere and pushes local changes.
// Conflicts: the newest edit wins, per journal day and for settings / Thun times.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const syncConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;
let testClient = null;
/** Tests pass an in-memory stand-in for the Supabase client. */
export function useClientForTests(c) { testClient = c; clientPromise = Promise.resolve(c); }
function client() {
  if (!clientPromise) {
    clientPromise = import(LIB).then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    }));
  }
  return clientPromise;
}

export async function currentUser() {
  if (!syncConfigured() && !testClient) return null;
  const c = await client();
  const { data } = await c.auth.getSession();
  return data.session?.user ?? null;
}

export async function onAuthChange(cb) {
  if (!syncConfigured()) return;
  const c = await client();
  c.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}

/** Email a sign-in link (and a 6-digit code, if the email template includes it). */
export async function sendSignIn(email, redirectTo) {
  const c = await client();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const c = await client();
  const { error } = await c.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  const c = await client();
  await c.auth.signOut();
}

// ---------------------------------------------------------------- merging (pure, tested)

/**
 * Apply remote journal rows to the local journal.
 * @param {object} local  {journal: {day: text}, meta: {day: ms}}
 * @param {object[]} rows [{day, text, client_updated}]
 * @returns {boolean} whether anything changed locally
 */
export function mergeJournal(local, rows) {
  let changed = false;
  for (const r of rows) {
    const remote = Number(r.client_updated);
    if (remote <= (local.meta[r.day] || 0)) continue;
    if (r.text) local.journal[r.day] = r.text; else delete local.journal[r.day];
    local.meta[r.day] = remote;
    changed = true;
  }
  return changed;
}

/** Local journal entries edited after `since` (ms), as rows to upsert. */
export function pendingJournal(local, since, userId) {
  return Object.entries(local.meta)
    .filter(([, t]) => t > since)
    .map(([day, t]) => ({ user_id: userId, day, text: local.journal[day] || '', client_updated: t }));
}

/** Newest-wins choice between a local and a remote value with timestamps. */
export function pick(localT, remoteT) {
  if (remoteT > localT) return 'remote';
  if (localT > remoteT) return 'local';
  return 'same';
}

// ---------------------------------------------------------------- one sync round

/**
 * @param {object} s  local state, mutated in place:
 *   {journal, meta, settings, settingsT, thun, thunT, lastServer, lastPush}
 * @returns {{changed: {journal, settings, thun}, at: number}}
 */
export async function syncNow(s) {
  const c = await client();
  const user = await currentUser();
  if (!user) throw new Error('signed-out');
  const startedAt = Date.now();
  const changed = { journal: false, settings: false, thun: false };

  // Pull journal rows changed on the server since the last round.
  let q = c.from('journal_entries').select('day,text,client_updated,server_updated').order('server_updated');
  if (s.lastServer) q = q.gte('server_updated', s.lastServer);
  const { data: rows, error } = await q;
  if (error) throw error;
  changed.journal = mergeJournal(s, rows);
  for (const r of rows) if (!s.lastServer || r.server_updated > s.lastServer) s.lastServer = r.server_updated;

  // Push local journal edits.
  const push = pendingJournal(s, s.lastPush || 0, user.id);
  if (push.length) {
    const { error: e2 } = await c.from('journal_entries').upsert(push, { onConflict: 'user_id,day' });
    if (e2) throw e2;
  }

  // Settings and Thun times: one row per person, newest wins per field.
  const { data: prof, error: e3 } = await c.from('profiles')
    .select('settings,settings_updated,thun,thun_updated').eq('user_id', user.id).maybeSingle();
  if (e3) throw e3;
  const update = {};
  const st = pick(s.settingsT || 0, Number(prof?.settings_updated || 0));
  if (st === 'remote') { s.settings = prof.settings; s.settingsT = Number(prof.settings_updated); changed.settings = true; }
  else if (st === 'local') Object.assign(update, { settings: s.settings, settings_updated: s.settingsT });
  const tt = pick(s.thunT || 0, Number(prof?.thun_updated || 0));
  if (tt === 'remote') { s.thun = prof.thun || []; s.thunT = Number(prof.thun_updated); changed.thun = true; }
  else if (tt === 'local') Object.assign(update, { thun: s.thun, thun_updated: s.thunT });
  if (Object.keys(update).length) {
    const { error: e4 } = await c.from('profiles').upsert({ user_id: user.id, ...update }, { onConflict: 'user_id' });
    if (e4) throw e4;
  }

  s.lastPush = startedAt;
  return { changed, at: Date.now() };
}
