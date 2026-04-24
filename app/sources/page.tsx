import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 소스 상태 대시보드. service_role 필요 (anon은 RLS 차단).
// 매 요청마다 최신 상태 — 캐시 안 함.

function staleHours(since: string | null): string {
  if (!since) return "never";
  const h = (Date.now() - new Date(since).getTime()) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function stalenessClass(since: string | null): string {
  if (!since) return "bg-zinc-200 text-zinc-700";
  const h = (Date.now() - new Date(since).getTime()) / 3_600_000;
  if (h < 48) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200";
  if (h < 168) return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200";
  return "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200";
}

function statusClass(status: string | null): string {
  if (status === "ok") return "bg-emerald-100 text-emerald-800";
  if (status === "changed") return "bg-sky-100 text-sky-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-zinc-100 text-zinc-600";
}

export default async function SourcesPage() {
  const s = supabaseAdmin();
  const [sourcesRes, pendingRes] = await Promise.all([
    s.from("regulation_sources").select("*").order("country_code").order("priority", { ascending: false }),
    s.from("detected_changes").select("country_code, change_type, detected_at, diff_summary").eq("review_status", "pending").order("detected_at", { ascending: false }).limit(20),
  ]);
  const sources = sourcesRes.data ?? [];
  const pending = pendingRes.data ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          소스 모니터링
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          15개국 공식 법령 변경 감지 소스 상태 · 미검수 변경 이벤트 {pending.length}건
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium">regulation_sources ({sources.length}건)</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left">국가</th>
                <th className="px-3 py-2 text-left">소스</th>
                <th className="px-3 py-2 text-left">tier</th>
                <th className="px-3 py-2 text-left">method</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-left">최근 확인</th>
                <th className="px-3 py-2 text-left">최근 변경</th>
                <th className="px-3 py-2 text-right">연속 실패</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((r) => (
                <tr key={r.id as string} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{r.country_code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{r.tier}</td>
                  <td className="px-3 py-2 text-xs">{r.detect_method}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusClass(r.check_status as string | null)}`}>
                      {String(r.check_status ?? "never")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${stalenessClass(r.last_checked_at as string | null)}`}>
                      {staleHours(r.last_checked_at as string | null)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {staleHours(r.last_changed_at as string | null)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {Number(r.consecutive_failures ?? 0) > 0 ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        {String(r.consecutive_failures)}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">미검수 변경 이벤트 (최근 20)</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500">pending 이벤트 없음 ✓</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((r, i) => (
              <li key={i} className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{r.country_code}</span>
                  <span>{r.change_type}</span>
                  <span>{new Date(r.detected_at as string).toLocaleString("ko-KR")}</span>
                </div>
                <div className="text-zinc-700 dark:text-zinc-300">{r.diff_summary ?? "(no summary)"}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Phase 2 — change-detector가 daily crawl 중 자동으로 이벤트를 생성. 처리: 서버에서 <code>npm run parse</code>
        실행 후 regulations/quarantine 업데이트 수동 승인 권장. Phase 3에서 자동 draft PR 예정.
      </footer>
    </main>
  );
}
