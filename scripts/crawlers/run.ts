import { loadEnv } from "./env";
loadEnv();

import { supabaseAdmin } from "../../lib/supabase";
import { runCrawler, fetchUrl } from "./base";
import type { CrawlOutcome } from "./types";
import type { CrawlerSourceWithRegistry } from "./base";

/**
 * regulation_sources 테이블을 단일 진실 소스로 사용.
 * Phase 1에서 seed.ts로 입력한 15국 19건을 모두 순회.
 * 하드코딩 배열(allSources) 폐기 — DB 레지스트리 추가/수정/비활성화가
 * 즉시 반영되도록.
 */
async function main() {
  const filter = process.argv[2]?.toUpperCase();
  const supabase = supabaseAdmin();

  let query = supabase
    .from("regulation_sources")
    .select("id, country_code, name, url, detect_method, priority")
    .eq("active", true)
    .order("priority", { ascending: false });
  if (filter) query = query.eq("country_code", filter);
  const { data: sources, error } = await query;
  if (error) throw new Error(`regulation_sources 조회 실패: ${error.message}`);
  if (!sources || sources.length === 0) {
    console.error(`regulation_sources에 active=true 행이 없음${filter ? ` (filter=${filter})` : ""}.`);
    process.exit(2);
  }

  console.log(`${sources.length}개 소스 크롤 시작${filter ? ` (${filter})` : ""}`);

  const results: CrawlOutcome[] = [];
  for (const s of sources) {
    // RSS / API detect_method는 본 스크립트 범위 밖 (Phase 2 scope: detect-changes 전용 워크플로우).
    // 여기서는 head/hash만 실제 fetch.
    if (s.detect_method !== "head" && s.detect_method !== "hash") {
      console.log(`· [${s.country_code}] ${s.name} — detect_method=${s.detect_method} skip (별도 처리)`);
      continue;
    }

    const country_code = s.country_code as string;
    const rawName = s.name as string;
    const source_url = s.url as string;
    const doc_key = toDocKey(country_code, rawName);

    const runStart = new Date().toISOString();
    const { data: runRow } = await supabase
      .from("crawl_runs")
      .insert({
        country_code,
        started_at: runStart,
        status: "running",
      })
      .select("id")
      .single();

    console.log(`▶ [${country_code}] ${rawName}`);

    const source: CrawlerSourceWithRegistry = {
      country_code,
      doc_key,
      title: rawName,
      source_url,
      regulation_source_id: s.id as string,
      async fetch() {
        const r = await fetchUrl(source_url, { expectedExt: ".html" });
        return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
      },
    };

    const outcome = await runCrawler(source);
    results.push(outcome);

    console.log(
      `  → ${outcome.status}${outcome.content_hash ? ` (hash ${outcome.content_hash.slice(0, 12)}…)` : ""}${
        outcome.error ? ` — ${outcome.error}` : ""
      }`,
    );

    if (runRow?.id) {
      await supabase
        .from("crawl_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: outcome.status === "failed" ? "failed" : "success",
          docs_checked: 1,
          docs_changed: outcome.status === "changed" ? 1 : 0,
          error_message: outcome.error ?? null,
        })
        .eq("id", runRow.id);
    }
  }

  const summary = {
    total: results.length,
    changed: results.filter((r) => r.status === "changed").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  console.log("\n=== summary ===");
  console.log(summary);
  // 실패 집계는 check-crawlers.ts가 담당 — 여기서는 0 exit로 다음 CI step 통과.
}

// "NMPA 化妆品监管公告" → "nmpa_hua_zhuang_pin_jian_guan_gong_gao" 식은 과함.
// 안전한 대체: 국가별 일련번호. regulation_sources.id(UUID)를 그대로 쓸 수도 있으나
// source_documents는 human-readable doc_key가 운영상 가독성 높음.
function toDocKey(cc: string, name: string): string {
  // ASCII 슬러그 + 최대 40자
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "src";
  return `${cc.toLowerCase()}_${slug}`;
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
