import { createClient, SupabaseClient } from '@supabase/supabase-js';

const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** DB + Storage only. Never call `auth.getUser` on this client — that attaches a user JWT and PostgREST will apply RLS instead of bypassing with the service role. */
let dbClient: SupabaseClient | null = null;

/** JWT verification in AuthGuard only. Same keys as `getSupabase`, separate instance so user sessions never touch the DB client. */
let authVerifier: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!dbClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    dbClient = createClient(url, key, authOptions);
  }
  return dbClient;
}

export function getSupabaseAuthVerifier(): SupabaseClient {
  if (!authVerifier) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    authVerifier = createClient(url, key, authOptions);
  }
  return authVerifier;
}
