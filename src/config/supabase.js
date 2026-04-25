/**
 * Service-role Supabase client. Bypasses RLS — server-only.
 *
 * We use this instead of a raw pg pool so the backend doesn't depend on
 * POSTGRES_URL / pgbouncer auth. Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * from the environment.
 */

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn(
    '[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing — ' +
      'service-role queries will fail until both are set.',
  );
}

const supabaseAdmin = createClient(url || 'https://invalid', key || 'invalid', {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = supabaseAdmin;
