import { dataset, type Ingredient } from "./data-loader";

// 인메모리 검색 — Phase 5: Supabase 의존 제거.
// public/data/*.json (브라우저 ETag 자동 비교) 의 인덱스만 사용.

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

function sanitize(s: string): string {
  return s.replace(/[,()%_\\"]/g, " ").trim();
}

function findIngredient(query: string): Ingredient | null {
  // 비동기 호출 가능을 위해 dataset() await 가 외부에서 보장됨 (lookupRegulation 가 await)
  // 여기선 sync 보조함수
  return null;
}

function findIngredientSync(
  query: string,
  ds: Awaited<ReturnType<typeof dataset>>,
): Ingredient | null {
  const safe = sanitize(query).toLowerCase();
  if (!safe) return null;

  // 1) exact INCI
  const inci = ds.ingredientByInciLower.get(safe);
  if (inci) return inci;

  // 2) exact Korean
  const kor = ds.ingredientByKoreanLower.get(safe);
  if (kor) return kor;

  // 3) CAS 정확 매칭 (CAS 형식만)
  if (/^\d{1,7}-\d{2}-\d$/.test(query.trim())) {
    const cas = ds.ingredientByCas.get(query.trim());
    if (cas) return cas;
  }

  // 4) substring 검색 — INCI / Korean / Chinese / Japanese
  for (const ing of ds.ingredients) {
    if (ing.inci_name && ing.inci_name.toLowerCase().includes(safe)) return ing;
    if (ing.korean_name && ing.korean_name.toLowerCase().includes(safe)) return ing;
    if (ing.chinese_name && ing.chinese_name.includes(query)) return ing;
    if (ing.japanese_name && ing.japanese_name.includes(query)) return ing;
  }
  return null;
}

export async function lookupRegulation(
  query: string,
  countries?: string[],
): Promise<LookupResponse> {
  const ds = await dataset();
  const q = query.trim();
  if (!q) return { query: q, ingredient: null, results: [] };

  const ingredient = findIngredientSync(q, ds);
  if (!ingredient) return { query: q, ingredient: null, results: [] };

  const targetCodes = countries && countries.length > 0
    ? countries
    : ds.countries.map((c) => c.code);

  const regsForIngredient = ds.regsByIngredientCountry.get(ingredient.id);

  const results: CountryLookupResult[] = [];
  for (const code of targetCodes) {
    const country = ds.countryByCode.get(code);
    if (!country) continue;

    // bucket 은 priority desc → last_verified desc 로 미리 정렬됨 — [0] 이 1차 우선.
    let row = regsForIngredient?.get(code)?.[0];

    // 상속 fallback (예: VN inherits EU)
    let fromInherit: string | null = null;
    if (!row && country.inherits_from) {
      row = regsForIngredient?.get(country.inherits_from)?.[0];
      if (row) fromInherit = country.inherits_from;
    }

    if (row) {
      results.push({
        country_code: code,
        country_name_ko: country.name_ko,
        regulation_type: country.regulation_type,
        source: "verified",
        status: row.status as CountryLookupResult["status"],
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

    // quarantine pending lookup — name_raw substring match against current ingredient
    const quarMap = ds.quarantineByCountryName.get(code);
    if (quarMap) {
      const lowerInci = ingredient.inci_name.toLowerCase();
      let pendingHit: { rejection_reason: string | null } | null = null;
      for (const [name, q] of quarMap) {
        if (lowerInci.includes(name) || name.includes(lowerInci)) {
          pendingHit = q;
          break;
        }
      }
      if (pendingHit) {
        results.push({
          country_code: code,
          country_name_ko: country.name_ko,
          regulation_type: country.regulation_type,
          source: "pending",
          pending_reason: pendingHit.rejection_reason ?? undefined,
        });
        continue;
      }
    }

    results.push({
      country_code: code,
      country_name_ko: country.name_ko,
      regulation_type: country.regulation_type,
      source: "not_found",
    });
  }

  return { query: q, ingredient, results };
}
