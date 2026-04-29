import { supabaseClient } from "./supabase";

export interface Suggestion {
  inci_name: string;
  korean_name: string | null;
  cas_no: string | null;
}

// Sanitize user input: remove chars that could become unintended ILIKE wildcards
// (%, _) or other metachars. PostgREST .or() string is not used here.
function sanitize(s: string): string {
  return s.replace(/[,()%_\\"]/g, " ").trim();
}

export async function fetchSuggestions(rawQuery: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const raw = rawQuery.trim();
  if (raw.length === 0 || raw.length > 128) return [];
  const safe = sanitize(raw);
  if (safe.length < 1) return [];

  const supabase = supabaseClient();
  const pattern = `${safe}%`;

  const [kr, eng] = await Promise.all([
    supabase
      .from("ingredients")
      .select("inci_name, korean_name, cas_no")
      .ilike("korean_name", pattern)
      .order("korean_name", { ascending: true })
      .limit(8)
      .abortSignal(signal as AbortSignal),
    supabase
      .from("ingredients")
      .select("inci_name, korean_name, cas_no")
      .ilike("inci_name", pattern)
      .order("inci_name", { ascending: true })
      .limit(8)
      .abortSignal(signal as AbortSignal),
  ]);
  if (kr.error) throw new Error(kr.error.message);
  if (eng.error) throw new Error(eng.error.message);

  const seen = new Set<string>();
  const merged: Suggestion[] = [];
  for (const row of [...(kr.data ?? []), ...(eng.data ?? [])]) {
    if (seen.has(row.inci_name)) continue;
    seen.add(row.inci_name);
    merged.push(row as Suggestion);
    if (merged.length >= 8) break;
  }
  return merged;
}
