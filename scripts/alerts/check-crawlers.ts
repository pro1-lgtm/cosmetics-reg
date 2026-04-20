import { loadEnv } from "../crawlers/env";
loadEnv();

import { supabaseAdmin } from "../../lib/supabase";

// Thresholds
const STALE_CHECK_HOURS = 48;           // last_checked_at older than this = workflow not running
const CONSECUTIVE_FAIL_THRESHOLD = 3;    // N consecutive failed runs = crawler broken
const STALE_CHANGE_DAYS = 365;           // last_changed_at older than this = site may have restructured

async function main() {
  const supabase = supabaseAdmin();
  const alerts: string[] = [];
  const now = Date.now();

  // 1) Per-document staleness check
  const { data: docs } = await supabase
    .from("source_documents")
    .select("country_code, doc_key, last_checked_at, last_changed_at, check_status, notes");

  for (const d of docs ?? []) {
    const country = d.country_code as string;
    const docKey = d.doc_key as string;

    if (!d.last_checked_at) {
      alerts.push(`[${country}/${docKey}] last_checked_at is NULL — crawler never ran successfully.`);
      continue;
    }
    const hoursSinceCheck = (now - new Date(d.last_checked_at).getTime()) / 3_600_000;
    if (hoursSinceCheck > STALE_CHECK_HOURS) {
      alerts.push(
        `[${country}/${docKey}] last check ${hoursSinceCheck.toFixed(1)}h ago (>${STALE_CHECK_HOURS}h) — workflow may not be running.`,
      );
    }

    if (d.last_changed_at) {
      const daysSinceChange = (now - new Date(d.last_changed_at).getTime()) / 86_400_000;
      if (daysSinceChange > STALE_CHANGE_DAYS) {
        alerts.push(
          `[${country}/${docKey}] no content change in ${daysSinceChange.toFixed(0)} days (>${STALE_CHANGE_DAYS}d) — source site may have restructured.`,
        );
      }
    }
  }

  // 2) Consecutive failure detection per country
  const { data: countries } = await supabase.from("countries").select("code");
  for (const c of countries ?? []) {
    const { data: recent } = await supabase
      .from("crawl_runs")
      .select("status, started_at, error_message")
      .eq("country_code", c.code)
      .order("started_at", { ascending: false })
      .limit(CONSECUTIVE_FAIL_THRESHOLD);

    if (!recent || recent.length < CONSECUTIVE_FAIL_THRESHOLD) continue;
    const allFailed = recent.every((r) => r.status === "failed");
    if (allFailed) {
      const lastErr = recent[0]?.error_message ?? "unknown";
      alerts.push(
        `[${c.code}] last ${CONSECUTIVE_FAIL_THRESHOLD} crawl runs all FAILED. Latest error: ${lastErr.slice(0, 200)}`,
      );
    }
  }

  if (alerts.length === 0) {
    console.log("✓ All crawlers healthy.");
    return;
  }

  console.log(`⚠ ${alerts.length} alert(s):`);
  for (const a of alerts) console.log(`  · ${a}`);
  // Non-zero exit → GitHub Actions marks workflow as failed → GitHub emails the repo owner.
  process.exit(1);
}

main().catch((e) => {
  console.error("Health check script crashed:", e);
  process.exit(2);
});
