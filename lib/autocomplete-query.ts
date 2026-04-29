import { dataset } from "./data-loader";

export interface Suggestion {
  inci_name: string;
  korean_name: string | null;
  cas_no: string | null;
}

function sanitize(s: string): string {
  return s.replace(/[,()%_\\"]/g, " ").trim();
}

export async function fetchSuggestions(rawQuery: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const raw = rawQuery.trim();
  if (raw.length === 0 || raw.length > 128) return [];
  const safe = sanitize(raw).toLowerCase();
  if (safe.length < 1) return [];

  const ds = await dataset();
  if (signal?.aborted) return [];

  const results: Suggestion[] = [];
  const seen = new Set<string>();

  // 1) Korean prefix
  for (const ing of ds.ingredients) {
    if (results.length >= 8) break;
    if (signal?.aborted) return [];
    if (ing.korean_name && ing.korean_name.toLowerCase().startsWith(safe)) {
      if (!seen.has(ing.inci_name)) {
        seen.add(ing.inci_name);
        results.push({ inci_name: ing.inci_name, korean_name: ing.korean_name, cas_no: ing.cas_no });
      }
    }
  }

  // 2) INCI prefix
  for (const ing of ds.ingredients) {
    if (results.length >= 8) break;
    if (signal?.aborted) return [];
    if (ing.inci_name && ing.inci_name.toLowerCase().startsWith(safe)) {
      if (!seen.has(ing.inci_name)) {
        seen.add(ing.inci_name);
        results.push({ inci_name: ing.inci_name, korean_name: ing.korean_name, cas_no: ing.cas_no });
      }
    }
  }

  return results;
}
