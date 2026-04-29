import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// EU Cosmetic Products Regulation 1223/2009 consolidated PDF → Annex II/III/IV/V/VI 파싱.
// pdf-parse 로 text 추출 → reference number 기반 row 분리 → INCI 매칭.
// Gemini 무관.

const SOURCE_DOC = "EU EUR-Lex Regulation 1223/2009 (Cosmetic Products)";
const SOURCE_URL = "https://eur-lex.europa.eu/eli/reg/2009/1223/oj/eng";
// public/data/raw-pdf/ (git committed) 우선 — fallback .crawl-raw/eu-eurlex/ (GitHub Actions runner 시점)
const PDF_PATHS = [
  "public/data/raw-pdf/eu_eurlex_1223_consolidated_pdf.pdf",
  ".crawl-raw/eu-eurlex/eu_eurlex_1223_consolidated_pdf.pdf",
];

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

interface AnnexEntry {
  ref: string;        // reference number
  substance: string;  // substance name (정리됨)
  cas: string | null;
  ec: string | null;
}

async function extractText(): Promise<string> {
  const { existsSync } = await import("node:fs");
  const path = PDF_PATHS.find((p) => existsSync(p));
  if (!path) throw new Error(`EU PDF not found in any of: ${PDF_PATHS.join(", ")}`);
  console.log(`  using ${path}`);
  const { PDFParse } = await import("pdf-parse");
  const buf = readFileSync(path);
  const p = new PDFParse({ data: buf });
  const r = await p.getText();
  return r.text;
}

function findAnnex(text: string, name: string): { start: number; end: number } | null {
  const re = new RegExp(`(?:^|\\n)\\s*ANNEX\\s+${name}\\s*\\n`, "g");
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  // Annex VII 등 다음 큰 Annex 들 사이의 region.
  // 마지막 매치가 보통 actual section header (앞쪽은 reference 들).
  const last = matches[matches.length - 1];
  const start = (last.index ?? 0) + last[0].length;
  // next Annex header 찾기
  const nextRe = new RegExp(`(?:^|\\n)\\s*ANNEX\\s+(?!${name}\\b)[IVX]+\\s*\\n`, "g");
  let end = text.length;
  for (const nm of text.matchAll(nextRe)) {
    if ((nm.index ?? 0) > start) {
      end = nm.index ?? text.length;
      break;
    }
  }
  return { start, end };
}

