import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// 정부 사이트 (NMPA / canada.ca / EUR-Lex / MHLW 등) 가 curl 직접 호출을 봇 차단 (412/202/connection reset).
// Playwright headless Chromium 으로 실 브라우저 컨텍스트 시뮬레이션해 우회.
//
// 사용 패턴:
//   const ctx = await launchContext();
//   try {
//     const data = await ctx.fetchJson(url, { referer });
//     // 또는: const html = await ctx.fetchHtml(url);
//   } finally { await ctx.close(); }

export interface BrowserCtx {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  fetchJson: <T = unknown>(url: string, opts?: { referer?: string }) => Promise<T>;
  fetchHtml: (url: string, opts?: { waitFor?: string; timeoutMs?: number }) => Promise<string>;
  close: () => Promise<void>;
}

export async function launchContext(opts: {
  baseUrl?: string;
  acceptLang?: string;
  warmupUrl?: string;       // 세션 cookie 받을 페이지 (옵션)
} = {}): Promise<BrowserCtx> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: opts.acceptLang === "zh-CN" ? "zh-CN" : "ko-KR",
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": opts.acceptLang ?? "ko-KR,ko;q=0.9,en;q=0.7",
    },
  });
  const page = await context.newPage();

  if (opts.warmupUrl) {
    await page.goto(opts.warmupUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // session cookie / WAF challenge 통과 대기
    await page.waitForTimeout(800);
  }

  return {
    browser,
    context,
    page,
    async fetchJson<T = unknown>(url: string, fetchOpts?: { referer?: string }): Promise<T> {
      const res = await context.request.get(url, {
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          ...(fetchOpts?.referer ? { Referer: fetchOpts.referer } : {}),
        },
        timeout: 30_000,
      });
      if (!res.ok()) throw new Error(`HTTP ${res.status()} for ${url}`);
      return await res.json() as T;
    },
    async fetchHtml(url: string, htmlOpts?: { waitFor?: string; timeoutMs?: number }): Promise<string> {
      await page.goto(url, { waitUntil: "networkidle", timeout: htmlOpts?.timeoutMs ?? 30_000 });
      if (htmlOpts?.waitFor) await page.waitForSelector(htmlOpts.waitFor, { timeout: 15_000 });
      return await page.content();
    },
    async close() {
      try { await context.close(); } catch {}
      try { await browser.close(); } catch {}
    },
  };
}
