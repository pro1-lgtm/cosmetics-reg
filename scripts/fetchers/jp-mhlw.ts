import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// 일본 후생노동성 (MHLW) 化粧品基準 + 별표 PDF 자동 다운로드.
// PDF 본문 ingredient 추출은 Gemini quota 의존이라 별도 단계 (cron 으로 점진).
// 본 fetcher 는 PDF 자동 갱신 + 메타데이터 (URL/size/etag/downloaded_at) 까지.

const RAW_DIR = ".crawl-raw/jp-mhlw";
const SOURCES = [
  {
    key: "jp_mhlw_cosmetic_standards",
    title: "化粧品基準 (Standards for Cosmetics) — 平成12年厚生省告示第331号",
    url: "https://www.mhlw.go.jp/content/000491511.pdf",
    country: "JP",
    lang: "ja",
  },
  {
    key: "jp_mhlw_cosmetic_standards_en",
    title: "Standards for Cosmetics (English version) — MHLW Notification 331",
    url: "https://www.mhlw.go.jp/content/001257665.pdf",
    country: "JP",
    lang: "en",
  },
  {
    key: "jp_mhlw_annex_1",
    title: "化粧品基準 別表 1 — 品目ごと承認対象成分 (Schedule 1: Approval-required ingredients per category)",
    url: "https://www.mhlw.go.jp/content/001305716.pdf",
    country: "JP",
    lang: "ja",
  },
];

interface SourcePdfRow {
  key: string;
  title: string;
  url: string;
  country: string;
  lang: string;
  file_path: string;
  size_bytes: number;
  etag: string | null;
  last_modified_header: string | null;
  downloaded_at: string;
  content_hash: string;
}

async function downloadPdf(url: string, dest: string): Promise<{ size: number; etag: string | null; lastModified: string | null }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "cosmetics-reg/1.0 (auto data refresh)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return {
    size: buf.length,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

async function main() {
  const startedAt = Date.now();
  await mkdir(RAW_DIR, { recursive: true });

  const existing = await readRows<SourcePdfRow>("sources-pdf");
  const byKey = new Map(existing.map((r) => [r.key, r]));

  const results: SourcePdfRow[] = [];
  for (const s of SOURCES) {
    const dest = join(RAW_DIR, `${s.key}.pdf`);
    console.log(`▶ ${s.country} ${s.key} ← ${s.url}`);
    try {
      const { size, etag, lastModified } = await downloadPdf(s.url, dest);
      // simple hash via crypto
      const { createHash } = await import("node:crypto");
      const fs = await import("node:fs/promises");
      const buf = await fs.readFile(dest);
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);

      const prev = byKey.get(s.key);
      const changed = !prev || prev.content_hash !== hash;
      const row: SourcePdfRow = {
        key: s.key,
        title: s.title,
        url: s.url,
        country: s.country,
        lang: s.lang,
        file_path: dest,
        size_bytes: size,
        etag,
        last_modified_header: lastModified,
        downloaded_at: new Date().toISOString(),
        content_hash: hash,
      };
      results.push(row);
      console.log(`  ✓ ${size} bytes ${changed ? "(changed)" : "(unchanged)"} hash=${hash}`);
    } catch (e) {
      console.error(`  ✗ ${s.key}: ${e instanceof Error ? e.message : e}`);
      // 실패해도 기존 행 보존
      const prev = byKey.get(s.key);
      if (prev) results.push(prev);
    }
  }

  // 다른 country 의 기존 row 보존 (이 fetcher 는 JP 만 처리)
  const otherCountries = existing.filter((r) => r.country !== "JP");
  const final = [...otherCountries, ...results];
  await writeRows("sources-pdf", final);
  await updateMeta({});

  console.log(`\n=== summary (${((Date.now()-startedAt)/1000).toFixed(1)}s) ===`);
  console.log(`  JP PDFs: ${results.length}`);
  console.log(`  total sources-pdf: ${final.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
