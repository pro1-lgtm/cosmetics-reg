import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

// 태국 FDA — ASEAN Cosmetic Directive 준용. 델타만 관리.
// TODO(crawler): Thai FDA Cosmetic Control Division 공지 URL 확정 필요.
const URL = "https://www.fda.moph.go.th/Cosmetic";

export const thFdaCirculars: CrawlerSource = {
  country_code: "TH",
  doc_key: "thai_fda_cosmetic_notices",
  title: "태국 FDA 화장품 공고",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
