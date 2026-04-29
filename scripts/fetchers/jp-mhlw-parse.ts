import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// JP MHLW 化粧品基準 영문 PDF text → ingredient 매칭 + JSON 머지.
// pdf-parse 로 text 추출 → Appendix 1 (banned 30) + Appendix 3 (preservative
// positive ~16) + Appendix 4 (UV positive ~30) 파싱. Gemini 불필요 — 영문 PDF
// 이라 정규식 직접.

const SOURCE_DOC = "JP MHLW 化粧品基準 (Standards for Cosmetics, Notification 331)";
const SOURCE_URL = "https://www.mhlw.go.jp/content/000491511.pdf";
const PDF_EN_PATH = ".crawl-raw/jp-mhlw/jp_mhlw_cosmetic_standards_en.pdf";

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

async function extractText(): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const buf = readFileSync(PDF_EN_PATH);
  const p = new PDFParse({ data: buf });
  const r = await p.getText();
  return r.text;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSection(text: string, header: string, nextHeader: string | null): string {
  // 본문 reference 와 section header 구분: 줄 시작 + 줄 끝 패턴 + 마지막 매치.
  const headerPattern = new RegExp(`(^|\\n)${escapeRe(header)}\\s*\\n`, "g");
  const matches = [...text.matchAll(headerPattern)];
  if (matches.length === 0) return "";
  const lastMatch = matches[matches.length - 1];
  const start = (lastMatch.index ?? 0) + lastMatch[0].length;
  let end = text.length;
  if (nextHeader) {
    const nextPattern = new RegExp(`(^|\\n)${escapeRe(nextHeader)}`, "g");
    const nextMatches = [...text.matchAll(nextPattern)];
    if (nextMatches.length > 0) {
      // start 이후 첫 번째 다음 header
      for (const nm of nextMatches) {
        if ((nm.index ?? 0) > start) {
          end = nm.index ?? text.length;
          break;
        }
      }
    }
  }
  return text.slice(start, end);
}

interface ParsedItem {
  name: string;
  status: "banned" | "restricted" | "listed";
  max_concentration: number | null;
  conditions: string;
}

function parseAppendix1(text: string): ParsedItem[] {
  // "1. ingredient" 형식 numbered list. 30개.
  const out: ParsedItem[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
    if (!m) continue;
    const num = Number(m[1]);
    const name = m[2].trim();
    // 30개까지만 (Appendix 1 종료)
    if (num > 30 || !name) continue;
    // skip footer markers
    if (/^--/.test(name)) continue;
    out.push({
      name,
      status: "banned",
      max_concentration: null,
      conditions: `JP MHLW 化粧品基準 別表 1 (Appendix 1) 등재 — 화장품 사용 금지 ingredient. (告示 331).`,
    });
  }
  return out;
}

function parseAmountTable(text: string, sectionName: string, status: "restricted" | "listed"): ParsedItem[] {
  // "ingredient name 0.X" 형식 라인. 한 줄에 한 ingredient.
  // amount 단위: "0.20", "1.0 as total", "0.0020 as total"
  const out: ParsedItem[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // header / footer skip
    if (/Ingredient name|Maximum amount|Cosmetics |^--|^[0-9]+\.\s|^Appendix /.test(trimmed)) continue;
    if (/^\(\*\d+\)/.test(trimmed)) continue;
    // 끝에 숫자 + (옵션) "as total" / 단위
    const m = trimmed.match(/^(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:as total|g|%|IU)?\s*$/);
    if (m) {
      const name = m[1].trim();
      const amount = Number(m[2]);
      // ingredient 이름은 보통 영문 + 일부 화학명. 너무 짧거나 footer/header 텍스트 skip.
      if (name.length < 3 || /^[a-z][.:]/.test(name)) continue;
      // header 텍스트 ("ingredient per", "Maximum amount" 등) 제거
      if (/^(ingredient|maximum|cosmetics|amount)\b/i.test(name)) continue;
      out.push({
        name,
        status,
        max_concentration: amount,
        conditions: `${sectionName} 등재 — ${status === "listed" ? "사용 가능 (positive list)" : "사용 제한"}, 최대 농도 ${amount}g/100g (${status === "listed" ? "보존제/UV 흡수제 등 positive list" : "한정 사용"}).`,
      });
    }
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ JP MHLW 化粧品基準 PDF 파싱 (${PDF_EN_PATH})...`);
  const text = await extractText();
  console.log(`  text length: ${text.length}`);

  const app1 = getSection(text, "Appendix 1", "Appendix 2");
  const app3 = getSection(text, "Appendix 3", "Appendix 4");
  const app4 = getSection(text, "Appendix 4", "(*1)");

  const items: ParsedItem[] = [
    ...parseAppendix1(app1),
    ...parseAmountTable(app3, "JP MHLW 化粧品基準 別表 3 (Appendix 3 — preservatives positive list)", "listed"),
    ...parseAmountTable(app4, "JP MHLW 化粧品基準 別表 4 (Appendix 4 — UV absorbers positive list)", "listed"),
  ];
  console.log(`  parsed: Appendix 1=${parseAppendix1(app1).length}, Appendix 3 (single)=${parseAmountTable(app3, "test", "listed").length}, Appendix 4 (single)=${parseAmountTable(app4, "test", "listed").length}, total ${items.length}`);

  const ingredients = await readRows<IngredientRow>("ingredients");
  const byInciLower = new Map<string, IngredientRow>();
  for (const i of ingredients) byInciLower.set(i.inci_name.toLowerCase(), i);

  const now = new Date().toISOString();
  const sourceVersion = `MHLW-${now.slice(0, 10)}`;
  const newRegs: RegulationRow[] = [];
  let matched = 0, created = 0;

  for (const it of items) {
    const key = it.name.toLowerCase();
    let ing = byInciLower.get(key);
    if (!ing) {
      ing = {
        id: randomUUID(),
        inci_name: it.name,
        korean_name: null,
        chinese_name: null,
        japanese_name: null,
        cas_no: null,
        synonyms: [],
        description: null,
        function_category: it.status === "listed" ? (it.conditions.includes("UV") ? "자외선차단제" : "보존제") : null,
        function_description: null,
      };
      ingredients.push(ing);
      byInciLower.set(key, ing);
      created++;
    } else {
      matched++;
    }

    newRegs.push({
      ingredient_id: ing.id,
      country_code: "JP",
      status: it.status,
      max_concentration: it.max_concentration,
      concentration_unit: it.max_concentration ? "g/100g" : "%",
      product_categories: [],
      conditions: it.conditions,
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
  console.log(`  JP MHLW (Appendix 1+3+4): ${newRegs.length} rows (priority 100)`);
  console.log(`  ingredients: ${ingredients.length}, regulations: ${finalRegs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
