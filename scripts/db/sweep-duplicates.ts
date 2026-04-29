import { loadEnv } from "../crawlers/env";
loadEnv();
import { supabaseAdmin } from "../../lib/supabase-admin";

/**
 * 활성 regulations(valid_to IS NULL)에서 동일 (ingredient_id, country_code) 가
 * 2건+ 있으면 last_verified_at 최신 1건만 남기고 나머지는 valid_to=now()로 close.
 * migration 0006 partial unique 적용 전 필수 전처리.
 */
async function main() {
  const s = supabaseAdmin();

  const all: { id: string; ingredient_id: string; country_code: string; last_verified_at: string }[] = [];
  let from = 0; const page = 1000;
  while (true) {
    const { data } = await s
      .from("regulations")
      .select("id, ingredient_id, country_code, last_verified_at")
      .is("valid_to", null)
      .range(from, from + page - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as { id: string; ingredient_id: string; country_code: string; last_verified_at: string }[]));
    if (data.length < page) break;
    from += page;
  }

  const groups = new Map<string, typeof all>();
  for (const r of all) {
    const k = `${r.ingredient_id}|${r.country_code}`;
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }

  const now = new Date().toISOString();
  let closed = 0;
  for (const [, rows] of groups) {
    if (rows.length <= 1) continue;
    rows.sort((a, b) => (a.last_verified_at < b.last_verified_at ? 1 : -1));
    // [0] 최신 유지, [1..] 닫음
    const toClose = rows.slice(1).map((r) => r.id);
    if (toClose.length === 0) continue;
    const { error } = await s.from("regulations").update({ valid_to: now }).in("id", toClose);
    if (error) {
      console.error(`close 실패 ${toClose.length}건: ${error.message}`);
      continue;
    }
    closed += toClose.length;
    console.log(`  ${rows[0].ingredient_id.slice(0, 8)}..×${rows[0].country_code} : ${rows.length}개 중 ${toClose.length}개 close`);
  }
  console.log(`완료: ${closed}건 close.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
