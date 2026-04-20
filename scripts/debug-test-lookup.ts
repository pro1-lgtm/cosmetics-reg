import { loadEnv } from "./crawlers/env";
loadEnv();

import { lookupRegulation } from "../lib/regulations-query";
import { liveRegulationLookup } from "../lib/live-fallback";

async function main() {
  console.log("━━━ 1. DB lookup: Hexachlorophene (verified 예상) ━━━");
  const r1 = await lookupRegulation("Hexachlorophene", ["US", "KR", "EU"]);
  console.log(JSON.stringify(r1, null, 2));

  console.log("\n━━━ 2. DB lookup: Mercury (quarantine 예상) ━━━");
  const r2 = await lookupRegulation("Mercury", ["US"]);
  console.log(JSON.stringify(r2, null, 2));

  console.log("\n━━━ 3. Live fallback: Retinol × 중국 수출 가능 여부 ━━━");
  const live = await liveRegulationLookup("Retinol", "CN");
  console.log("found:", live.found);
  console.log("answer:", live.answer_text.slice(0, 300));
  console.log("sources:", live.sources.slice(0, 3));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
