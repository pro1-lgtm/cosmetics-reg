import { fetchUrl } from "../base";
import type { CrawlerSource } from "../types";

const URL =
  "https://www.fda.gov/cosmetics/cosmetics-laws-regulations/prohibited-restricted-ingredients-cosmetics";

export const usFdaProhibited: CrawlerSource = {
  country_code: "US",
  doc_key: "fda_prohibited_restricted",
  title: "FDA Prohibited & Restricted Ingredients in Cosmetics",
  source_url: URL,
  async fetch() {
    const r = await fetchUrl(URL, { expectedExt: ".html" });
    return { url: r.url, content: r.content, contentType: r.contentType, extension: r.extension };
  },
};
