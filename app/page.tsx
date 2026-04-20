"use client";

import { useState } from "react";
import type { LookupResponse, CountryLookupResult } from "@/lib/regulations-query";
import type { LiveAnswer } from "@/lib/live-fallback";

type LiveCache = Record<string, LiveAnswer | "loading" | { error: string }>;

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveCache>({});

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    setLive({});
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "검색 실패");
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function triggerLive(ingredient: string, country: string) {
    const key = `${country}:${ingredient}`;
    setLive((p) => ({ ...p, [key]: "loading" }));
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredient, country }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "실시간 검색 실패");
      setLive((p) => ({ ...p, [key]: data as LiveAnswer }));
    } catch (err) {
      setLive((p) => ({
        ...p,
        [key]: { error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          화장품 원료 규제 검색
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          한국·중국·EU·미국·일본·ASEAN 8개국 공식 기관 데이터 기반
        </p>
      </header>

      <form onSubmit={handleSearch} className="mb-8 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="원료명 (INCI / 한글 / 중국어 / 일본어 / CAS 번호)"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || query.trim().length < 2}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading ? "검색 중..." : "검색"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {response && response.ingredient === null && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          &ldquo;{response.query}&rdquo; 에 대한 원료를 DB에서 찾지 못했습니다.
        </div>
      )}

      {response?.ingredient && (
        <>
          <IngredientHeader ingredient={response.ingredient} />
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            {response.results.map((r) => (
              <CountryCard
                key={r.country_code}
                result={r}
                ingredientName={response.ingredient!.inci_name}
                live={live[`${r.country_code}:${response.ingredient!.inci_name}`]}
                onLive={() => triggerLive(response.ingredient!.inci_name, r.country_code)}
              />
            ))}
          </section>
        </>
      )}

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800">
        본 서비스 정보는 AI가 공식 기관 자료를 자동 수집·정리한 참고 자료입니다. 최종 규제
        판단은 반드시 해당 국가 공식 문서 원문을 확인해 주세요.
      </footer>
    </main>
  );
}

function IngredientHeader({ ingredient }: { ingredient: NonNullable<LookupResponse["ingredient"]> }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-sm text-zinc-500">INCI</div>
      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {ingredient.inci_name}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-4">
        {ingredient.korean_name && (
          <>
            <dt className="text-zinc-400">한글명</dt>
            <dd>{ingredient.korean_name}</dd>
          </>
        )}
        {ingredient.cas_no && (
          <>
            <dt className="text-zinc-400">CAS</dt>
            <dd>{ingredient.cas_no}</dd>
          </>
        )}
        {ingredient.chinese_name && (
          <>
            <dt className="text-zinc-400">중국어</dt>
            <dd>{ingredient.chinese_name}</dd>
          </>
        )}
        {ingredient.japanese_name && (
          <>
            <dt className="text-zinc-400">일본어</dt>
            <dd>{ingredient.japanese_name}</dd>
          </>
        )}
      </dl>
      {ingredient.synonyms.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {ingredient.synonyms.map((s) => (
            <span
              key={s}
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

const COUNTRY_FLAG: Record<string, string> = {
  KR: "🇰🇷",
  CN: "🇨🇳",
  EU: "🇪🇺",
  US: "🇺🇸",
  JP: "🇯🇵",
  VN: "🇻🇳",
  TH: "🇹🇭",
  ID: "🇮🇩",
  MY: "🇲🇾",
  PH: "🇵🇭",
  SG: "🇸🇬",
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  banned: { label: "배합금지", className: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200" },
  restricted: {
    label: "배합한도",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  },
  allowed: {
    label: "허용",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  },
  listed: {
    label: "수록 (수출 가능)",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  },
  not_listed: {
    label: "미수록 (수출 불가)",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

function CountryCard({
  result,
  live,
  onLive,
}: {
  result: CountryLookupResult;
  ingredientName: string;
  live: LiveAnswer | "loading" | { error: string } | undefined;
  onLive: () => void;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          <span className="text-lg leading-none">{COUNTRY_FLAG[result.country_code] ?? "🏳️"}</span>
          {result.country_name_ko}
          {result.inherits_from && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-500 dark:bg-zinc-800">
              {result.inherits_from} 상속
            </span>
          )}
        </div>
        {result.source === "verified" && result.last_verified_at && (
          <span className="text-xs text-zinc-400">
            🤖 {daysAgo(result.last_verified_at)}
          </span>
        )}
      </header>

      {result.source === "verified" && (
        <div className="space-y-2 text-sm">
          {result.status && (
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[result.status]?.className ?? ""}`}
            >
              {STATUS_STYLE[result.status]?.label ?? result.status}
            </span>
          )}
          {typeof result.max_concentration === "number" && (
            <div className="text-zinc-700 dark:text-zinc-300">
              최대 배합한도:{" "}
              <span className="font-semibold">
                {result.max_concentration}
                {result.concentration_unit ?? "%"}
              </span>
            </div>
          )}
          {result.product_categories && result.product_categories.length > 0 && (
            <div className="text-xs text-zinc-500">
              적용 제품: {result.product_categories.join(", ")}
            </div>
          )}
          {result.conditions && (
            <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {result.conditions}
            </div>
          )}
          {result.source_url && (
            <a
              href={result.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              원문 출처 →
            </a>
          )}
        </div>
      )}

      {result.source === "pending" && (
        <div className="space-y-2">
          <span className="inline-block rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-950/60 dark:text-orange-200">
            검토 중
          </span>
          <p className="text-xs text-zinc-500">{humanizeReason(result.pending_reason)}</p>
          <button
            onClick={onLive}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            AI 실시간 검색 시도 →
          </button>
          <LiveResultBlock live={live} />
        </div>
      )}

      {result.source === "not_found" && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">DB에 수록되지 않음</p>
          <button
            onClick={onLive}
            className="inline-block rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            AI 실시간 검색
          </button>
          <LiveResultBlock live={live} />
        </div>
      )}
    </article>
  );
}

function LiveResultBlock({ live }: { live: LiveAnswer | "loading" | { error: string } | undefined }) {
  if (!live) return null;
  if (live === "loading") {
    return <div className="mt-2 text-xs text-zinc-500">공식 출처 검색 중...</div>;
  }
  if ("error" in live) {
    return (
      <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        {live.error}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded border border-blue-100 bg-blue-50 p-2 text-xs leading-relaxed dark:border-blue-900 dark:bg-blue-950/30">
      <p className="text-zinc-700 dark:text-zinc-300">{live.answer_text}</p>
      {live.sources.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {live.sources.slice(0, 5).map((s, i) => (
            <li key={i}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {s.title ?? s.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] text-zinc-400">{live.disclaimer}</p>
    </div>
  );
}

function daysAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400_000);
  if (days === 0) return "오늘 자동 업데이트";
  if (days === 1) return "1일 전 자동 업데이트";
  return `${days}일 전 자동 업데이트`;
}

function humanizeReason(reason?: string): string {
  if (!reason) return "자동 검증 중";
  if (reason.startsWith("model_disagreement:"))
    return "AI 모델 간 해석이 달라 검증 대기 중";
  if (reason.startsWith("one_model_only_"))
    return "한 AI 모델만 감지 — 검증 대기 중";
  if (reason.startsWith("outlier_concentration"))
    return "기존 값 대비 이상 감지 — 검증 대기 중";
  return "검증 대기";
}
