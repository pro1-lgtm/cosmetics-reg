import { loadEnv } from "../crawlers/env";
loadEnv();

import { supabaseAdmin } from "../../lib/supabase";
import { REGULATION_SOURCES } from "./registry";

async function main() {
  const supabase = supabaseAdmin();

  // upsert by (country_code, name) — 재실행 idempotent
  const rows = REGULATION_SOURCES.map((s) => ({
    country_code: s.country_code,
    name: s.name,
    description: s.description ?? null,
    url: s.url,
    detect_method: s.detect_method,
    content_selector: s.content_selector ?? null,
    check_cadence_hours: s.check_cadence_hours ?? 24,
    tier: s.tier,
    priority: s.priority ?? 0,
    owner_email: "tim10000@janytree.com",
    active: true,
  }));

  const { error } = await supabase
    .from("regulation_sources")
    .upsert(rows, { onConflict: "country_code,name" });

  if (error) {
    console.error("upsert 실패:", error.message);
    process.exit(1);
  }

  const { data: summary } = await supabase
    .from("regulation_sources")
    .select("country_code, tier, active")
    .order("country_code");

  const byCountry: Record<string, { primary: number; secondary: number; tertiary: number }> = {};
  (summary ?? []).forEach((r) => {
    const c = (r.country_code as string) ?? "?";
    byCountry[c] ??= { primary: 0, secondary: 0, tertiary: 0 };
    byCountry[c][r.tier as "primary" | "secondary" | "tertiary"]++;
  });

  console.log(`✓ ${rows.length}건 upsert. 현 DB 전체 ${summary?.length ?? 0}건`);
  console.log("국가별 (primary / secondary / tertiary):");
  Object.entries(byCountry)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([code, counts]) => {
      console.log(`  ${code}: ${counts.primary} / ${counts.secondary} / ${counts.tertiary}`);
    });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
