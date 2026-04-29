import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-safe Supabase client (publishable key, RLS-enforced).
// supabaseAdmin (service_role) lives in lib/supabase-admin.ts for Node scripts.
let cached: SupabaseClient | null = null;

export function supabaseClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
