import { loadEnv } from "../crawlers/env";
loadEnv();
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// Comunidad Andina (Andean Community) Decisión 833 — CO/EC/PE/BO 가 EU + FDA + 산업 list 채택.
// Article 4-5: "Reglamentos de la Unión Europea que se pronuncien sobre ingredientes cosméticos"
// + FDA + Personal Care Products Council + Cosmetics Europe. "listado menos restrictivo" 사용.
//
// 본 fetcher: 기존 EU 1차 regulations (priority 100) → CO/EC/PE/BO 4국 fanout.
// EU PDF 갱신 cron 후 실행 → 항상 EU 와 sync.
// US 1차 fanout 은 별도 검토 (FDA list 도 4국에 적용되지만 우선 EU 만).

const ANDEAN_COUNTRIES = ["CO", "EC", "PE", "BO"];
const ANDEAN_NAMES: Record<string, string> = {
  CO: "INVIMA Colombia", EC: "ARCSA Ecuador", PE: "DIGEMID Peru", BO: "AGEMED Bolivia",
};

interface RegulationRow {
  ingredient_id: string;
  country_code: string;
  status: string;
  max_concentration: number | null;
  concentration_unit: string;
  product_categories: string[];
  conditions: string | null;
  source_url: string | null;
  source_document: string;
  source_version: string | null;
  source_priority: number;
  last_verified_at: string;
  confidence_score: number;
  override_note: string | null;
}

async function main() {
  const startedAt = Date.now();
  const all = await readRows<RegulationRow>("regulations");
  // EU 1차 source 만 fanout. priority 100 + EU country.
  const euPrimary = all.filter(
    (r) => r.country_code === "EU" && r.source_priority === 100 && r.source_document.startsWith("EU EUR-Lex"),
  );
  console.log(`▶ EU 1차 regulations: ${euPrimary.length} → Andean Community 4국 fanout`);

  const now = new Date().toISOString();
  const newRegs: RegulationRow[] = [];
  for (const eu of euPrimary) {
    for (const cc of ANDEAN_COUNTRIES) {
      // EU source_document 은 단일이라 Annex 식별 불가. conditions 의 "Annex N" 텍스트 활용.
      const annexMatch = (eu.conditions ?? "").match(/Annex\s+([IVX]+)/);
      const annexLabel = annexMatch ? `Annex ${annexMatch[1]}` : "Annex";
      const sourceDoc = `${ANDEAN_NAMES[cc]} — Comunidad Andina Decisión 833 (EU 1223/2009 ${annexLabel} 채택)`;
      newRegs.push({
        ...eu,
        country_code: cc,
        conditions: [
          eu.conditions ?? "",
          `Comunidad Andina Decisión 833 (Article 4-5) — EU Cosmetic Regulation 1223/2009 ${annexLabel} 채택. CO/EC/PE/BO 동일 기준 (가장 덜 restrictive 한 list 적용 원칙).`,
        ].filter(Boolean).join("\n"),
        source_document: sourceDoc,
        last_verified_at: now,
      });
    }
  }
  console.log(`  fanout: ${newRegs.length} (${euPrimary.length} × ${ANDEAN_COUNTRIES.length})`);

  // 기존 Andean source 삭제 + 새 데이터 추가.
  const filtered = all.filter((r) => {
    if (!ANDEAN_COUNTRIES.includes(r.country_code)) return true;
    // Andean country 의 기존 Decisión 833 fanout 만 제거. MFDS (3안) 등 다른 source 보존.
    return !r.source_document.includes("Comunidad Andina Decisión 833");
  });
  const final = [...filtered, ...newRegs];

  await writeRows("regulations", final);
  await updateMeta({ regulations: final.length });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== summary (${elapsed}s) ===`);
  console.log(`  Andean fanout: ${newRegs.length} regulations (priority 100)`);
  const byCc: Record<string, number> = {};
  for (const r of newRegs) byCc[r.country_code] = (byCc[r.country_code] ?? 0) + 1;
  console.log(`  by country: ${Object.entries(byCc).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  console.log(`  total regulations: ${final.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
