import type { CrawlerSource } from "./types";
import { usFdaProhibited } from "./fetchers/us-fda";
import { cnNmpaIecic } from "./fetchers/cn-iecic";
import { euCosing } from "./fetchers/eu-cosing";
import { jpMhlwStandards } from "./fetchers/jp-mhlw";
import { vnDavCirculars } from "./fetchers/vn-dav";
import { thFdaCirculars } from "./fetchers/th-fda";

// Note: KR data is sourced from MFDS 공공데이터 API (scripts/mfds/ingest.ts),
// not an HTML scraper. See supabase source_documents for non-HTML sources.
export const allSources: CrawlerSource[] = [
  cnNmpaIecic,
  euCosing,
  usFdaProhibited,
  jpMhlwStandards,
  vnDavCirculars,
  thFdaCirculars,
];
