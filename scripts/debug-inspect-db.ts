import { loadEnv } from "./crawlers/env";
loadEnv();
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  const s = supabaseAdmin();

  const { count: ingCount } = await s.from("ingredients").select("*", { count: "exact", head: true });
  const { count: regCount } = await s.from("regulations").select("*", { count: "exact", head: true });
  console.log(`ingredients: ${ingCount}   regulations: ${regCount}`);

  console.log("\n=== regulations by country ===");
  const codes = ["KR", "CN", "EU", "US", "JP", "VN", "TH", "ID", "MY", "PH", "SG", "TW"];
  const counts: Record<string, number> = {};
  for (const c of codes) {
    const { count } = await s
      .from("regulations")
      .select("*", { count: "exact", head: true })
      .eq("country_code", c);
    counts[c] = count ?? 0;
  }
  console.table(counts);

  console.log("\n=== Korean search test: 레티놀 ===");
  const { data: retinol } = await s
    .from("ingredients")
    .select("inci_name, korean_name, cas_no")
    .or("inci_name.ilike.%retinol%,korean_name.ilike.%레티놀%")
    .limit(5);
  console.table(retinol);

  console.log("\n=== Sample ingredient with regulations (for first KR-banned) ===");
  const { data: sample } = await s
    .from("regulations")
    .select("country_code, status, conditions, ingredient:ingredients(inci_name, korean_name, cas_no)")
    .eq("country_code", "KR")
    .eq("status", "banned")
    .limit(2);
  console.log(JSON.stringify(sample, null, 2).slice(0, 1500));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
