import { randomUUID } from "node:crypto";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";
import { launchContext } from "./playwright-helper";

// Health Canada — Cosmetic Ingredient Hotlist (List of Prohibited and Restricted Cosmetic Ingredients).
// HTML 테이블 페이지 — Playwright 로 봇 차단 우회 + DOM 직접 추출.

const SOURCE_DOC = "Health Canada Cosmetic Ingredient Hotlist";
const SOURCE_URL = "https://www.canada.ca/en/health-canada/services/consumer-product-safety/cosmetics/cosmetic-ingredient-hotlist-prohibited-restricted-ingredients/hotlist.html";

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
  source_priority: number;
  last_verified_at: string;
  confidence_score: number;
  override_note: string | null;
}

interface HotlistEntry {
  name: string;
  cas: string | null;
  status: "banned" | "restricted";
  conditions: string | null;
  section: string;  // "Prohibited" / "Restricted"
}

async function extractHotlist(): Promise<HotlistEntry[]> {
  const ctx = await launchContext({
    acceptLang: "en-CA,en;q=0.9",
  });
  try {
    await ctx.page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 60_000 });
    // Health Canada 페이지는 두 큰 테이블: Prohibited list, Restricted list.
    // h2 sections + tables. 각 row: ingredient name, CAS, conditions.
    const entries = await ctx.page.evaluate(() => {
      const out: { name: string; cas: string | null; conditions: string | null; section: string }[] = [];
      const tables = document.querySelectorAll("table");
      tables.forEach((table) => {
        // 가까운 직전 h2/h3 가 section 이름
        let prev: Element | null = table;
        let sectionName = "";
        while ((prev = prev.previousElementSibling) || (prev = table.parentElement)) {
          if (!prev) break;
          const tag = prev.tagName?.toLowerCase();
          if (tag === "h2" || tag === "h3") {
            sectionName = (prev.textContent ?? "").trim();
            break;
          }
        }
        const isProhibited = /prohibit/i.test(sectionName);
        const isRestricted = /restrict/i.test(sectionName);
        if (!isProhibited && !isRestricted) return;
        const rows = table.querySelectorAll("tbody tr");
        rows.forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll("td")).map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
          if (cells.length === 0) return;
          const name = cells[0] ?? "";
          if (!name) return;
          const cas = cells[1]?.match(/\d+-\d+-\d+/)?.[0] ?? null;
          const conditions = cells.slice(2).filter(Boolean).join("\n") || null;
          out.push({ name, cas, conditions, section: sectionName });
        });
      });
      return out;
    });

    return entries.map((e) => ({
      name: e.name,
      cas: e.cas,
      conditions: e.conditions,
      section: e.section,
      status: /restrict/i.test(e.section) ? "restricted" as const : "banned" as const,
    }));
  } finally {
    await ctx.close();
  }
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ Health Canada Hotlist fetch (Playwright)...`);
  const entries = await extractHotlist();
  console.log(`  parsed ${entries.length} entries (${entries.filter(e => e.status === "banned").length} banned, ${entries.filter(e => e.status === "restricted").length} restricted)`);

  const ingredients = await readRows<IngredientRow>("ingredients");
  const byInciLower = new Map<string, IngredientRow>();
  for (const i of ingredients) byInciLower.set(i.inci_name.toLowerCase(), i);

  const newRegs: RegulationRow[] = [];
  const now = new Date().toISOString();
  const sourceVersion = `Hotlist-${now.slice(0, 10)}`;

  let matched = 0, created = 0;
  for (const e of entries) {
    if (!e.name || e.name.length < 2) continue;
    const key = e.name.toLowerCase();
    let ing = byInciLower.get(key);
    if (!ing) {
      ing = {
        id: randomUUID(),
        inci_name: e.name,
        korean_name: null,
        chinese_name: null,
        japanese_name: null,
        cas_no: e.cas,
        synonyms: [],
        description: null,
        function_category: null,
        function_description: null,
      };
      ingredients.push(ing);
      byInciLower.set(key, ing);
      created++;
    } else {
      matched++;
      if (!ing.cas_no && e.cas) ing.cas_no = e.cas;
    }

    const conds = [
      `Health Canada Hotlist (${e.section}) 등재 — ${e.status === "banned" ? "사용 금지" : "조건부 허용"}.`,
      e.conditions ? `조건/비고 (원문): ${e.conditions}` : null,
    ].filter(Boolean).join("\n\n");

    newRegs.push({
      ingredient_id: ing.id,
      country_code: "CA",
      status: e.status,
      max_concentration: null,
      concentration_unit: "%",
      product_categories: [],
      conditions: conds,
      source_url: SOURCE_URL,
      source_document: SOURCE_DOC,
      source_version: sourceVersion,
      source_priority: 100,
      last_verified_at: now,
      confidence_score: 1.0,
      override_note: null,
    });
  }
  console.log(`  matching: ${matched} matched, ${created} new`);

  const existingRegs = await readRows<RegulationRow>("regulations");
  const otherSources = existingRegs.filter((r) => r.source_document !== SOURCE_DOC);
  const finalRegs = [...otherSources, ...newRegs];

  await writeRows("ingredients", ingredients);
  await writeRows("regulations", finalRegs);
  await updateMeta({ ingredients: ingredients.length, regulations: finalRegs.length });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== summary (${elapsed}s) ===`);
  console.log(`  CA Hotlist rows: ${newRegs.length} (priority 100)`);
  console.log(`  ingredients: ${ingredients.length}, regulations: ${finalRegs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
