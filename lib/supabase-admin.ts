import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client (service_role). Node scripts and ingest jobs.
// MUST NOT be imported from app/ — would leak SUPABASE_SECRET_KEY into the
// static bundle. Use lib/supabase.ts (publishable, RLS-bound) on the browser.
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required for admin operations");
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
