import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows } from "../../lib/json-store";
import { launchContext } from "./playwright-helper";

// EU Cosmetic Products Regulation 1223/2009 consolidated PDF (Annex II/III/IV/V/VI 통합) 다운로드.
// EUR-Lex 한국 IP 202 차단 — GitHub Actions runner (미국 IP) 에서 실 작동.
// PDF text 파싱 → eu-eurlex-parse.ts (별도 단계, pdf-parse).

const RAW_DIR = ".crawl-raw/eu-eurlex";
const PUBLIC_RAW_DIR = "public/data/raw-pdf";

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

const SOURCES = [
  {
    key: "eu_eurlex_1223_consolidated_pdf",
    title: "EU Cosmetic Products Regulation 1223/2009 (consolidated PDF, all Annexes)",
    url: "https://eur-lex.europa.eu/eli/reg/2009/1223/oj/eng/pdfa1a",
    country: "EU",
    lang: "en",
  },
];

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(PUBLIC_RAW_DIR, { recursive: true });

  const existing = await readRows<SourcePdfRow>("sources-pdf");
  const byKey = new Map(existing.map((r) => [r.key, r]));

  for (const s of SOURCES) {
    const dest = join(RAW_DIR, `${s.key}.pdf`);
    const publicDest = join(PUBLIC_RAW_DIR, `${s.key}.pdf`);
    console.log(`▶ ${s.country} ${s.key} ← ${s.url}`);

    const ctx = await launchContext({ acceptLang: "en-GB,en;q=0.9" });
    try {
      const res = await ctx.context.request.get(s.url, {
        headers: { Accept: "application/pdf" },
        timeout: 60_000,
      });
      if (!res.ok()) {
        console.error(`  ✗ HTTP ${res.status()}`);
        continue;
      }
      const buf = Buffer.from(await res.body());
      await writeFile(dest, buf);
      await writeFile(publicDest, buf);
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const row: SourcePdfRow = {
        key: s.key,
        title: s.title,
        url: s.url,
        country: s.country,
        lang: s.lang,
        file_path: dest,
        size_bytes: buf.length,
        etag: res.headers()["etag"] ?? null,
        last_modified_header: res.headers()["last-modified"] ?? null,
        downloaded_at: new Date().toISOString(),
        content_hash: hash,
      };
      byKey.set(s.key, row);
      console.log(`  ✓ ${buf.length} bytes hash=${hash}`);
    } catch (e) {
      console.error(`  ✗ ${e instanceof Error ? e.message : e}`);
    } finally {
      await ctx.close();
    }
  }

  await writeRows("sources-pdf", Array.from(byKey.values()));
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
