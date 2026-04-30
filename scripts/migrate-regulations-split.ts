import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { loadEnv } from "./crawlers/env";
loadEnv();
import { writeRows, DATA_DIR } from "../lib/json-store";

// 1회 마이그레이션: public/data/regulations.json (single 50+ MB) → regulations/{cc}.json 분할.
// 이후 단일 파일 삭제. json-store.ts 가 자동으로 split 디렉터리 read/write 하므로 이후 fetcher
// 변경 0.

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
  const single = `${DATA_DIR}/regulations.json`;
  if (!existsSync(single)) {
    console.log("regulations.json 부재 — 이미 split 됨 또는 데이터 없음. exit.");
    return;
  }
  const raw = readFileSync(single, "utf8");
  const payload = JSON.parse(raw) as { rows: RegulationRow[] };
  const rows = payload.rows;
  console.log(`source: ${single}, rows: ${rows.length}, size: ${(raw.length / 1024 / 1024).toFixed(2)} MB`);

  const byCc = new Map<string, number>();
  for (const r of rows) byCc.set(r.country_code, (byCc.get(r.country_code) ?? 0) + 1);
  console.log(`countries: ${byCc.size}`);
  for (const [cc, n] of byCc) console.log(`  ${cc}: ${n}`);

  // writeRows 가 자동으로 country group 분할 + atomic write.
  await writeRows("regulations", rows);
  console.log(`✓ split → ${DATA_DIR}/regulations/{cc}.json`);

  // 단일 파일 삭제 — git push 50MB 경고 회피.
  unlinkSync(single);
  console.log(`✓ deleted ${single}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
