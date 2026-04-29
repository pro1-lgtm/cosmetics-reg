import { mkdir, writeFile, stat } from "node:fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { loadEnv } from "./crawlers/env";
loadEnv();
import { supabaseAdmin } from "../lib/supabase-admin";

// Supabase → public/data/*.json 일회성 export.
// Phase 5: 검색 path 의 Supabase 의존 제거. 빌드 후 /data/*.json 만 정적 호스팅에 올라감.
//
// 데이터 신선도는 ETag/Last-Modified (Netlify 자동) 으로 사용자 브라우저가 자동 비교.

const OUT_DIR = "public/data";

interface Ingredient {
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

interface Regulation {
  ingredient_id: string;
  country_code: string;
  status: string;
  max_concentration: number | null;
  concentration_unit: string | null;
  product_categories: string[];
  conditions: string | null;
  source_url: string | null;
  source_document: string | null;
  confidence_score: number | null;
  last_verified_at: string;
  override_note: string | null;
}

interface Country {
  code: string;
  name_ko: string;
  inherits_from: string | null;
  regulation_type: string;
}

interface QuarantineRow {
  ingredient_name_raw: string | null;
  country_code: string | null;
  rejection_reason: string | null;
}

async function fetchAllInPages<T>(
  s: ReturnType<typeof supabaseAdmin>,
  table: string,
  cols: string,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await s.from(table).select(cols).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  const json = JSON.stringify(payload);
  await writeFile(path, json, "utf8");
  const raw = Buffer.byteLength(json, "utf8");
  const gz = gzipSync(json).length;
  const br = brotliCompressSync(json).length;
  console.log(
    `  ${path}  raw=${(raw / 1024).toFixed(0)}KB  gz=${(gz / 1024).toFixed(0)}KB  br=${(br / 1024).toFixed(0)}KB`,
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const s = supabaseAdmin();

  console.log("[1/4] countries...");
  const countries = await fetchAllInPages<Country>(
    s,
    "countries",
    "code, name_ko, inherits_from, regulation_type",
  );
  console.log(`  countries: ${countries.length} rows`);

  console.log("[2/4] ingredients (full master)...");
  const ingredients = await fetchAllInPages<Ingredient>(
    s,
    "ingredients",
    "id, inci_name, korean_name, chinese_name, japanese_name, cas_no, synonyms, description, function_category, function_description",
  );
  console.log(`  ingredients: ${ingredients.length} rows`);

  console.log("[3/4] regulations (active only — view regulations_active)...");
  const regulations = await fetchAllInPages<Regulation>(
    s,
    "regulations_active",
    "ingredient_id, country_code, status, max_concentration, concentration_unit, product_categories, conditions, source_url, source_document, confidence_score, last_verified_at, override_note",
  );
  console.log(`  regulations: ${regulations.length} rows`);

  console.log("[4/4] regulation_quarantine (pending only)...");
  const quarantine = await fetchAllInPages<QuarantineRow>(
    s,
    "regulation_quarantine",
    "ingredient_name_raw, country_code, rejection_reason",
  );
  const pendingOnly = quarantine.filter((q) => q.ingredient_name_raw && q.country_code);
  console.log(`  quarantine pending: ${pendingOnly.length} rows`);

  console.log("\n=== output ===");
  const generatedAt = new Date().toISOString();
  await writeJson(`${OUT_DIR}/countries.json`, { generated_at: generatedAt, rows: countries });
  await writeJson(`${OUT_DIR}/ingredients.json`, { generated_at: generatedAt, rows: ingredients });
  await writeJson(`${OUT_DIR}/regulations.json`, { generated_at: generatedAt, rows: regulations });
  await writeJson(`${OUT_DIR}/quarantine.json`, { generated_at: generatedAt, rows: pendingOnly });

  const meta = {
    generated_at: generatedAt,
    counts: {
      countries: countries.length,
      ingredients: ingredients.length,
      regulations: regulations.length,
      quarantine_pending: pendingOnly.length,
    },
  };
  await writeJson(`${OUT_DIR}/meta.json`, meta);

  console.log("\n=== done ===");
  for (const f of ["countries", "ingredients", "regulations", "quarantine", "meta"]) {
    const st = await stat(`${OUT_DIR}/${f}.json`);
    console.log(`  ${f}.json  ${(st.size / 1024).toFixed(0)}KB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
