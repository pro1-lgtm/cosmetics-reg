"use client";

import { useEffect, useRef, useState } from "react";
import type { LookupResponse, CountryLookupResult } from "@/lib/regulations-query";

interface Suggestion {
  inci_name: string;
  korean_name: string | null;
  cas_no: string | null;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);

  // Autocomplete — debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`, {
          signal: ac.signal,
        });
        const data = (await res.json()) as Suggestion[];
        setSuggestions(Array.isArray(data) ? data : []);
        setActiveIdx(-1);
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setSuggestions([]);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 1) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    setShowSuggestions(false);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  function pickSuggestion(s: Suggestion) {
    const pick = s.korean_name ?? s.inci_name;
    setQuery(pick);
    setShowSuggestions(false);
    runSearch(pick);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          화장품 원료 규제 검색
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          식약처 공공데이터 API (4종) · 총 원료 26K·규제 55K건 (15개국: 한국·중국·EU·미국·일본·ASEAN·대만·브라질·아르헨티나·캐나다)
        </p>
      </header>

      <form onSubmit={handleSubmit} className="relative mb-8 flex gap-2" ref={containerRef}>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={onKeyDown}
            placeholder="원료명 (INCI / 한글 / CAS 번호 — 예: Retinol, 레티놀, 68-26-8)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            autoFocus
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {suggestions.map((s, i) => (
                <li
                  key={`${s.inci_name}-${i}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`cursor-pointer px-4 py-2 text-sm ${
                    i === activeIdx
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="text-zinc-900 dark:text-zinc-50">{s.korean_name ?? s.inci_name}</div>
                  <div className="text-xs text-zinc-500">
                    {s.inci_name}
                    {s.cas_no ? ` · CAS ${s.cas_no.split(/\s/)[0]}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || query.trim().length < 1}
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
              <CountryCard key={r.country_code} result={r} />
            ))}
          </section>
        </>
      )}

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800">
        본 서비스 정보는 식약처 공공데이터 포털의 공식 API를 자동 수집·정리한 참고 자료입니다.
        최종 규제 판단은 반드시 해당 국가 공식 문서 원문을 확인해 주세요.
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
            <dd className="whitespace-pre-wrap">{ingredient.cas_no}</dd>
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
      {ingredient.description && (
        <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
          {ingredient.description}
        </p>
      )}
      {ingredient.synonyms.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {ingredient.synonyms.slice(0, 8).map((s) => (
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
  TW: "🇹🇼",
  BR: "🇧🇷",
  AR: "🇦🇷",
  CA: "🇨🇦",
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
  unknown: {
    label: "분류 확인 필요",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

function CountryCard({ result }: { result: CountryLookupResult }) {
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
          <span className="text-xs text-zinc-400">🤖 {daysAgo(result.last_verified_at)}</span>
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
            <div className="text-xs text-zinc-500">적용 제품: {result.product_categories.join(", ")}</div>
          )}
          {result.conditions && (
            <details className="text-xs text-zinc-600 dark:text-zinc-400">
              <summary className="cursor-pointer text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                조건·비고 보기
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed">{result.conditions}</pre>
            </details>
          )}
          {result.source_document && (
            <div className="text-[11px] text-zinc-400">출처: {result.source_document}</div>
          )}
        </div>
      )}

      {result.source === "pending" && (
        <div className="space-y-1.5">
          <span className="inline-block rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-950/60 dark:text-orange-200">
            검토 중
          </span>
          <p className="text-xs text-zinc-500">{humanizeReason(result.pending_reason)}</p>
        </div>
      )}

      {result.source === "not_found" && (
        <div className="space-y-1">
          <span className="inline-block rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
            금지·제한 목록 미수록
          </span>
          <p className="text-[11px] text-zinc-500">
            사용제한·금지 데이터에 없음 — 일반 사용 가능 가능성이 높으나, 최종 확인은 공식 원문 권장
          </p>
        </div>
      )}
    </article>
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
  if (reason.startsWith("model_disagreement:")) return "AI 모델 간 해석이 달라 검증 대기 중";
  if (reason.startsWith("one_model_only_")) return "한 AI 모델만 감지 — 검증 대기 중";
  if (reason.startsWith("outlier_concentration")) return "기존 값 대비 이상 감지 — 검증 대기 중";
  return "검증 대기";
}
