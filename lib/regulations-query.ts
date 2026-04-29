import { supabaseClient } from "./supabase";

// Escape PostgREST ILIKE special chars AND filter-string separators. Commas, parens,
// backslashes, and wildcards (%, _) can let user input corrupt an `or()` filter string
// or inject additional filters. Removing them is safer than half-escaping.
function sanitizeIlikeValue(s: string): string {
  return s.replace(/[,()%_\\"]/g, " ").trim();
}

const INGREDIENT_COLS =
  "id, inci_name, korean_name, chinese_name, japanese_name, cas_no, synonyms, description, function_category, function_description";

export type LookupSource = "verified" | "pending" | "not_found";
export type RegulationType = "negative_list" | "positive_list" | "hybrid";

export interface CountryLookupResult {
  country_code: string;
  country_name_ko: string;
  regulation_type: RegulationType;
  source: LookupSource;
  status?: "banned" | "restricted" | "allowed" | "listed" | "not_listed";
  max_concentration?: number | null;
  concentration_unit?: string | null;
  product_categories?: string[];
  conditions?: string | null;
  source_url?: string | null;
  source_document?: string | null;
  confidence_score?: number | null;
  last_verified_at?: string;
  pending_reason?: string;
  inherits_from?: string | null;
  override_note?: string | null;
}

export interface IngredientMatch {
  id: string;
  inci_name: string;
  korean_name: string | null;
  chinese_name: string | null;
  japanese_name: string | null;
  cas_no: string | null;
  synonyms: string[];
  description: string | null;
  function_category: string | null;
  function_description: string | null;
}

export interface LookupResponse {
  query: string;
  ingredient: IngredientMatch | null;
  results: CountryLookupResult[];
}

export async function lookupRegulation(
  query: string,
  countries?: string[],
): Promise<LookupResponse> {
  const supabase = supabaseClient();
  const q = query.trim();
  const safe = sanitizeIlikeValue(q);
  if (!safe) return { query: q, ingredient: null, results: [] };

  // Priority 1: exact INCI match
  const { data: exact } = await supabase
    .from("ingredients")
    .select(INGREDIENT_COLS)
    .ilike("inci_name", safe)
    .limit(1);

  // Priority 2: exact korean_name match
  const { data: korExact } = exact?.length
    ? { data: null }
    : await supabase
        .from("ingredients")
        .select(INGREDIENT_COLS)
        .ilike("korean_name", safe)
        .limit(1);

  // Priority 3: CAS substring match (multi-CAS stored as "A\nB")
  const looksLikeCas = /^\d{1,7}-\d{2}-\d$/.test(q);
  const { data: casMatch } =
    exact?.length || korExact?.length || !looksLikeCas
      ? { data: null }
      : await supabase
          .from("ingredients")
          .select(INGREDIENT_COLS)
          .ilike("cas_no", `%${safe}%`)
          .limit(1);

  // Priority 4: fuzzy substring across all name fields (parallel, no or() string)
  let fuzzyMatch: IngredientMatch | undefined;
  if (!exact?.length && !korExact?.length && !casMatch?.length) {
    const pattern = `%${safe}%`;
    const fields = ["inci_name", "korean_name", "chinese_name", "japanese_name"] as const;
    const parallel = await Promise.all(
      fields.map((f) =>
        supabase.from("ingredients").select(INGREDIENT_COLS).ilike(f, pattern).limit(1),
      ),
    );
    fuzzyMatch = parallel.map((r) => r.data?.[0]).find(Boolean) as IngredientMatch | undefined;
  }

  const ingredient =
    (exact?.[0] ?? korExact?.[0] ?? casMatch?.[0] ?? fuzzyMatch) as IngredientMatch | undefined;
  if (!ingredient) return { query: q, ingredient: null, results: [] };

  const { data: countryRows } = await supabase
    .from("countries")
    .select("code, name_ko, inherits_from, regulation_type");
  const countryMap = new Map<
    string,
    { name_ko: string; inherits_from: string | null; regulation_type: RegulationType }
  >();
  (countryRows ?? []).forEach((c) =>
    countryMap.set(c.code as string, {
      name_ko: c.name_ko as string,
      inherits_from: (c.inherits_from as string) ?? null,
      regulation_type: ((c.regulation_type as RegulationType) ?? "negative_list"),
    }),
  );

  const targetCountries = countries && countries.length > 0
    ? countries
    : Array.from(countryMap.keys());

  // migration 0005: view regulations_active 는 valid_from <= now() AND
  // (valid_to IS NULL OR valid_to > now()) 필터를 캡슐화.
  // 기존 행은 valid_from default now()·valid_to null로 항상 활성.
  const { data: regs } = await supabase
    .from("regulations_active")
    .select("*")
    .eq("ingredient_id", ingredient.id)
    .in("country_code", targetCountries);

  const { data: quars } = await supabase
    .from("regulation_quarantine")
    .select("country_code, rejection_reason, status")
    .eq("status", "pending")
    .in("country_code", targetCountries)
    .ilike("ingredient_name_raw", `%${ingredient.inci_name}%`);

  type RegRow = NonNullable<typeof regs>[number];
  type QuarRow = NonNullable<typeof quars>[number];
  const regByCountry = new Map<string, RegRow>();
  (regs ?? []).forEach((r) => regByCountry.set(r.country_code as string, r));
  const quarByCountry = new Map<string, QuarRow>();
  (quars ?? []).forEach((q) => quarByCountry.set(q.country_code as string, q));

  const results: CountryLookupResult[] = [];

  for (const code of targetCountries) {
    const meta = countryMap.get(code);
    if (!meta) continue;

    // Direct verified row
    let row = regByCountry.get(code);

    // Inheritance: fall back to parent (e.g. VN inherits EU)
    let fromInherit: string | null = null;
    if (!row && meta.inherits_from) {
      row = regByCountry.get(meta.inherits_from);
      if (row) fromInherit = meta.inherits_from;
    }

    if (row) {
      results.push({
        country_code: code,
        country_name_ko: meta.name_ko,
        regulation_type: meta.regulation_type,
        source: "verified",
        status: row.status,
        max_concentration: row.max_concentration,
        concentration_unit: row.concentration_unit,
        product_categories: row.product_categories ?? [],
        conditions: row.conditions,
        source_url: row.source_url,
        source_document: row.source_document,
        confidence_score: row.confidence_score,
        last_verified_at: row.last_verified_at,
        inherits_from: fromInherit,
        override_note: row.override_note,
      });
      continue;
    }

    const quar = quarByCountry.get(code);
    if (quar) {
      results.push({
        country_code: code,
        country_name_ko: meta.name_ko,
        regulation_type: meta.regulation_type,
        source: "pending",
        pending_reason: quar.rejection_reason,
      });
      continue;
    }

    results.push({
      country_code: code,
      country_name_ko: meta.name_ko,
      regulation_type: meta.regulation_type,
      source: "not_found",
    });
  }

  return { query: q, ingredient, results };
}