// ref number 가 라인 시작에 있는 row 추출. PDF text 가 row마다 새 line 으로 나오기도, 같은
// 라인에 있기도. 가장 확실: text 안 모든 "{number} {space} {substance text}" 패턴 잡고
// CAS/EC 추출. ref number 는 1부터 시작, 큰 increment 없음.
function parseAnnexRows(sectionText: string): AnnexEntry[] {
  const out: AnnexEntry[] = [];
  // "1\t" or "1 " 로 시작하는 row (PDF text 에선 종종 \n 으로 분리)
  // ref number 는 1, 2, 3, ... 순차. 같은 라인에서 다음 ref 까지가 한 entry.
  const cleaned = sectionText.replace(/-- \d+ of \d+ --/g, " ").replace(/Official Journ?al[\s\S]*?\d{2}\.\d{2}\.\d{4}/g, " ");
  // ref pattern: "\n N \t" or "\n N "
  const refRe = /(?:^|\n)\s*(\d{1,4})\s+(?=\S)/g;
  const positions: { ref: number; pos: number }[] = [];
  let m;
  while ((m = refRe.exec(cleaned))) {
    const n = Number(m[1]);
    // 합리적 ref 범위만 (Annex II ~1700, Annex III ~350)
    if (n >= 1 && n <= 2000) positions.push({ ref: n, pos: m.index + (m[0].length - String(m[1]).length - 1) });
  }
  // sequential ref 만 keep — 1, 2, 3, ... 순차 violations 제거
  const filtered: { ref: number; pos: number }[] = [];
  let lastRef = 0;
  for (const p of positions) {
    if (p.ref === lastRef + 1 || (lastRef === 0 && p.ref === 1) || (filtered.length > 0 && p.ref > lastRef && p.ref - lastRef < 5)) {
      filtered.push(p);
      lastRef = p.ref;
    }
  }
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    const next = filtered[i + 1];
    const block = cleaned.slice(cur.pos, next?.pos ?? cleaned.length);
    // strip leading "N\t" or "N "
    const body = block.replace(/^\s*\d+\s+/, "").replace(/\s+/g, " ").trim();
    // CAS pattern
    const casMatch = body.match(/(\d{1,7}-\d{2}-\d)/);
    const cas = casMatch?.[1] ?? null;
    // EC pattern (NNN-NNN-N)
    const ecMatch = body.match(/(\d{3}-\d{3}-\d)/);
    const ec = ecMatch?.[1] ?? null;
    // substance = body 에서 CAS/EC 제거 + tail 정리
    let substance = body;
    if (cas) substance = substance.replace(cas, "").trim();
    if (ec) substance = substance.replace(ec, "").trim();
    substance = substance.replace(/\s+/g, " ").trim();
    if (!substance || substance.length < 2 || substance.length > 300) continue;
    out.push({ ref: String(cur.ref), substance, cas, ec });
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ EU EUR-Lex PDF 파싱...`);
  const text = await extractText();
  console.log(`  text length: ${text.length}`);

  const ingredients = await readRows<IngredientRow>("ingredients");
  const byInciLower = new Map<string, IngredientRow>();
  for (const i of ingredients) byInciLower.set(i.inci_name.toLowerCase(), i);

  const now = new Date().toISOString();
  const sourceVersion = `EUR-Lex-${now.slice(0, 10)}`;
  const newRegs: RegulationRow[] = [];
  let totalMatched = 0, totalCreated = 0;

  const annexes: { name: string; status: "banned" | "restricted" | "listed"; label: string; productCategories: string[] }[] = [
    { name: "II", status: "banned", label: "EU Cosmetic Regulation 1223/2009 Annex II — Prohibited substances", productCategories: [] },
    { name: "III", status: "restricted", label: "EU Cosmetic Regulation 1223/2009 Annex III — Restricted substances", productCategories: [] },
    { name: "IV", status: "listed", label: "EU Cosmetic Regulation 1223/2009 Annex IV — Allowed colorants", productCategories: ["색소"] },
    { name: "V", status: "listed", label: "EU Cosmetic Regulation 1223/2009 Annex V — Allowed preservatives", productCategories: ["보존제"] },
    { name: "VI", status: "listed", label: "EU Cosmetic Regulation 1223/2009 Annex VI — Allowed UV filters", productCategories: ["자외선차단제"] },
  ];

  for (const a of annexes) {
    const range = findAnnex(text, a.name);
    if (!range) {
      console.log(`  Annex ${a.name}: section not found`);
      continue;
    }
    const section = text.slice(range.start, range.end);
    const entries = parseAnnexRows(section);
    console.log(`  Annex ${a.name} (${a.status}): ${entries.length} entries`);
    let matched = 0, created = 0;
    for (const e of entries) {
      const key = e.substance.toLowerCase();
      let ing = byInciLower.get(key);
      if (!ing) {
        ing = {
          id: randomUUID(),
          inci_name: e.substance,
          korean_name: null, chinese_name: null, japanese_name: null,
          cas_no: e.cas, synonyms: [], description: null,
          function_category: a.productCategories[0] ?? null,
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
        `${a.label} 등재 (Reference ${e.ref}) — ${a.status === "banned" ? "EU 화장품 사용 금지" : a.status === "restricted" ? "EU 화장품 사용 제한" : "EU 화장품 positive list (사용 가능)"}.`,
        e.cas ? `CAS: ${e.cas}` : null,
        e.ec ? `EC: ${e.ec}` : null,
      ].filter(Boolean).join("\n");
      newRegs.push({
        ingredient_id: ing.id, country_code: "EU", status: a.status,
        max_concentration: null, concentration_unit: "%",
        product_categories: a.productCategories, conditions: conds,
        source_url: SOURCE_URL, source_document: SOURCE_DOC,
        source_version: sourceVersion, source_priority: 100, last_verified_at: now,
        confidence_score: 1.0, override_note: null,
      });
    }
    totalMatched += matched; totalCreated += created;
    console.log(`     → matched ${matched}, new ${created}`);
  }

  const existingRegs = await readRows<RegulationRow>("regulations");
  const otherSources = existingRegs.filter((r) => r.source_document !== SOURCE_DOC);
  const finalRegs = [...otherSources, ...newRegs];

  await writeRows("ingredients", ingredients);
  await writeRows("regulations", finalRegs);
  await updateMeta({ ingredients: ingredients.length, regulations: finalRegs.length });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== summary (${elapsed}s) ===`);
  console.log(`  EU EUR-Lex Annex II/III/IV/V/VI: ${newRegs.length} rows (priority 100)`);
  console.log(`  matched ${totalMatched}, new ${totalCreated}`);
  console.log(`  ingredients: ${ingredients.length}, regulations: ${finalRegs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
