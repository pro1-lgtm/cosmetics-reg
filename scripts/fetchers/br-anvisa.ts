import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// BR ANVISA RDC PDF 자동 fetch + 정규식 파싱.
// 출처: KCIA 15087 첨부 zip (브라질 규정 원문 모음 — KCIA 가 자동 다운로드).
// kcia-articles.ts cron 이 zip 다운, br-anvisa.ts cron 이 unzip + parse.
//
// 핵심 RDC (BR 1차 출처, priority 100):
//   RDC 83/2016 — 배합금지 성분 (banned, MERCOSUL 62/2014)
//   RDC 03/2012 — 배합한도 제한 (restricted, MERCOSUL 24/2011)
//   RDC 29/2012 — 허용 보존제 (preservatives positive)
//   RDC 628/2022 — 허용 색소 (colorants positive, 최신)
//   RDC 600/2022 — 허용 UV 필터 (UV positive, 최신)
//
// Gemini 의존 0 — 정규식 직접. 매일 cron 안전 작동.

const SOURCE_PREFIX = "ANVISA Brazil";
const KCIA_ATTACH_DIR = "public/data/raw-attach/kcia-15087";
const ZIP_FILE = `${KCIA_ATTACH_DIR}/브라질 규정 원문, 국문번역본 모음(2023년)홈피게시.zip`;
const UNZIP_DIR = `${KCIA_ATTACH_DIR}/br-rdc`;
const FINGERPRINT_FILE = "public/data/br-anvisa-fingerprints.json";

interface RdcSpec {
  filename: string;
  status: "banned" | "restricted" | "listed";
  function_category: string | null;
  description: string;
  parser: "ref-cas" | "positive-list";
  // Mercosul 결의 채택분 — BR ANVISA RDC = AR ANMAT Disposición 동일 list.
  // BR 만 채택한 것은 ["BR"], Mercosul 공통은 ["BR", "AR"].
  countries: string[];
  mercosul_basis: string | null;
}

const RDCS: RdcSpec[] = [
  { filename: "RDC_83_2016 (배합금지 성분 목록).pdf",
    status: "banned", function_category: null,
    description: "RDC 83/2016 — 배합금지 성분 목록",
    parser: "ref-cas",
    countries: ["BR", "AR"],
    mercosul_basis: "MERCOSUL GMC 62/2014" },
  { filename: "RDC_03_2012 (배합한도 제한 성분 목록).pdf",
    status: "restricted", function_category: null,
    description: "RDC 03/2012 — 배합한도 제한 성분 목록",
    parser: "ref-cas",
    countries: ["BR", "AR"],
    mercosul_basis: "MERCOSUL GMC 24/2011" },
  { filename: "RDC_29_2012 (허용 보존제 목록).pdf",
    status: "listed", function_category: "보존제",
    description: "RDC 29/2012 — 허용 보존제 목록 (positive list)",
    parser: "positive-list",
    countries: ["BR", "AR"],
    mercosul_basis: "MERCOSUL GMC 23/2011" },
  { filename: "RDC_628_2022 (개인위생 제품, 화장품 및 향수의 허용 착색물질 목록).pdf",
    status: "listed", function_category: "색소",
    description: "RDC 628/2022 — 허용 착색물질 (positive list)",
    parser: "positive-list",
    countries: ["BR"],
    mercosul_basis: null },
  { filename: "RDC_600_2022 (개인 위생용품, 화장품 및 향수 제품에 허용되는 자외선 필터 목록).pdf",
    status: "listed", function_category: "자외선차단제",
    description: "RDC 600/2022 — 허용 자외선 필터 목록 (positive list)",
    parser: "positive-list",
    countries: ["BR"],
    mercosul_basis: null },
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

interface Fingerprint { [filename: string]: { sha256: string; parsed_at: string; entry_count: number } }

interface Entry {
  inci: string;
  cas: string | null;
  ref: string | null;
  max_concentration: number | null;
  conditions: string | null;
}

async function ensureUnzipped(): Promise<void> {
  // 한 번 unzip 후 cache. zip SHA 변경 시 재unzip.
  if (!existsSync(ZIP_FILE)) throw new Error(`zip 부재: ${ZIP_FILE} — kcia:articles 먼저 실행`);
  if (!existsSync(UNZIP_DIR)) mkdirSync(UNZIP_DIR, { recursive: true });
  // 첫 RDC PDF 가 없으면 unzip 실행
  const probeFile = `${UNZIP_DIR}/${RDCS[0].filename}`;
  if (existsSync(probeFile)) return;
  console.log(`▶ unzip ${ZIP_FILE} → ${UNZIP_DIR}`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("unzip", ["-o", ZIP_FILE, "-d", UNZIP_DIR], { stdio: "inherit" });
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)));
  });
}

