import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows } from "../../lib/json-store";
import { launchContext } from "./playwright-helper";

// 차단된 정부 사이트 (canada.ca / eur-lex / nmpa / gov.br anvisa / argentina anmat) 의
// 메인 페이지 raw HTML 자동 fetch. GitHub Actions runner (미국 IP) 에서 실 작동 시도.
//
// 사용: npm run fetch:try -- <country> <url> <key>
// 예: npm run fetch:try -- EU https://eur-lex.europa.eu/.../1223 eu_eurlex_1223
//
// 결과: .crawl-raw/generic/<key>.html + public/data/sources-raw-html.json metadata.

const RAW_DIR = ".crawl-raw/generic";

interface SourceRawHtml {
  key: string;
  country: string;
  url: string;
  fetched_at: string;
  size_bytes: number;
  content_hash: string;
  http_status: number | null;
  success: boolean;
  error: string | null;
}

async function main() {
  const [country, url, key] = process.argv.slice(2);
  if (!country || !url || !key) {
    console.error("Usage: tsx generic-playwright.ts <country> <url> <key>");
    process.exit(1);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const dest = join(RAW_DIR, `${key}.html`);

  const existing = await readRows<SourceRawHtml>("sources-raw-html");
  const byKey = new Map(existing.map((r) => [r.key, r]));

  const now = new Date().toISOString();
  let row: SourceRawHtml = {
    key, country, url, fetched_at: now,
    size_bytes: 0, content_hash: "", http_status: null,
    success: false, error: null,
  };

  console.log(`▶ ${country} ${key} ← ${url}`);
  try {
    const ctx = await launchContext({ acceptLang: country === "EU" ? "en-GB,en;q=0.9" : "en-US,en;q=0.9" });
    try {
      const html = await ctx.fetchHtml(url, { timeoutMs: 60_000 });
      const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
      await writeFile(dest, html, "utf8");
      row = { ...row, size_bytes: html.length, content_hash: hash, http_status: 200, success: true };
      console.log(`  ✓ ${html.length} bytes hash=${hash}`);
    } finally {
      await ctx.close();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    row.error = msg.slice(0, 300);
    console.error(`  ✗ ${msg}`);
  }

  byKey.set(key, row);
  await writeRows("sources-raw-html", Array.from(byKey.values()));
}

main().catch((e) => { console.error(e); process.exit(1); });
