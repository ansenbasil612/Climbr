import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// For API routes: builds a Supabase client authenticated as the user who
// owns `accessToken` (their Supabase session token, sent from the client),
// so RLS policies keyed on auth.uid() apply to every query made with it.
export function createSupabaseForToken(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

// SERVER-ONLY, TRUSTED-CONTEXT-ONLY. Bypasses RLS entirely using the Supabase
// service role key. There is no user session in a cron job, so this is how
// the cron route can write quests for every user's goals. Never import this
// from a client component, never expose SUPABASE_SERVICE_ROLE_KEY as
// NEXT_PUBLIC_, and only call it from routes that verify a server-side secret
// (e.g. the cron route checking CRON_SECRET) before doing anything with it.
export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}