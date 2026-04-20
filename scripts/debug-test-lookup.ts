import { loadEnv } from "./crawlers/env";
loadEnv();

import { lookupRegulation } from "../lib/regulations-query";

async function main() {
  console.log("━━━ 1. DB lookup: 레티놀 (Korean) ━━━");
  const r1 = await lookupRegulation("레티놀", ["KR", "CN", "EU", "US", "JP", "VN"]);
  console.log(JSON.stringify(r1, null, 2).slice(0, 2000));

  console.log("\n━━━ 2. DB lookup: Retinol (English) ━━━");
  const r2 = await lookupRegulation("Retinol", ["KR", "EU"]);
  console.log(JSON.stringify(r2, null, 2).slice(0, 1500));

  console.log("\n━━━ 3. DB lookup: 68-26-8 (CAS) ━━━");
  const r3 = await lookupRegulation("68-26-8");
  console.log("ingredient:", r3.ingredient?.inci_name, "| matches:", r3.results.filter((x) => x.source === "verified").length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
