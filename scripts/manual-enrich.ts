import { loadEnv } from "./crawlers/env";
loadEnv();
import { readFileSync } from "node:fs";
import { readRows, writeRows } from "../lib/json-store";

// Gemini quota 회복 전 임시 보강. claude-enrichment.json 의 row 들을 ingredients.json
// 에 in-place 머지. 기존 값은 보존, null 인 필드만 새 값으로 채움.
//
// claude-enrichment.json 형식: ManualRow[]
//   { inci_name, chinese_name?, japanese_name?, function_category?, function_description? }

const CATEGORIES = new Set([
  "보습제","미백","주름개선","자외선차단제","방부제","보존제","색소","향료",
  "계면활성제","유화제","점증제","항산화제","각질제거","세정제","pH조절제",
  "킬레이트제","완화제","수렴제","항균제","기타",
]);

interface IngredientRow {
  id: string;
  inci_name: string;
  korean_name: string | null;
  chinese_name: string | null;
  japanese_name: string | null;
  function_category: string | null;
  function_description: string | null;
  [k: string]: unknown;
}

interface ManualRow {
  inci_name: string;
  chinese_name?: string | null;
  japanese_name?: string | null;
  function_category?: string | null;
  function_description?: string | null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = process.argv.find((a) => a.startsWith("--file="))?.split("=")[1] ?? "claude-enrichment.json";

  const manual: ManualRow[] = JSON.parse(readFileSync(file, "utf8"));
  console.log(`▶ manual enrichment ${file}: ${manual.length} rows${dryRun ? " (DRY RUN)" : ""}`);

  const ingredients = await readRows<IngredientRow>("ingredients");
  const byInciLower = new Map<string, IngredientRow>();
  for (const i of ingredients) byInciLower.set(i.inci_name.toLowerCase(), i);

  let unmatched = 0;
  const counts = { zh: 0, jp: 0, cat: 0, desc: 0 };
  const skipped: string[] = [];

  for (const row of manual) {
    const ing = byInciLower.get(row.inci_name.toLowerCase());
    if (!ing) {
      unmatched++;
      skipped.push(row.inci_name);
      continue;
    }
    if (row.chinese_name && !ing.chinese_name) {
      ing.chinese_name = row.chinese_name.trim();
      counts.zh++;
    }
    if (row.japanese_name && !ing.japanese_name) {
      ing.japanese_name = row.japanese_name.trim();
      counts.jp++;
    }
    if (row.function_category && !ing.function_category) {
      const cat = row.function_category.trim();
      if (!CATEGORIES.has(cat)) {
        console.warn(`  ! invalid category "${cat}" for ${ing.inci_name} — skipped`);
      } else {
        ing.function_category = cat;
        counts.cat++;
      }
    }
    if (row.function_description && !ing.function_description) {
      const desc = row.function_description.trim();
      if (desc.length < 5 || desc.length > 80) {
        console.warn(`  ! description length ${desc.length} for ${ing.inci_name} — skipped`);
      } else {
        ing.function_description = desc;
        counts.desc++;
      }
    }
  }

  console.log(`  매칭 실패 ${unmatched} (사이트에 없는 INCI)`);
  if (skipped.length > 0 && skipped.length <= 20) console.log(`    ${skipped.join(", ")}`);
  console.log(`  보강: chinese_name +${counts.zh}, japanese_name +${counts.jp}, function_category +${counts.cat}, function_description +${counts.desc}`);

  if (!dryRun) {
    await writeRows("ingredients", ingredients);
    console.log(`  ✓ ingredients.json 업데이트 (${ingredients.length} rows)`);
  } else {
    console.log(`  · DRY RUN — 파일 미변경`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
