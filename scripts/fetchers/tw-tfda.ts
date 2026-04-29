import { randomUUID } from "node:crypto";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// 대만 TFDA — 화장품 방부제 제한표 (化粧品防腐劑成分使用限制表) 1차 소스 fetcher.
// HTML 테이블 inline (페이징 1068&p=N). 정규식 파싱 — Gemini 불필요.

const BASE = "https://consumer.fda.gov.tw/LAW/Cosmetic1.aspx?nodeID=1068";
const SOURCE_DOC = "TFDA 化粧品防腐劑成分使用限制表";
const SOURCE_URL = BASE;

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

interface TwEntry {
  no: string;       // 項次
  inci: string;     // 成分名稱
  cas: string | null;
  notes: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchPage(p: number): Promise<{ entries: TwEntry[]; totalPages: number }> {
  const url = p === 1 ? BASE : `${BASE}&p=${p}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0", "Accept-Language": "zh-TW,zh;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for p=${p}`);
  const html = await res.text();
  // "共有66頁" 또는 entity 화된 형태 모두 허용
  const totalMatch = html.match(/共有\s*(\d+)\s*頁/) || html.match(/(\d+)\s*&#38913;/);
  const totalPages = totalMatch ? Number(totalMatch[1]) : 1;
  const entries: TwEntry[] = [];
  // tbody 안 tr 만 (header 제외) — td 순서로 추출 (data-th attr 은 entity mix 라 미사용)
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (tbodyMatch) {
    const rowRe = /<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let m;
    while ((m = rowRe.exec(tbodyMatch[1]))) {
      const no = stripTags(m[1]);
      const inci = stripTags(m[2]);
      const cas = stripTags(m[3]) || null;
      const notes = stripTags(m[4]) || null;
      // header row (項次/成分名稱) skip
      if (!inci || inci === "成分名稱" || /^[一-鿿]+$/.test(inci) === false || inci.match(/[A-Za-z]/)) {
        if (inci && /[A-Za-z]/.test(inci)) entries.push({ no, inci, cas, notes });
      }
    }
  }
  return { entries, totalPages };
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ TW TFDA fetch (page 1)...`);
  const first = await fetchPage(1);
  console.log(`  page 1: ${first.entries.length} rows, totalPages=${first.totalPages}`);

  const allEntries: TwEntry[] = [...first.entries];
  for (let p = 2; p <= first.totalPages; p++) {
    const { entries } = await fetchPage(p);
    allEntries.push(...entries);
    if (p % 10 === 0 || p === first.totalPages) console.log(`  page ${p}/${first.totalPages} (${allEntries.length} rows so far)`);
    await new Promise((r) => setTimeout(r, 200)); // gentle
  }
  console.log(`  fetched ${allEntries.length} entries`);

  // ingredient 매칭 + 신규 생성
  const ingredients = await readRows<IngredientRow>("ingredients");
  const byInciLower = new Map<string, IngredientRow>();
  for (const i of ingredients) byInciLower.set(i.inci_name.toLowerCase(), i);

  const now = new Date().toISOString();
  const sourceVersion = `TFDA-${now.slice(0, 10)}`;
  const newRegs: RegulationRow[] = [];
  let matched = 0, created = 0;

  for (const e of allEntries) {
    const key = e.inci.toLowerCase();
    let ing = byInciLower.get(key);
    if (!ing) {
      ing = {
        id: randomUUID(),
        inci_name: e.inci,
        korean_name: null,
        chinese_name: null,
        japanese_name: null,
        cas_no: e.cas,
        synonyms: [],
        description: null,
        function_category: "방부제",
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
      `TFDA 化粧品防腐劑成分使用限制表 등재 — 대만 화장품 방부제로 사용 시 제한 적용.`,
      e.no ? `項次 ${e.no}` : null,
      e.notes ? `비고 (備註 원문): ${e.notes}` : null,
    ].filter(Boolean).join("\n\n");

    newRegs.push({
      ingredient_id: ing.id,
      country_code: "TW",
      status: "restricted",
      max_concentration: null,
      concentration_unit: "%",
      product_categories: ["방부제"],
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

  console.log(`\n=== summary (${((Date.now()-startedAt)/1000).toFixed(1)}s) ===`);
  console.log(`  TW TFDA preservative-restricted rows: ${newRegs.length} (priority 100)`);
  console.log(`  ingredients: ${ingredients.length}, regulations: ${finalRegs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
