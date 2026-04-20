import { loadEnv } from "./crawlers/env";
loadEnv();
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  const s = supabaseAdmin();

  console.log("=== regulations (auto_verified=true) ===");
  const { data: regs } = await s
    .from("regulations")
    .select("country_code, status, max_concentration, confidence_score, ingredient:ingredients(inci_name, korean_name)")
    .order("country_code");
  console.table(
    regs?.map((r) => ({
      country: r.country_code,
      inci: (r.ingredient as { inci_name?: string } | null)?.inci_name,
      status: r.status,
      max_conc: r.max_concentration,
      conf: r.confidence_score,
    })),
  );

  console.log("\n=== quarantine (status=pending) ===");
  const { data: quar } = await s
    .from("regulation_quarantine")
    .select("country_code, ingredient_name_raw, rejection_reason, confidence_score")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  console.table(quar);

  const { count: regCount } = await s.from("regulations").select("*", { count: "exact", head: true });
  const { count: ingCount } = await s.from("ingredients").select("*", { count: "exact", head: true });
  const { count: quarCount } = await s
    .from("regulation_quarantine")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  console.log(`\nTotals — ingredients: ${ingCount}, regulations: ${regCount}, quarantine pending: ${quarCount}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
