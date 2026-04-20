export interface FetchResult {
  url: string;
  content: Buffer;
  contentType: string;
  extension: string;
}

export interface CrawlerSource {
  country_code: string;
  doc_key: string;
  title: string;
  source_url: string;
  fetch: () => Promise<FetchResult>;
}

export type CrawlStatus = "unchanged" | "changed" | "failed";

export interface CrawlOutcome {
  country_code: string;
  doc_key: string;
  status: CrawlStatus;
  content_hash?: string;
  content_path?: string;
  error?: string;
}
