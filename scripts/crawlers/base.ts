import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sha256 } from "./hash";
import type { CrawlOutcome } from "./types";
import { readRows, writeRows } from "../../lib/json-store";

// Phase 5b — Supabase 제거. JSON 기반 변경 감지.
// source-status.json 가 source_documents 대응, detected-changes.json 가 audit log,
// regulation-sources.json 의 last_checked/consecutive_failures 갱신.

const RAW_DIR = ".crawl-raw";

interface SourceStatusRow {
  country_code: string;
  doc_key: string;
  title: string;
  source_url: string;
  content_hash: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  check_status: string | null;
  notes: string | null;
  regulation_source_id: string | null;
}

interface DetectedChangeRow {
  id: string;
  regulation_source_id: string | null;
  country_code: string;
  detected_at: string;
  change_type: string;
  old_hash: string | null;
  new_hash: string | null;
  diff_summary: string | null;
  review_status: "pending" | "approved" | "rejected" | "promoted";
}

interface RegulationSourceRow {
  id: string;
  country_code: string;
  name: string;
  url: string;
  detect_method: string;
  active: boolean;
  last_checked_at: string | null;
  last_changed_at: string | null;
  content_hash: string | null;
  check_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  [k: string]: unknown;
}

export interface CrawlerSourceWithRegistry {
  country_code: string;
  doc_key: string;
  title: string;
  source_url: string;
  regulation_source_id: string | null;
  fetch: () => Promise<{ url: string; content: Buffer; contentType: string; extension: string }>;
}

async function updateRegSource(
  reg_id: string,
  patch: Partial<RegulationSourceRow>,
): Promise<void> {
  const all = await readRows<RegulationSourceRow>("regulation-sources");
  const idx = all.findIndex((r) => r.id === reg_id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch };
  await writeRows("regulation-sources", all);
}

async function upsertSourceStatus(row: SourceStatusRow): Promise<void> {
  const all = await readRows<SourceStatusRow>("source-status");
  const idx = all.findIndex((r) => r.country_code === row.country_code && r.doc_key === row.doc_key);
  if (idx >= 0) all[idx] = { ...all[idx], ...row };
  else all.push(row);
  await writeRows("source-status", all);
}

async function appendDetectedChange(row: DetectedChangeRow): Promise<void> {
  const all = await readRows<DetectedChangeRow>("detected-changes");
  all.push(row);
  await writeRows("detected-changes", all);
}

export async function runCrawler(source: CrawlerSourceWithRegistry): Promise<CrawlOutcome> {
  const now = new Date().toISOString();

  try {
    const fetched = await source.fetch();
    const hash = sha256(fetched.content);

    const allStatus = await readRows<SourceStatusRow>("source-status");
    const existing = allStatus.find(
      (r) => r.country_code === source.country_code && r.doc_key === source.doc_key,
    );
    const prevHash = existing?.content_hash ?? null;
    const changed = prevHash !== hash;

    if (changed) {
      await mkdir(RAW_DIR, { recursive: true });
      const rawPath = join(RAW_DIR, `${source.country_code}_${source.doc_key}${fetched.extension}`);
      await writeFile(rawPath, fetched.content);

      await upsertSourceStatus({
        country_code: source.country_code,
        doc_key: source.doc_key,
        title: source.title,
        source_url: source.source_url,
        content_hash: hash,
        last_checked_at: now,
        last_changed_at: now,
        check_status: "ok",
        notes: null,
        regulation_source_id: source.regulation_source_id,
      });

      await appendDetectedChange({
        id: randomUUID(),
        regulation_source_id: source.regulation_source_id,
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

      if (source.regulation_source_id) {
        await updateRegSource(source.regulation_source_id, {
          last_checked_at: now,
          last_changed_at: now,
          content_hash: hash,
          check_status: "changed",
          last_error: null,
          consecutive_failures: 0,
        });
      }

      return { country_code: source.country_code, doc_key: source.doc_key, status: "changed", content_hash: hash, content_path: rawPath };
    }

    await upsertSourceStatus({
      country_code: source.country_code,
      doc_key: source.doc_key,
      title: source.title,
      source_url: source.source_url,
      content_hash: hash,
      last_checked_at: now,
      last_changed_at: existing?.last_changed_at ?? null,
      check_status: "unchanged",
      notes: null,
      regulation_source_id: source.regulation_source_id,
    });

    if (source.regulation_source_id) {
      await updateRegSource(source.regulation_source_id, {
        last_checked_at: now,
        check_status: "ok",
        last_error: null,
        consecutive_failures: 0,
      });
    }

    return { country_code: source.country_code, doc_key: source.doc_key, status: "unchanged", content_hash: hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    await upsertSourceStatus({
      country_code: source.country_code,
      doc_key: source.doc_key,
      title: source.title,
      source_url: source.source_url,
      content_hash: null,
      last_checked_at: now,
      last_changed_at: null,
      check_status: "failed",
      notes: msg.slice(0, 500),
      regulation_source_id: source.regulation_source_id,
    });

    if (source.regulation_source_id) {
      const all = await readRows<RegulationSourceRow>("regulation-sources");
      const cur = all.find((r) => r.id === source.regulation_source_id);
      const n = (cur?.consecutive_failures ?? 0) + 1;
      await updateRegSource(source.regulation_source_id, {
        last_checked_at: now,
        check_status: "failed",
        last_error: msg.slice(0, 500),
        consecutive_failures: n,
      });

      if (n === 5 || n === 10 || n === 20) {
        await appendDetectedChange({
          id: randomUUID(),
          regulation_source_id: source.regulation_source_id,
          country_code: source.country_code,
          detected_at: now,
          change_type: "source_unavailable",
          old_hash: null,
          new_hash: null,
          diff_summary: `${n}회 연속 실패: ${msg.slice(0, 100)}`,
          review_status: "pending",
        });
      }
    }

    return { country_code: source.country_code, doc_key: source.doc_key, status: "failed", error: msg };
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
  const ext = opts.expectedExt ??
    (ct.includes("pdf") ? ".pdf"
      : ct.includes("csv") ? ".csv"
      : ct.includes("json") ? ".json"
      : ct.includes("html") ? ".html"
      : ".bin");
  return { content: buf, contentType: ct, extension: ext, url };
}
