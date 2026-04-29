import { loadEnv } from "../crawlers/env";
loadEnv();
import { supabaseAdmin } from "../../lib/supabase-admin";

// detected_changes.review_status='pending' 이 일정 수 이상 쌓여 있으면 경고.
// GitHub Actions에서 non-zero exit로 실행자(저장소 owner)에게 이메일 자동 발송.
const PENDING_THRESHOLD = 1; // 하나라도 쌓이면 알림
const OLD_PENDING_DAYS = 7; // 7일+ pending 잔존 시 긴급

async function main() {
  const s = supabaseAdmin();
  const { data: pending } = await s
    .from("detected_changes")
    .select("id, country_code, change_type, detected_at, diff_summary, review_status")
    .eq("review_status", "pending")
    .order("detected_at", { ascending: false });

  const count = pending?.length ?? 0;
  if (count < PENDING_THRESHOLD) {
    console.log(`✓ detected_changes pending 없음`);
    return;
  }

  const now = Date.now();
  const old = (pending ?? []).filter(
    (r) => now - new Date(r.detected_at as string).getTime() > OLD_PENDING_DAYS * 86_400_000,
  );

  console.log(`⚠ detected_changes pending ${count}건 (${old.length}건은 ${OLD_PENDING_DAYS}일 초과)`);
  for (const r of pending?.slice(0, 20) ?? []) {
    const age = ((now - new Date(r.detected_at as string).getTime()) / 86_400_000).toFixed(1);
    console.log(
      `  [${r.country_code}] ${r.change_type} ${age}d ago — ${String(r.diff_summary ?? "").slice(0, 80)}`,
    );
  }
  console.log(`\n처리: GitHub repo에서 "npm run parse" 실행 후 regulations/quarantine 갱신 확인.`);
  process.exit(1);
}

main().catch((e) => {
  console.error("alert script crashed:", e);
  process.exit(2);
});
