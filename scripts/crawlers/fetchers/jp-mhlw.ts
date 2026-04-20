import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

// 厚生労働省 화장품기준 (포지티브·네거티브 리스트)
// TODO(crawler): 화장품기준 고시 본문 URL은 개정 시 변경. 아래는 기준 목차 페이지.
const URL = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iyakuhin/i-kijun/index.html";

export const jpMhlwStandards: CrawlerSource = {
  country_code: "JP",
  doc_key: "mhlw_cosmetic_standards",
  title: "일본 MHLW 화장품기준 (포지티브·네거티브 리스트)",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
