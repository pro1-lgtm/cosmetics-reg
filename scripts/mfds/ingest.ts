import { randomUUID } from "node:crypto";
import { loadEnv } from "../crawlers/env";
loadEnv();

import { fetchAllPages } from "./client";
import { mapCountryName, getUnknownCountries } from "./country-mapping";
import type {
  IngredientMasterItem,
  UseRestrictionItem,
  CountryDetailItem,
} from "./types";
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// Phase 5b — Supabase 제거. 식약처 API → public/data/*.json 직접 머지.
// 기존 ingredients 의 function_category / function_description / 다국어명 보존.
// regulations 는 source_document='MFDS 공공데이터 API' 행만 교체 (다른 source 보존).

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

interface IngredientRow {
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

interface CountryRow {
  code: string;
  name_ko: string;
  inherits_from: string | null;
  regulation_type: string;
}

interface RegulationRow {
  ingredient_id: string;
  country_code: string;
  status: string;
  max_concentration: number | null;
  concentration_unit: string;
  product_categories: string[];
  conditions: string | null;
  source_url: string | null;
  source_document: string;
  source_version: string | null;
  last_verified_at: string;
  confidence_score: number;
  override_note: string | null;
}

function parseSynonyms(raw: string | null | undefined): string[] {
  if (!raw) return [];
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

function stage1IngredientMaster(ing: IngredientMasterItem[]): Map<string, CanonicalIngredient> {
  const byInci = new Map<string, CanonicalIngredient>();
  let skippedNoEng = 0;
  for (const row of ing) {
    const inci = normalizeInci(row.INGR_ENG_NAME);
    if (!inci) { skippedNoEng++; continue; }
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
  console.log(`  master: ${ing.length} raw → ${byInci.size} unique INCI (skipped ${skippedNoEng})`);
  return byInci;
}

function mergeRestrictionIngredients(map: Map<string, CanonicalIngredient>, rows: UseRestrictionItem[]) {
  let skippedNoEng = 0;
  for (const r of rows) {
    const inci = normalizeInci(r.INGR_ENG_NAME);
    if (!inci) { skippedNoEng++; continue; }
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
  if (skippedNoEng) console.log(`    (restriction skipped ${skippedNoEng})`);
}

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
  idByInci: Map<string, string>,
  sourceVersion: string,
): RegulationRow[] {
  const merged = new Map<string, RegulationRow>();
  const now = new Date().toISOString();
  let skipped = 0;
  for (const r of rows) {
    const inci = normalizeInci(r.INGR_ENG_NAME);
    if (!inci) { skipped++; continue; }
    const ingredient_id = idByInci.get(inci);
    if (!ingredient_id) { skipped++; continue; }
    const codes = mapCountryName(r.COUNTRY_NAME);
    if (codes.length === 0) continue;
    const status = mapRegulateType(r.REGULATE_TYPE, r.LIMIT_COND, r.PROVIS_ATRCL);
    const conditionsParts = [r.LIMIT_COND, r.PROVIS_ATRCL].filter(Boolean);
    const conditions = conditionsParts.length > 0 ? conditionsParts.join("\n\n") : null;
    for (const code of codes) {
      const key = `${ingredient_id}:${code}`;
      const existing = merged.get(key);
      if (existing) {
        const mergedStatus = existing.status === "banned" || status === "banned"
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
          source_version: sourceVersion,
          last_verified_at: now,
          confidence_score: 0.95,
          override_note: null,
        });
      }
    }
  }
  if (skipped) console.log(`    (regulation skipped ${skipped})`);
  return Array.from(merged.values());
}

function enrichRegulationsWithDetail(regulations: RegulationRow[], details: CountryDetailItem[], idByInci: Map<string, string>) {
  const regIndex = new Map<string, RegulationRow>();
  for (const r of regulations) regIndex.set(`${r.ingredient_id}:${r.country_code}`, r);
  let matched = 0, unmatched = 0;
  for (const d of details) {
    if (!d.NOTICE_INGR_NAME) continue;
    const possibleInci = d.NOTICE_INGR_NAME.split(/[;,\n]/)[0].trim();
    const codes = mapCountryName(d.COUNTRY_NAME);
    if (codes.length === 0) continue;
    let ingredient_id: string | undefined;
    for (const [inci, id] of idByInci.entries()) {
      if (possibleInci.toLowerCase().startsWith(inci.toLowerCase())) {
        ingredient_id = id;
        break;
      }
    }
    if (!ingredient_id) { unmatched++; continue; }
    for (const code of codes) {
      const reg = regIndex.get(`${ingredient_id}:${code}`);
      if (reg) {
        const detailParts = [d.LIMIT_COND, d.PROVIS_ATRCL].filter(Boolean);
        if (detailParts.length > 0) {
          const detailText = detailParts.join("\n\n");
          if (!reg.conditions) reg.conditions = detailText;
          else if (!reg.conditions.includes(detailText.slice(0, 50))) {
            reg.conditions = `${reg.conditions}\n---\n${detailText}`;
          }
        }
        matched++;
      }
    }
  }
  console.log(`    detail enrichment: ${matched} matched, ${unmatched} unmatched`);
}

const ADDITIONAL_COUNTRIES: CountryRow[] = [
  { code: "TW", name_ko: "대만", inherits_from: null, regulation_type: "positive_list" },
  { code: "BR", name_ko: "브라질", inherits_from: null, regulation_type: "negative_list" },
  { code: "AR", name_ko: "아르헨티나", inherits_from: null, regulation_type: "negative_list" },
  { code: "CA", name_ko: "캐나다", inherits_from: null, regulation_type: "negative_list" },
];

async function ensureCountries() {
  const existing = await readRows<CountryRow>("countries");
  if (existing.length === 0) {
    // Bootstrap — first run with no DB seed. 15-country base list (regulation_type defaults).
    const base: CountryRow[] = [
      { code: "KR", name_ko: "한국", inherits_from: null, regulation_type: "negative_list" },
      { code: "CN", name_ko: "중국", inherits_from: null, regulation_type: "positive_list" },
      { code: "EU", name_ko: "EU", inherits_from: null, regulation_type: "hybrid" },
      { code: "US", name_ko: "미국", inherits_from: null, regulation_type: "negative_list" },
      { code: "JP", name_ko: "일본", inherits_from: null, regulation_type: "hybrid" },
      { code: "VN", name_ko: "베트남", inherits_from: "EU", regulation_type: "hybrid" },
      { code: "TH", name_ko: "태국", inherits_from: "EU", regulation_type: "hybrid" },
      { code: "ID", name_ko: "인도네시아", inherits_from: "EU", regulation_type: "hybrid" },
      { code: "MY", name_ko: "말레이시아", inherits_from: "EU", regulation_type: "hybrid" },
      { code: "PH", name_ko: "필리핀", inherits_from: "EU", regulation_type: "hybrid" },
      { code: "SG", name_ko: "싱가포르", inherits_from: "EU", regulation_type: "hybrid" },
      ...ADDITIONAL_COUNTRIES,
    ];
    await writeRows("countries", base);
    return base;
  }
  const codes = new Set(existing.map((c) => c.code));
  let changed = false;
  for (const a of ADDITIONAL_COUNTRIES) {
    if (!codes.has(a.code)) { existing.push(a); changed = true; }
  }
  if (changed) await writeRows("countries", existing);
  return existing;
}

async function main() {
  const startedAt = Date.now();
  console.log("▶ [0/5] countries.json bootstrap...");
  const countries = await ensureCountries();

  console.log("▶ [1/5] Fetching ingredient master...");
  const ingMaster = await fetchAllPages<IngredientMasterItem>(
    "CsmtcsIngdCpntInfoService01",
    "getCsmtcsIngdCpntInfoService01",
    { onProgress: (l, t) => { if (l % 2000 === 0 || l === t) console.log(`    ${l}/${t}`); } },
  );

  console.log("▶ [2/5] Fetching restrictions...");
  const restrictions = await fetchAllPages<UseRestrictionItem>(
    "CsmtcsUseRstrcInfoService",
    "getCsmtcsUseRstrcInfoService",
    { onProgress: (l, t) => { if (l % 3000 === 0 || l === t) console.log(`    ${l}/${t}`); } },
  );

  console.log("▶ [3/5] Fetching country-detail...");
  const details = await fetchAllPages<CountryDetailItem>(
    "CsmtcsUseRstrcInfoService",
    "getCsmtcsUseRstrcNatnInfoService",
    { onProgress: (l, t) => { if (l % 2000 === 0 || l === t) console.log(`    ${l}/${t}`); } },
  );

  console.log("▶ [4/5] Building canonical ingredients + merging into ingredients.json...");
  const canonical = stage1IngredientMaster(ingMaster);
  mergeRestrictionIngredients(canonical, restrictions);

  // Load existing ingredients to preserve id, function_category, multi-language names from prior enrichment.
  const existingIngredients = await readRows<IngredientRow>("ingredients");
  const existingByInci = new Map<string, IngredientRow>();
  for (const e of existingIngredients) existingByInci.set(e.inci_name, e);

  const mergedIngredients: IngredientRow[] = [];
  const idByInci = new Map<string, string>();
  for (const c of canonical.values()) {
    const prev = existingByInci.get(c.inci_name);
    const id = prev?.id ?? randomUUID();
    idByInci.set(c.inci_name, id);
    mergedIngredients.push({
      id,
      inci_name: c.inci_name,
      korean_name: c.korean_name ?? prev?.korean_name ?? null,
      chinese_name: prev?.chinese_name ?? c.chinese_name,
      japanese_name: prev?.japanese_name ?? c.japanese_name,
      cas_no: c.cas_no ?? prev?.cas_no ?? null,
      synonyms: Array.from(new Set([...(c.synonyms ?? []), ...(prev?.synonyms ?? [])])),
      description: prev?.description ?? c.description,
      // 보강 결과(Gemini) 보존
      function_category: prev?.function_category ?? null,
      function_description: prev?.function_description ?? null,
    });
  }
  // Ingredients that existed before but no longer in MFDS — keep (other sources / historical)
  for (const e of existingIngredients) {
    if (!idByInci.has(e.inci_name)) {
      mergedIngredients.push(e);
      idByInci.set(e.inci_name, e.id);
    }
  }
  await writeRows("ingredients", mergedIngredients);
  console.log(`  ingredients.json: ${mergedIngredients.length} rows (canonical ${canonical.size} + retained ${mergedIngredients.length - canonical.size})`);

  console.log("▶ [5/5] Building regulations + replacing MFDS rows...");
  const runDate = new Date().toISOString().slice(0, 10);
  const sourceVersion = `MFDS-${runDate}`;
  const newMfdsRegs = buildRegulationsFromRestriction(restrictions, idByInci, sourceVersion);
  if (details.length > 0) enrichRegulationsWithDetail(newMfdsRegs, details, idByInci);

  const existingRegs = await readRows<RegulationRow>("regulations");
  const nonMfds = existingRegs.filter((r) => r.source_document !== SOURCE_DOC);
  const finalRegs = [...nonMfds, ...newMfdsRegs];
  await writeRows("regulations", finalRegs);
  console.log(`  regulations.json: ${finalRegs.length} rows (MFDS ${newMfdsRegs.length} + other-sources ${nonMfds.length})`);

  await updateMeta({
    countries: countries.length,
    ingredients: mergedIngredients.length,
    regulations: finalRegs.length,
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const unknown = getUnknownCountries();
  console.log(`\n=== summary (${elapsed}s) ===`);
  console.log(`  countries: ${countries.length}`);
  console.log(`  ingredients: ${mergedIngredients.length}`);
  console.log(`  regulations: ${finalRegs.length} (MFDS ${newMfdsRegs.length})`);
  if (unknown.length > 0) console.log(`  unknown country names: ${unknown.join(", ")}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
