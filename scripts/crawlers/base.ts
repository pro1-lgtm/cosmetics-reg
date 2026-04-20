import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { supabaseAdmin } from "../../lib/supabase";
import { sha256 } from "./hash";
import type { CrawlerSource, CrawlOutcome } from "./types";

const RAW_DIR = ".crawl-raw";

export async function runCrawler(source: CrawlerSource): Promise<CrawlOutcome> {
  const now = new Date().toISOString();
  const supabase = supabaseAdmin();

  try {
    const fetched = await source.fetch();
    const hash = sha256(fetched.content);

    const { data: existing } = await supabase
      .from("source_documents")
      .select("content_hash")
      .eq("country_code", source.country_code)
      .eq("doc_key", source.doc_key)
      .maybeSingle();

    const changed = existing?.content_hash !== hash;

    if (changed) {
      await mkdir(RAW_DIR, { recursive: true });
      const rawPath = join(
        RAW_DIR,
        `${source.country_code}_${source.doc_key}${fetched.extension}`,
      );
      await writeFile(rawPath, fetched.content);

      await supabase.from("source_documents").upsert(
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
        },
        { onConflict: "country_code,doc_key" },
      );

      return {
        country_code: source.country_code,
        doc_key: source.doc_key,
        status: "changed",
        content_hash: hash,
        content_path: rawPath,
      };
    }

    await supabase
      .from("source_documents")
      .update({ last_checked_at: now, check_status: "unchanged" })
      .eq("country_code", source.country_code)
      .eq("doc_key", source.doc_key);

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
      },
      { onConflict: "country_code,doc_key" },
    );

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
  opts: { expectedExt?: string; timeoutMs?: number } = {},
): Promise<{ content: Buffer; contentType: string; extension: string; url: string }> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; cosmetics-reg-crawler/1.0; +https://github.com)",
        Accept: "*/*",
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
