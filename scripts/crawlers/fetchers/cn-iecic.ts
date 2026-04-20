import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

// NMPA IECIC 2021 (已使用化妆品原料目录) + 금지/제한 원료 공고
// TODO(crawler): NMPA 사이트는 변경이 잦음. 공고 목록 페이지를 감시하고 첨부 PDF URL을 파서가 추출.
const URL = "https://www.nmpa.gov.cn/xxgk/fgwj/gzwj/gzwjhzhp/index.html";

export const cnNmpaIecic: CrawlerSource = {
  country_code: "CN",
  doc_key: "nmpa_cosmetic_regulations",
  title: "NMPA 화장품 규제 공고 목록 (IECIC 포함)",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
