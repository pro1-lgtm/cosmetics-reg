import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { supabaseAdmin } from "../../lib/supabase";
import { sha256 } from "./hash";
import type { CrawlerSource, CrawlOutcome } from "./types";

const RAW_DIR = ".crawl-raw";

export interface CrawlerSourceWithRegistry extends CrawlerSource {
  regulation_source_id?: string | null;
}

/**
 * 문서 1개를 fetch → sha256 해시 비교 → 변경 감지 시 source_documents upsert +
 * detected_changes 이벤트 insert + 원본 파일 저장. 실패 시 regulation_sources의
 * consecutive_failures를 카운트업.
 *
 * registry 기반 호출(regulation_source_id 포함) 과 기존 allSources 호환 모두 지원.
 */
export async function runCrawler(source: CrawlerSourceWithRegistry): Promise<CrawlOutcome> {
  const now = new Date().toISOString();
  const supabase = supabaseAdmin();

  try {
    const fetched = await source.fetch();
    const hash = sha256(fetched.content);

    const { data: existing } = await supabase
      .from("source_documents")
      .select("id, content_hash")
      .eq("country_code", source.country_code)
      .eq("doc_key", source.doc_key)
      .maybeSingle();

    const prevHash = (existing?.content_hash as string | null) ?? null;
    const changed = prevHash !== hash;

    if (changed) {
      await mkdir(RAW_DIR, { recursive: true });
      const rawPath = join(
        RAW_DIR,
        `${source.country_code}_${source.doc_key}${fetched.extension}`,
      );
      await writeFile(rawPath, fetched.content);

      const { data: upserted } = await supabase
        .from("source_documents")
        .upsert(
          {
            country_code: source.country_code,
            doc_key: source.doc_key,
            title: source.title,
            source_url: source.source_url,
            content_hash: hash,
            last_checked_at: now,
            last_changed_at: now,
            check_status: "ok",
            notes: null,
            regulation_source_id: source.regulation_source_id ?? null,
          },
          { onConflict: "country_code,doc_key" },
        )
        .select("id")
        .maybeSingle();

      // 변경 감지 이벤트 — 감사 로그 겸 검수 대기열. review_status=pending.
      await supabase.from("detected_changes").insert({
        regulation_source_id: source.regulation_source_id ?? null,
        source_document_id: (upserted?.id as string | null) ?? (existing?.id as string | null) ?? null,
        country_code: source.country_code,
        detected_at: now,
        change_type: prevHash === null ? "new_document" : "content_changed",
        old_hash: prevHash,
        new_hash: hash,
        diff_summary: prevHash === null
          ? `신규 문서 수집: ${source.title}`
          : `${source.title}: content_hash ${prevHash.slice(0, 8)} → ${hash.slice(0, 8)}`,
        review_status: "pending",
      });

      // registry 통계 갱신
      if (source.regulation_source_id) {
        await supabase
          .from("regulation_sources")
          .update({
            last_checked_at: now,
            last_changed_at: now,
            content_hash: hash,
            check_status: "changed",
            last_error: null,
            consecutive_failures: 0,
          })
          .eq("id", source.regulation_source_id);
      }

      return {
        country_code: source.country_code,
        doc_key: source.doc_key,
        status: "changed",
        content_hash: hash,
        content_path: rawPath,
      };
    }

    // 변경 없음
    await supabase
      .from("source_documents")
      .update({ last_checked_at: now, check_status: "unchanged" })
      .eq("country_code", source.country_code)
      .eq("doc_key", source.doc_key);

    if (source.regulation_source_id) {
      await supabase
        .from("regulation_sources")
        .update({
          last_checked_at: now,
          check_status: "ok",
          last_error: null,
          consecutive_failures: 0,
        })
        .eq("id", source.regulation_source_id);
    }

    return {
      country_code: source.country_code,
      doc_key: source.doc_key,
      status: "unchanged",
      content_hash: hash,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("source_documents").upsert(
      {
        country_code: source.country_code,
        doc_key: source.doc_key,
        title: source.title,
        source_url: source.source_url,
        last_checked_at: now,
        check_status: "failed",
        notes: msg.slice(0, 500),
        regulation_source_id: source.regulation_source_id ?? null,
      },
      { onConflict: "country_code,doc_key" },
    );

    if (source.regulation_source_id) {
      // consecutive_failures 증가는 원자적이지 않지만 단일 워커 cron에서 충분.
      const { data: cur } = await supabase
        .from("regulation_sources")
        .select("consecutive_failures")
        .eq("id", source.regulation_source_id)
        .maybeSingle();
      const n = ((cur?.consecutive_failures as number | null) ?? 0) + 1;
      await supabase
        .from("regulation_sources")
        .update({
          last_checked_at: now,
          check_status: "failed",
          last_error: msg.slice(0, 500),
          consecutive_failures: n,
        })
        .eq("id", source.regulation_source_id);

      // 5회+ 연속 실패 시 source_unavailable 이벤트 기록
      if (n === 5 || n === 10 || n === 20) {
        await supabase.from("detected_changes").insert({
          regulation_source_id: source.regulation_source_id,
          country_code: source.country_code,
          detected_at: now,
          change_type: "source_unavailable",
          diff_summary: `${n}회 연속 실패: ${msg.slice(0, 100)}`,
          review_status: "pending",
        });
      }
    }

    return {
      country_code: source.country_code,
      doc_key: source.doc_key,
      status: "failed",
      error: msg,
    };
  }
}

export async function fetchUrl(
  url: string,
  opts: { expectedExt?: string; timeoutMs?: number; userAgent?: string } = {},
): Promise<{ content: Buffer; contentType: string; extension: string; url: string }> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        // 봇 차단 회피: 일반 브라우저 UA로 위장. NMPA 412 방지.
        "User-Agent": opts.userAgent ??
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      },
      redirect: "follow",
      signal: ac.signal,
    });
  } finally {
    clearTimeout(to);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "application/octet-stream";
  const ext =
    opts.expectedExt ??
    (ct.includes("pdf")
      ? ".pdf"
      : ct.includes("csv")
        ? ".csv"
        : ct.includes("json")
          ? ".json"
          : ct.includes("html")
            ? ".html"
            : ".bin");
  return { content: buf, contentType: ct, extension: ext, url };
}
