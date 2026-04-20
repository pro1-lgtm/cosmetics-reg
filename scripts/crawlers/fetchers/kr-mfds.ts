import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

// 식약처 「화장품 안전기준에 관한 규정」 — 별표 1 (배합금지 원료) / 별표 2 (배합한도 원료)
// TODO(crawler): 고시 원문 PDF URL은 개정 시마다 공고 페이지에서 최신 링크를 가져와야 함.
// 아래는 고시 목록 페이지(상대적으로 안정적). 변경 감지 후 파서가 최신 첨부 PDF 링크 추출.
const URL = "https://www.mfds.go.kr/brd/m_210/list.do?page=1&srchFr=&srchTo=&srchWord=%ED%99%94%EC%9E%A5%ED%92%88+%EC%95%88%EC%A0%84%EA%B8%B0%EC%A4%80";

export const krMfdsSafetyStandards: CrawlerSource = {
  country_code: "KR",
  doc_key: "mfds_cosmetic_safety_standards",
  title: "식약처 화장품 안전기준에 관한 규정 (별표1·2)",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
