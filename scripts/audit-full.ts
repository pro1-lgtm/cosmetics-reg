import { loadEnv } from "./crawlers/env";
loadEnv();
import { supabaseAdmin } from "../lib/supabase-admin";

async function main() {
  const s = supabaseAdmin();

  console.log("=== A. regulation_quarantine 전수 (pending 15건 예상) ===");
  const quars = await s.from("regulation_quarantine").select("*").order("created_at");
  (quars.data ?? []).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.country_code} ${r.status} ${String(r.rejection_reason ?? "").slice(0,60)} | ${String(r.ingredient_name_raw ?? "").slice(0,40)}`);
  });
  console.log(`  total: ${quars.data?.length}`);

  console.log("\n=== B. crawl_runs 분포 (country × status) ===");
  const runs = await s.from("crawl_runs").select("country_code, status, error_message");
  const byKey: Record<string, number> = {};
  (runs.data ?? []).forEach((r) => {
    const k = `${r.country_code}:${r.status}`;
    byKey[k] = (byKey[k] ?? 0) + 1;
  });
  Object.entries(byKey).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log(`  total runs: ${runs.data?.length}`);

  console.log("\n=== C. regulations 동일 (ingredient × country) 중복 탐지 (active only) ===");
  // 전수 페이지네이션
  const all: { ingredient_id: string; country_code: string }[] = [];
  let from = 0; const page = 1000;
  while (true) {
    const { data } = await s.from("regulations_active").select("ingredient_id, country_code").range(from, from + page - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as { ingredient_id: string; country_code: string }[]));
    if (data.length < page) break;
    from += page;
  }
  const keyCount: Record<string, number> = {};
  all.forEach((r) => {
    const k = `${r.ingredient_id}|${r.country_code}`;
    keyCount[k] = (keyCount[k] ?? 0) + 1;
  });
  const dups = Object.entries(keyCount).filter(([, v]) => v > 1);
  console.log(`  전체 활성 행: ${all.length} / 고유 조합: ${Object.keys(keyCount).length} / 중복 조합 개수: ${dups.length}`);
  if (dups.length > 0) {
    console.log(`  중복 top 5 (조합:개수):`);
    dups.sort((a,b) => b[1]-a[1]).slice(0,5).forEach(([k, v]) => console.log(`    ${k.slice(0,60)}: ${v}`));
  }

  console.log("\n=== D. ingredients.synonyms 내 중복 원소 보유 row 탐지 ===");
  const dupCheck = await s.from("ingredients").select("id, inci_name, synonyms").limit(5000);
  let bad = 0;
  (dupCheck.data ?? []).forEach((r) => {
    const syn = (r.synonyms as string[] | null) ?? [];
    if (new Set(syn).size !== syn.length) bad++;
  });
  console.log(`  샘플 5000 중 synonyms 내부 중복 보유: ${bad}건`);

  console.log("\n=== E. detected_changes 현황 (Phase 2 구조 실제 활용?) ===");
  const dc = await s.from("detected_changes").select("change_type, review_status, country_code");
  const dcKey: Record<string, number> = {};
  (dc.data ?? []).forEach((r) => {
    const k = `${r.country_code}:${r.change_type}:${r.review_status}`;
    dcKey[k] = (dcKey[k] ?? 0) + 1;
  });
  Object.entries(dcKey).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  if (Object.keys(dcKey).length === 0) console.log("  (empty — crawlers는 아직 신규 URL 기준 실행 전)");

  console.log("\n=== F. regulations enum 실제 분포 (active) — 정확치 ===");
  for (const st of ["banned","restricted","allowed","listed","not_listed","unknown"]) {
    const r = await s.from("regulations_active").select("*", { count: "exact", head: true }).eq("status", st);
    console.log(`  ${st.padEnd(11)}: ${r.count ?? 0}`);
  }

  console.log("\n=== G. regulations FK 연결률 (Phase 2 개선 후) ===");
  const withSD = await s.from("regulations_active").select("*", { count: "exact", head: true }).not("source_document_id","is",null);
  const withSV = await s.from("regulations_active").select("*", { count: "exact", head: true }).not("source_version","is",null);
  const withIS = await s.from("regulations_active").select("*", { count: "exact", head: true }).not("inclusion_side","is",null);
  console.log(`  source_document_id 채워짐: ${withSD.count ?? 0} (MFDS ingest 재실행 필요 시 0)`);
  console.log(`  source_version 채워짐:    ${withSV.count ?? 0}`);
  console.log(`  inclusion_side 채워짐:    ${withIS.count ?? 0}`);

  console.log("\n=== H. regulation_sources consecutive_failures 분포 ===");
  const rs = await s.from("regulation_sources").select("country_code, name, consecutive_failures, check_status").order("consecutive_failures", { ascending: false });
  (rs.data ?? []).slice(0, 10).forEach((r) => {
    console.log(`  ${r.country_code} fail=${r.consecutive_failures ?? 0} status=${r.check_status ?? "never"} — ${r.name}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
