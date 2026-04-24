import { loadEnv } from "./crawlers/env";
loadEnv();
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  const s = supabaseAdmin();

  const totalAll = await s.from("regulations").select("*", { count: "exact", head: true });
  const active = await s.from("regulations_active").select("*", { count: "exact", head: true });
  const closed = await s.from("regulations").select("*", { count: "exact", head: true }).not("valid_to", "is", null);
  console.log(`regulations total=${totalAll.count} active=${active.count} closed=${closed.count}`);

  console.log("\n활성 source_document 분포 (알려진 이름별 HEAD count):");
  const sources = [
    "MFDS 공공데이터 API",
    "FDA Prohibited & Restricted Ingredients in Cosmetics",
    "EU CosIng — Annex II-VI consolidated",
    "일본 MHLW 화장품기준 (포지티브·네거티브 리스트)",
    "NMPA 화장품 규제 공고 목록 (IECIC 포함)",
    "베트남 DAV 화장품 관련 공고",
    "태국 FDA 화장품 공고",
  ];
  for (const src of sources) {
    const r = await s.from("regulations_active").select("*", { count: "exact", head: true }).eq("source_document", src);
    console.log(`  ${String(r.count ?? 0).padStart(6)}  ${src}`);
  }

  console.log("\nMFDS 이번 세션 삽입분(valid_from 최근 1h):");
  const nowMs = Date.now();
  const recentIso = new Date(nowMs - 3600_000).toISOString();
  const recent = await s.from("regulations").select("*", { count: "exact", head: true }).gte("valid_from", recentIso).eq("source_document", "MFDS 공공데이터 API");
  console.log(`  최근 1h MFDS: ${recent.count}건`);

  console.log("\nunique index 존재 여부 (간접 확인 — 중복 insert 성공 가능 = 없음):");
  // 그냥 정보 제공용
  const anyDup = await s.from("regulations_active").select("ingredient_id,country_code").limit(1);
  console.log(`  샘플 조회 OK: ${anyDup.error ? "❌" : "✅"}`);

  console.log("\ningredients·regulation_sources·detected_changes·quarantine:");
  for (const t of ["ingredients", "regulation_sources", "detected_changes", "regulation_quarantine"]) {
    const r = await s.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t.padEnd(25)}: ${r.count}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
