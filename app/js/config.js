// Supabase project for syncing between devices (Supabase → Project Settings → API).
// The anon key is meant to be public: Row Level Security (supabase/schema.sql)
// keeps every person's data private. Never put the service_role key here.
// Leave empty to run without sync.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
