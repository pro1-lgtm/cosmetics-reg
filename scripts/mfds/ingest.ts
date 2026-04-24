import { loadEnv } from "../crawlers/env";
loadEnv();

import { supabaseAdmin } from "../../lib/supabase";
import { fetchAllPages } from "./client";
import { mapCountryName, getUnknownCountries } from "./country-mapping";
import type {
  IngredientMasterItem,
  UseRestrictionItem,
  CountryDetailItem,
} from "./types";

const SOURCE_DOC = "MFDS 공공데이터 API";
const SOURCE_URL_BASE = "https://www.data.go.kr/data";

interface CanonicalIngredient {
  inci_name: string;
  korean_name: string | null;
  chinese_name: string | null;
  japanese_name: string | null;
  cas_no: string | null;
  synonyms: string[];
  description: string | null;
}

// ============================================================
// Stage 1: Pull + build canonical ingredient records (memory)
// ============================================================
function parseSynonyms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Split on semicolon, newline, slash, or **comma-followed-by-space** only.
  // Plain commas without space are kept (chemical names like "2,4,5-Trimethyl..." contain them).
  return raw
    .split(/[;\n\r/]|,\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeInci(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function stage1IngredientMaster(
  ing: IngredientMasterItem[],
): Promise<Map<string, CanonicalIngredient>> {
  const byInci = new Map<string, CanonicalIngredient>();
  let skippedNoEng = 0;

  for (const row of ing) {
    const inci = normalizeInci(row.INGR_ENG_NAME);
    if (!inci) {
      skippedNoEng++;
      continue;
    }
    const korean = normalizeInci(row.INGR_KOR_NAME);
    const existing = byInci.get(inci);
    const synonyms = parseSynonyms(row.INGR_SYNONYM);
    byInci.set(inci, {
      inci_name: inci,
      korean_name: existing?.korean_name ?? korean,
      chinese_name: existing?.chinese_name ?? null,
      japanese_name: existing?.japanese_name ?? null,
      cas_no: existing?.cas_no ?? normalizeInci(row.CAS_NO),
      synonyms: Array.from(new Set([...(existing?.synonyms ?? []), ...synonyms])),
      description: existing?.description ?? row.ORIGIN_MAJOR_KOR_NAME,
    });
  }

  console.log(
    `  master: 21K raw → ${byInci.size} unique INCI (skipped ${skippedNoEng} rows without INGR_ENG_NAME)`,
  );
  return byInci;
}

function mergeRestrictionIngredients(
  map: Map<string, CanonicalIngredient>,
  rows: UseRestrictionItem[],
) {
  let skippedNoEng = 0;
  for (const r of rows) {
    const inci = normalizeInci(r.INGR_ENG_NAME);
    if (!inci) {
      skippedNoEng++;
      continue;
    }
    const existing = map.get(inci);
    const synonyms = parseSynonyms(r.INGR_SYNONYM);
    const korean = normalizeInci(r.INGR_STD_NAME);
    const cas = normalizeInci(r.CAS_NO);
    if (existing) {
      existing.korean_name = existing.korean_name ?? korean;
      existing.cas_no = existing.cas_no ?? cas;
      existing.synonyms = Array.from(new Set([...existing.synonyms, ...synonyms]));
    } else {
      map.set(inci, {
        inci_name: inci,
        korean_name: korean,
        chinese_name: null,
        japanese_name: null,
        cas_no: cas,
        synonyms,
        description: null,
      });
    }
  }
  if (skippedNoEng) {
    console.log(`    (restriction rows without INGR_ENG_NAME: ${skippedNoEng} skipped)`);
  }
}

// ============================================================
// Stage 2: Bulk upsert ingredients to DB, return id map
// ============================================================
async function upsertIngredients(
  supabase: ReturnType<typeof supabaseAdmin>,
  ingredients: CanonicalIngredient[],
): Promise<Map<string, string>> {
  const BATCH = 500;
  const idMap = new Map<string, string>();

  for (let i = 0; i < ingredients.length; i += BATCH) {
    const slice = ingredients.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("ingredients")
      .upsert(
        slice.map((r) => ({
          inci_name: r.inci_name,
          korean_name: r.korean_name,
          chinese_name: r.chinese_name,
          japanese_name: r.japanese_name,
          cas_no: r.cas_no,
          synonyms: r.synonyms,
          description: r.description,
        })),
        { onConflict: "inci_name" },
      )
      .select("id, inci_name");
    if (error) throw new Error(`Ingredient upsert batch ${i}: ${error.message}`);
    for (const row of data ?? []) {
      idMap.set(row.inci_name as string, row.id as string);
    }
    console.log(`    upserted ${Math.min(i + BATCH, ingredients.length)}/${ingredients.length}`);
  }

  return idMap;
}

// ============================================================
// Stage 3: Build regulations (deduped per ingredient×country)
// ============================================================
interface RegulationRow {
  ingredient_id: string;
  country_code: string;
  status: "banned" | "restricted" | "allowed" | "listed" | "not_listed" | "unknown";
  max_concentration: number | null;
  concentration_unit: string;
  product_categories: string[];
  conditions: string | null;
  source_url: string;
  source_document: string;
  last_verified_at: string;
  auto_verified: boolean;
  confidence_score: number;
}

// MFDS REGULATE_TYPE은 "금지" | "제한" 외의 값도 포함 (영어/다국어/빈 문자열).
// 키워드 미매칭 시 LIMIT_COND·PROVIS_ATRCL 텍스트로 보조 판별: 배합한도·최대농도·limit 등이
// 있으면 사실상 restricted. 이 로직 없으면 9K+ 행이 부당하게 "unknown"으로 분류됨.
function mapRegulateType(t: string, limitCond?: string | null, provis?: string | null): RegulationRow["status"] {
  const bannedRe = /금지|배합금지|ban|prohibit/i;
  const restrictedRe = /제한|배합한도|limit|restric|maximum|최대/i;
  if (bannedRe.test(t)) return "banned";
  if (restrictedRe.test(t)) return "restricted";
  const aux = `${limitCond ?? ""}\n${provis ?? ""}`;
  if (bannedRe.test(aux)) return "banned";
  if (restrictedRe.test(aux)) return "restricted";
  return "unknown";
}

function buildRegulationsFromRestriction(
  rows: UseRestrictionItem[],
  idMap: Map<string, string>,
): RegulationRow[] {
  const merged = new Map<string, RegulationRow>();
  const now = new Date().toISOString();
  let skipped = 0;

  for (const r of rows) {
    const inci = normalizeInci(r.INGR_ENG_NAME);
    if (!inci) {
      skipped++;
      continue;
    }
    const ingredient_id = idMap.get(inci);
    if (!ingredient_id) {
      skipped++;
      continue;
    }
    const codes = mapCountryName(r.COUNTRY_NAME);
    if (codes.length === 0) continue;
    const status = mapRegulateType(r.REGULATE_TYPE, r.LIMIT_COND, r.PROVIS_ATRCL);
    const conditionsParts = [r.LIMIT_COND, r.PROVIS_ATRCL].filter(Boolean);
    const conditions = conditionsParts.length > 0 ? conditionsParts.join("\n\n") : null;

    for (const code of codes) {
      const key = `${ingredient_id}:${code}`;
      const existing = merged.get(key);
      // If multiple rows for same ingredient×country (e.g. 아세안 covers 6 countries),
      // prefer "banned" over "restricted", and concatenate conditions.
      if (existing) {
        const mergedStatus =
          existing.status === "banned" || status === "banned"
            ? "banned"
            : existing.status === "restricted" || status === "restricted"
              ? "restricted"
              : existing.status;
        const mergedConds = [existing.conditions, conditions].filter(Boolean).join("\n---\n");
        existing.status = mergedStatus;
        existing.conditions = mergedConds || null;
      } else {
        merged.set(key, {
          ingredient_id,
          country_code: code,
          status,
          max_concentration: null,
          concentration_unit: "%",
          product_categories: [],
          conditions,
          source_url: SOURCE_URL_BASE,
          source_document: SOURCE_DOC,
          last_verified_at: now,
          auto_verified: true,
          confidence_score: 0.95, // MFDS 공식 API → 모델 파싱보다 신뢰도 높게
        });
      }
    }
  }

  if (skipped) console.log(`    (regulation skipped ${skipped} rows: missing INCI or id)`);
  return Array.from(merged.values());
}

// ============================================================
// Stage 4: Enrich regulations with getCsmtcsUseRstrcNatnInfoService (LIMIT_COND bilingual detail)
// ============================================================
function enrichRegulationsWithDetail(
  regulations: RegulationRow[],
  details: CountryDetailItem[],
  idMap: Map<string, string>,
) {
  // detail rows are keyed by NOTICE_INGR_NAME. We need to match by ingredient english name — imperfect.
  // For now, match by extracting English portion of NOTICE_INGR_NAME and map to idMap.
  const regIndex = new Map<string, RegulationRow>();
  for (const r of regulations) regIndex.set(`${r.ingredient_id}:${r.country_code}`, r);

  let matched = 0;
  let unmatched = 0;

  for (const d of details) {
    if (!d.NOTICE_INGR_NAME) continue;
    const possibleInci = d.NOTICE_INGR_NAME.split(/[;,\n]/)[0].trim();
    const codes = mapCountryName(d.COUNTRY_NAME);
    if (codes.length === 0) continue;

    // Find matching ingredient_id by NOTICE name substring match (best-effort)
    let ingredient_id: string | undefined;
    for (const [inci, id] of idMap.entries()) {
      if (possibleInci.toLowerCase().startsWith(inci.toLowerCase())) {
        ingredient_id = id;
        break;
      }
    }
    if (!ingredient_id) {
      unmatched++;
      continue;
    }

    for (const code of codes) {
      const reg = regIndex.get(`${ingredient_id}:${code}`);
      if (reg) {
        const detailParts = [d.LIMIT_COND, d.PROVIS_ATRCL].filter(Boolean);
        if (detailParts.length > 0) {
          const detailText = detailParts.join("\n\n");
          if (!reg.conditions) {
            reg.conditions = detailText;
          } else if (!reg.conditions.includes(detailText.slice(0, 50))) {
            reg.conditions = `${reg.conditions}\n---\n${detailText}`;
          }
        }
        matched++;
      }
    }
  }
  console.log(`    detail enrichment: ${matched} matched, ${unmatched} unmatched`);
}

// ============================================================
// Stage 5: Bulk insert regulations (delete-then-insert for idempotency,
// avoids needing a unique constraint migration)
// ============================================================
async function replaceMfdsRegulations(
  supabase: ReturnType<typeof supabaseAdmin>,
  regulations: RegulationRow[],
) {
  const { error: delErr } = await supabase
    .from("regulations")
    .delete()
    .eq("source_document", SOURCE_DOC);
  if (delErr) throw new Error(`Failed to clear old MFDS regulations: ${delErr.message}`);

  const BATCH = 500;
  for (let i = 0; i < regulations.length; i += BATCH) {
    const slice = regulations.slice(i, i + BATCH);
    const { error } = await supabase.from("regulations").insert(slice);
    if (error) throw new Error(`Regulation insert batch ${i}: ${error.message}`);
    console.log(`    inserted ${Math.min(i + BATCH, regulations.length)}/${regulations.length}`);
  }
}

async function ensureAdditionalCountries(supabase: ReturnType<typeof supabaseAdmin>) {
  const rows = [
    { code: "TW", name_ko: "대만", name_en: "Taiwan", regulation_framework: "TW_TFDA", notes: "대만 식품약물관리서(TFDA)" },
    { code: "BR", name_ko: "브라질", name_en: "Brazil", regulation_framework: "ANVISA_BR", notes: "ANVISA" },
    { code: "AR", name_ko: "아르헨티나", name_en: "Argentina", regulation_framework: "ANMAT_AR", notes: "ANMAT" },
    { code: "CA", name_ko: "캐나다", name_en: "Canada", regulation_framework: "HC_CA", notes: "Health Canada" },
  ].map((r) => ({ ...r, inherits_from: null }));
  const { error } = await supabase.from("countries").upsert(rows, { onConflict: "code" });
  if (error) throw new Error(`Failed to upsert countries: ${error.message}`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  const supabase = supabaseAdmin();
  const startedAt = Date.now();

  console.log("▶ [0/5] Ensuring TW/BR/AR/CA countries present...");
  await ensureAdditionalCountries(supabase);

  console.log("▶ [1/5] Fetching ingredient master (getCsmtcsIngdCpntInfoService01)...");
  const ingMaster = await fetchAllPages<IngredientMasterItem>(
    "CsmtcsIngdCpntInfoService01",
    "getCsmtcsIngdCpntInfoService01",
    {
      onProgress: (loaded, total) => {
        if (loaded % 2000 === 0 || loaded === total) console.log(`    ${loaded}/${total}`);
      },
    },
  );

  console.log("▶ [2/5] Fetching use-restriction rows (getCsmtcsUseRstrcInfoService)...");
  const restrictions = await fetchAllPages<UseRestrictionItem>(
    "CsmtcsUseRstrcInfoService",
    "getCsmtcsUseRstrcInfoService",
    {
      onProgress: (loaded, total) => {
        if (loaded % 3000 === 0 || loaded === total) console.log(`    ${loaded}/${total}`);
      },
    },
  );

  console.log("▶ [3/5] Fetching country-detail rows (getCsmtcsUseRstrcNatnInfoService)...");
  const details = await fetchAllPages<CountryDetailItem>(
    "CsmtcsUseRstrcInfoService",
    "getCsmtcsUseRstrcNatnInfoService",
    {
      onProgress: (loaded, total) => {
        if (loaded % 2000 === 0 || loaded === total) console.log(`    ${loaded}/${total}`);
      },
    },
  );

  // Aggregate API is redundant for now; skip to save trafficquota. Can enable later.
  console.log("▶ [4/5] Building canonical ingredients + upserting to DB...");
  const canonical = await stage1IngredientMaster(ingMaster);
  mergeRestrictionIngredients(canonical, restrictions);
  const ingredientList = Array.from(canonical.values());
  console.log(`  total canonical ingredients: ${ingredientList.length}`);

  const idMap = await upsertIngredients(supabase, ingredientList);
  console.log(`  id map size: ${idMap.size}`);

  console.log("▶ [5/5] Building regulations + upserting...");
  const regulations = buildRegulationsFromRestriction(restrictions, idMap);
  console.log(`  regulations built: ${regulations.length}`);

  if (details.length > 0) {
    enrichRegulationsWithDetail(regulations, details, idMap);
  }

  await replaceMfdsRegulations(supabase, regulations);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const unknown = getUnknownCountries();
  console.log(`\n=== summary (${elapsed}s) ===`);
  console.log(`  ingredients upserted: ${idMap.size}`);
  console.log(`  regulations upserted: ${regulations.length}`);
  if (unknown.length > 0) console.log(`  unknown country names: ${unknown.join(", ")}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
