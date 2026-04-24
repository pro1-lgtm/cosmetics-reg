import { NextResponse, type NextRequest } from "next/server";

// Simple in-memory sliding window. Netlify Edge 인스턴스마다 분리되지만 가시적 남용
// (단일 IP가 초당 10+ 요청) 차단에는 유효. 분산 rate limit은 Upstash Redis 도입 시 교체.
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 120; // /api/* 에 대해 IP당 2 RPS 수준 상한
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || cur.resetAt < now) {
    const resetAt = now + WINDOW_MS;
    hits.set(ip, { count: 1, resetAt });
    return { ok: true, remaining: MAX_REQ_PER_WINDOW - 1, resetAt };
  }
  cur.count++;
  if (cur.count > MAX_REQ_PER_WINDOW) {
    return { ok: false, remaining: 0, resetAt: cur.resetAt };
  }
  return { ok: true, remaining: MAX_REQ_PER_WINDOW - cur.count, resetAt: cur.resetAt };
}

function getIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // /api/* 만 제한 대상. 정적 자산·SSR 페이지는 Netlify CDN이 처리.
  if (url.pathname.startsWith("/api/")) {
    const ip = getIp(req);
    const r = rateLimit(ip);
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", String(MAX_REQ_PER_WINDOW));
    headers.set("X-RateLimit-Remaining", String(r.remaining));
    headers.set("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
    if (!r.ok) {
      headers.set("Retry-After", String(Math.ceil((r.resetAt - Date.now()) / 1000)));
      return new NextResponse(
        JSON.stringify({ error: "rate limit exceeded" }),
        { status: 429, headers: { ...Object.fromEntries(headers), "Content-Type": "application/json" } },
      );
    }
    const res = NextResponse.next();
    headers.forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
