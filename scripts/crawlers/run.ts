import { loadEnv } from "./env";
loadEnv();

import { supabaseAdmin } from "../../lib/supabase";
import { runCrawler } from "./base";
import { allSources } from "./index";
import type { CrawlOutcome } from "./types";

async function main() {
  const filter = process.argv[2]; // optional country code filter (e.g. `npm run crawl US`)
  const sources = filter
    ? allSources.filter((s) => s.country_code === filter.toUpperCase())
    : allSources;

  if (sources.length === 0) {
    console.error(`No sources match filter "${filter}".`);
    process.exit(2);
  }

  const supabase = supabaseAdmin();
  const results: CrawlOutcome[] = [];

  for (const source of sources) {
    const runStart = new Date().toISOString();
    const { data: runRow } = await supabase
      .from("crawl_runs")
      .insert({
        country_code: source.country_code,
        started_at: runStart,
        status: "running",
      })
      .select("id")
      .single();

    console.log(`▶ [${source.country_code}] ${source.doc_key} ...`);
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

  if (summary.failed > 0 && process.env.CI) {
    // In CI, exit non-zero so the workflow flags the failure (but we still wrote to DB)
    process.exitCode = 0; // keep 0 so dead-detection alert logic in another job handles it
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
