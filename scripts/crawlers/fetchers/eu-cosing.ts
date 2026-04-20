import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

// EU CosIng — 화장품 성분 DB. Annex II~VI(금지/제한/보존제/착색제/자외선차단제) 다운로드 가능.
// TODO(crawler): CosIng CSV 정확한 URL은 EU 측에서 주기적으로 변경됨 — 실제 최신 URL로 교체 필요.
// 대안: Eur-Lex Regulation (EC) 1223/2009 consolidated XML(https://eur-lex.europa.eu/) 감시.
const URL =
  "https://ec.europa.eu/growth/tools-databases/cosing/index.cfm?fuseaction=search.simple";

export const euCosing: CrawlerSource = {
  country_code: "EU",
  doc_key: "cosing_annexes",
  title: "EU CosIng — Annex II-VI consolidated",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
