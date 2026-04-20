import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

// 베트남 DAV — ASEAN Cosmetic Directive 준용. 델타만 관리.
// TODO(crawler): DAV 웹사이트 공고 목록 페이지 URL 확정 필요.
const URL = "https://dav.gov.vn/van-ban-phap-quy";

export const vnDavCirculars: CrawlerSource = {
  country_code: "VN",
  doc_key: "dav_cosmetic_circulars",
  title: "베트남 DAV 화장품 관련 공고",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
