import { loadEnv } from "../crawlers/env";
loadEnv();

import { existsSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "../../lib/supabase";
import { extractWithModel } from "./extractor";
import { consensusCheck } from "./consensus";
import { applyOutcomes } from "./upsert";

const RAW_DIR = ".crawl-raw";
// 무료 티어 호환: Flash + Flash-lite 듀얼 모델. Pro는 유료 필요.
const PRIMARY_MODEL = "gemini-2.5-flash";
const SECONDARY_MODEL = "gemini-2.5-flash-lite";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const filter = args.find((a) => !a.startsWith("--"))?.toUpperCase();
  const supabase = supabaseAdmin();

  let query = supabase
    .from("source_documents")
    .select("*")
    .in("check_status", ["ok", "unchanged"])
    .not("content_hash", "is", null);
  if (filter) query = query.eq("country_code", filter);
  const { data: docs, error } = await query;
  if (error) throw error;
  if (!docs || docs.length === 0) {
    console.log("파싱할 문서가 없습니다 (check_status='ok' 인 source_documents 없음).");
    return;
  }

  for (const doc of docs) {
    if (!force && doc.last_parsed_hash && doc.last_parsed_hash === doc.content_hash) {
      console.log(`⊘ [${doc.country_code}] ${doc.doc_key} — already parsed (hash unchanged, use --force to reparse)`);
      continue;
    }

    // Find raw file — extension is inferred from the crawler step
    const base = `${doc.country_code}_${doc.doc_key}`;
    const candidates = [".html", ".pdf", ".csv", ".json", ".bin"].map((ext) =>
      join(RAW_DIR, `${base}${ext}`),
    );
    const filePath = candidates.find((p) => existsSync(p));
    if (!filePath) {
      console.log(`⊘ [${doc.country_code}] ${doc.doc_key} — no raw file in ${RAW_DIR}/`);
      continue;
    }

    console.log(`▶ [${doc.country_code}] ${doc.doc_key} (${filePath})`);
    try {
      const [primaryResults, secondaryResults] = await Promise.all([
        extractWithModel({
          model: PRIMARY_MODEL,
          filePath,
          country: doc.country_code,
          title: doc.title,
          url: doc.source_url,
        }),
        extractWithModel({
          model: SECONDARY_MODEL,
          filePath,
          country: doc.country_code,
          title: doc.title,
          url: doc.source_url,
        }),
      ]);

      console.log(
        `  ${PRIMARY_MODEL}: ${primaryResults.length}, ${SECONDARY_MODEL}: ${secondaryResults.length}`,
      );

      const outcomes = consensusCheck(primaryResults, secondaryResults);
      const stats = await applyOutcomes(
        {
          supabase,
          country_code: doc.country_code,
          source_url: doc.source_url,
          source_document: doc.title,
          source_document_id: doc.id,
        },
        outcomes,
      );

      console.log(`  → ${JSON.stringify(stats)}`);

      await supabase
        .from("source_documents")
        .update({
          last_parsed_hash: doc.content_hash,
          last_parsed_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ parse failed: ${msg}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