async function extractText(filename: string): Promise<string> {
  const buf = readFileSync(`${UNZIP_DIR}/${filename}`);
  const { PDFParse } = await import("pdf-parse");
  const r = await new PDFParse({ data: buf }).getText();
  return r.text;
}

function cleanText(text: string): string {
  return text
    .replace(/Ministério da Saúde - MS/g, " ")
    .replace(/Agência Nacional de Vigilância Sanitária - ANVISA/g, " ")
    .replace(/Este texto não substitui[^\n]*/g, " ")
    .replace(/-- \d+ of \d+ --/g, " ")
    .replace(/\s{3,}/g, " ");
}

// RDC 83/03 — "N° N°UE Substância CAS NUMERO EINECS" 표.
// 패턴: 라인 시작 + ref(\d{1,4}) + 공백 + (옵션 EU ref) + substance + CAS + EINECS.
// CAS 패턴 명확하므로 ref 기반 분할.
function parseRefCas(text: string): Entry[] {
  const out: Entry[] = [];
  const cleaned = cleanText(text);
  // ref 위치 — 라인 시작 또는 공백 다음 1~4자리 숫자, 다음에 공백+같은 숫자(EU ref) 또는 공백+텍스트
  // 단순화: substance + CAS 패턴 매칭. 각 entry 가 CAS 한 번 들어 있음.
  // CAS 위치 모두 찾기 → 각 CAS 주변 영역이 한 entry.
  const casRe = /(\d{1,7}-\d{2,4}-\d)/g;
  const casPositions: { cas: string; pos: number }[] = [];
  let m;
  while ((m = casRe.exec(cleaned))) {
    casPositions.push({ cas: m[1], pos: m.index });
  }
  if (casPositions.length === 0) return out;
  // 각 CAS 의 직전 텍스트 = substance. 직전 다른 CAS 위치 또는 ref 패턴 직후가 substance 시작.
  for (let i = 0; i < casPositions.length; i++) {
    const cur = casPositions[i];
    const start = i > 0 ? casPositions[i - 1].pos + casPositions[i - 1].cas.length : 0;
    const block = cleaned.slice(start, cur.pos);
    // ref 추출 (라인 시작 또는 공백 다음 1-4자리 숫자가 두 번 연속 또는 한 번)
    const refM = block.match(/(?:^|\s)(\d{1,4})(?:\s+\d{1,4})?\s+(?=\S)/);
    const ref = refM?.[1] ?? null;
    let substance = (refM ? block.slice((refM.index ?? 0) + refM[0].length) : block)
      .replace(/\s+/g, " ")
      .trim();
    // EINECS 번호 (NNN-NNN-N) 제거
    substance = substance.replace(/\b\d{3}-\d{3}-\d\b/g, " ").replace(/\s+/g, " ").trim();
    if (!substance || substance.length < 3 || substance.length > 400) continue;
    const letters = (substance.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 4) continue;
    out.push({ inci: substance, cas: cur.cas, ref, max_concentration: null, conditions: null });
  }
  // dedupe by (inci lower, cas)
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.inci.toLowerCase()}|${e.cas}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// RDC 29/628/600 — positive list 표. INCI 또는 CI 번호 + CAS + max conc.
function parsePositiveList(text: string): Entry[] {
  const out: Entry[] = [];
  const cleaned = cleanText(text);
  // CAS 위치 또는 CI 번호 위치 찾기. 각 위치 주변에 substance.
  const casRe = /(\d{1,7}-\d{2,4}-\d)/g;
  const casPositions: { cas: string; pos: number }[] = [];
  let m;
  while ((m = casRe.exec(cleaned))) casPositions.push({ cas: m[1], pos: m.index });
  for (let i = 0; i < casPositions.length; i++) {
    const cur = casPositions[i];
    const start = i > 0 ? casPositions[i - 1].pos + casPositions[i - 1].cas.length : 0;
    const block = cleaned.slice(start, cur.pos + cur.cas.length);
    let substance = block
      .replace(/\d{1,7}-\d{2,4}-\d/g, " ")  // CAS 제거
      .replace(/\b\d{3}-\d{3}-\d\b/g, " ")   // EINECS 제거
      .replace(/(?:^|\s)\d{1,4}\s+/g, " ")    // ref 제거
      .replace(/\s+/g, " ")
      .trim();
    // tail 부분만 의미있음 — substance 시작점 추정 위해 line break 직후부터
    const lineBreak = block.lastIndexOf("\n", cur.pos - start - 50);
    if (lineBreak > 0) {
      substance = block.slice(lineBreak)
        .replace(/\d{1,7}-\d{2,4}-\d/g, " ")
        .replace(/\b\d{3}-\d{3}-\d\b/g, " ")
        .replace(/(?:^|\s)\d{1,4}\s+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (!substance || substance.length < 3 || substance.length > 200) continue;
    const letters = (substance.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 4) continue;
    // 농도 추출
    const concM = block.match(/(\d+(?:\.\d+)?)\s*%/);
    const maxConc = concM ? Number(concM[1]) : null;
    out.push({ inci: substance, cas: cur.cas, ref: null, max_concentration: maxConc, conditions: null });
  }
  // dedupe
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.inci.toLowerCase()}|${e.cas}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  const startedAt = Date.now();
  await ensureUnzipped();

  const fingerprints: Fingerprint = existsSync(FINGERPRINT_FILE)
    ? JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"))
    : {};

  const ingredients = await readRows<IngredientRow>("ingredients");
  const byInci = new Map<string, IngredientRow>();
  const byCas = new Map<string, IngredientRow>();
  for (const i of ingredients) {
    byInci.set(i.inci_name.toLowerCase(), i);
    if (i.cas_no) byCas.set(i.cas_no, i);
  }

  const now = new Date().toISOString();
  const newRegs: RegulationRow[] = [];
  const sourceDocsToReplace = new Set<string>();
  let totalProcessed = 0, totalSkipped = 0, totalEntries = 0, totalCreated = 0;

  for (const rdc of RDCS) {
    console.log(`\n▶ ${rdc.description}`);
    const path = `${UNZIP_DIR}/${rdc.filename}`;
    if (!existsSync(path)) {
      console.warn(`  ✗ 파일 부재: ${path}`);
      continue;
    }
    const buf = readFileSync(path);
    const sha = createHash("sha256").update(buf).digest("hex");
    const fp = fingerprints[rdc.filename];
    if (fp && fp.sha256 === sha && fp.entry_count > 0) {
      console.log(`  · 변경 없음 — skip. 이전 entry ${fp.entry_count}.`);
      totalSkipped++;
      continue;
    }
    const text = await extractText(rdc.filename);
    const entries = rdc.parser === "ref-cas" ? parseRefCas(text) : parsePositiveList(text);
    console.log(`  ${(text.length / 1024).toFixed(0)}KB text → ${entries.length} entries`);
    if (entries.length < 5) {
      console.warn(`  ! 너무 적음 — fingerprint 미저장`);
      continue;
    }

    const rdcId = rdc.description.match(/RDC \d+\/\d{4}/)?.[0] ?? rdc.description;
    const brSourceDoc = `${SOURCE_PREFIX} — ${rdc.description}`;
    sourceDocsToReplace.add(brSourceDoc);
    const arSourceDoc = rdc.mercosul_basis
      ? `ANMAT Argentina — ${rdc.mercosul_basis} (BR ANVISA ${rdcId} 동일 채택)`
      : null;
    if (arSourceDoc) sourceDocsToReplace.add(arSourceDoc);
    let created = 0;
    for (const e of entries) {
      let ing = byInci.get(e.inci.toLowerCase());
      if (!ing && e.cas) ing = byCas.get(e.cas);
      if (!ing) {
        ing = {
          id: randomUUID(), inci_name: e.inci,
          korean_name: null, chinese_name: null, japanese_name: null,
          cas_no: e.cas, synonyms: [], description: null,
          function_category: rdc.function_category, function_description: null,
        };
        ingredients.push(ing);
        byInci.set(e.inci.toLowerCase(), ing);
        if (e.cas) byCas.set(e.cas, ing);
        created++;
      } else if (!ing.cas_no && e.cas) ing.cas_no = e.cas;
      for (const cc of rdc.countries) {
        const isMercosulFanout = cc !== "BR" && rdc.mercosul_basis !== null;
        const conditionsText = [
          `${rdc.description} 등재.`,
          isMercosulFanout
            ? `Mercosul 결의 ${rdc.mercosul_basis} — Argentina ANMAT 동일 채택.`
            : (rdc.mercosul_basis ? `Mercosul 결의 ${rdc.mercosul_basis} 채택.` : null),
          e.ref ? `Ref: ${e.ref}` : null,
          e.cas ? `CAS: ${e.cas}` : null,
          `출처: KCIA 15087 첨부(브라질 규정 원문 zip).`,
        ].filter(Boolean).join("\n");
        newRegs.push({
          ingredient_id: ing.id, country_code: cc, status: rdc.status,
          max_concentration: e.max_concentration, concentration_unit: "%",
          product_categories: rdc.function_category ? [rdc.function_category] : [],
          conditions: conditionsText,
          source_url: "https://kcia.or.kr/home/law/law_05.php?type=view&no=15087",
          source_document: cc === "BR" ? brSourceDoc : (arSourceDoc ?? brSourceDoc),
          source_version: rdc.filename.match(/\d{4}/)?.[0] ?? "2022",
          source_priority: 100, last_verified_at: now,
          confidence_score: 1.0, override_note: null,
        });
      }
    }
    totalEntries += entries.length;
    totalCreated += created;
    totalProcessed++;
    fingerprints[rdc.filename] = { sha256: sha, parsed_at: now, entry_count: entries.length };
  }

  const existingRegs = await readRows<RegulationRow>("regulations");
  // 이전 run 에서 다른 prefix·suffix 로 저장된 stale 행도 함께 제거.
  // BR ANVISA RDC 와 AR ANMAT MERCOSUL 채택분 모두.
  const filteredRegs = existingRegs.filter((r) => {
    if (sourceDocsToReplace.has(r.source_document)) return false;
    if (r.source_document.startsWith(`${SOURCE_PREFIX} — RDC `)) return false;
    if (r.source_document.startsWith("ANMAT Argentina — MERCOSUL ")) return false;
    return true;
  });
  const finalRegs = [...filteredRegs, ...newRegs];

  await writeRows("ingredients", ingredients);
  await writeRows("regulations", finalRegs);
  await updateMeta({ ingredients: ingredients.length, regulations: finalRegs.length });
  writeFileSync(FINGERPRINT_FILE, JSON.stringify(fingerprints, null, 2));

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const byCountry = newRegs.reduce<Record<string, number>>((a, r) => {
    a[r.country_code] = (a[r.country_code] ?? 0) + 1; return a;
  }, {});
  console.log(`\n=== summary (${elapsed}s) ===`);
  console.log(`  처리 ${totalProcessed} RDC / skip ${totalSkipped}`);
  console.log(`  entries ${totalEntries} (new ingredients ${totalCreated})`);
  console.log(`  regulations 추가: ${newRegs.length} — ${Object.entries(byCountry).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  console.log(`  ingredients: ${ingredients.length}, regulations: ${finalRegs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
