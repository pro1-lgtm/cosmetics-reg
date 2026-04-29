import { loadEnv } from "./env";
loadEnv();

import { runCrawler, fetchUrl, type CrawlerSourceWithRegistry } from "./base";
import type { CrawlOutcome } from "./types";
import { readRows, updateMeta } from "../../lib/json-store";

// Phase 5b — Supabase 제거. regulation-sources.json 을 단일 진실로 사용.

interface RegulationSourceRow {
  id: string;
  country_code: string;
  name: string;
  url: string;
  detect_method: string;
  priority: number;
  active: boolean;
}

interface DetectedChangeRow {
  review_status: string;
}

function toDocKey(cc: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9_\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "src";
  return `${cc.toLowerCase()}_${slug}`;
}

async function main() {
  const filter = process.argv[2]?.toUpperCase();

  const all = await readRows<RegulationSourceRow>("regulation-sources");
  let sources = all.filter((s) => s.active).sort((a, b) => b.priority - a.priority);
  if (filter) sources = sources.filter((s) => s.country_code === filter);

  if (sources.length === 0) {
    console.error(`regulation-sources.json 에 active=true 행이 없음${filter ? ` (filter=${filter})` : ""}.`);
    console.error("npm run sources:seed 를 먼저 실행.");
    process.exit(2);
  }

  console.log(`${sources.length}개 소스 크롤 시작${filter ? ` (${filter})` : ""}`);

  const results: CrawlOutcome[] = [];
  for (const s of sources) {
    if (s.detect_method !== "head" && s.detect_method !== "hash") {
      console.log(`· [${s.country_code}] ${s.name} — detect_method=${s.detect_method} skip (별도 처리)`);
      continue;
    }

    const country_code = s.country_code;
    const rawName = s.name;
    const source_url = s.url;
    const doc_key = toDocKey(country_code, rawName);

    console.log(`▶ [${country_code}] ${rawName}`);

    const source: CrawlerSourceWithRegistry = {
      country_code,
      doc_key,
      title: rawName,
      source_url,
      regulation_source_id: s.id,
      async fetch() {
        const r = await fetchUrl(source_url, { expectedExt: ".html" });
        return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
      },
    };

    const outcome = await runCrawler(source);
    results.push(outcome);

    console.log(`  → ${outcome.status}${outcome.content_hash ? ` (hash ${outcome.content_hash.slice(0, 12)}…)` : ""}${outcome.error ? ` — ${outcome.error}` : ""}`);
  }

  const detected = await readRows<DetectedChangeRow>("detected-changes");
  await updateMeta({
    detected_changes_pending: detected.filter((d) => d.review_status === "pending").length,
  });

  const summary = {
    total: results.length,
    changed: results.filter((r) => r.status === "changed").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  console.log("\n=== summary ===");
  console.log(summary);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
