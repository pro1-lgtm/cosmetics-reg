import type { NextConfig } from "next";

// Static export — Netlify 정적 호스팅 또는 `npx serve out`으로 로컬에서 단독 실행 가능.
// API routes / middleware / SSR 페이지 사용 안 함. 모든 데이터는 클라이언트가
// Supabase publishable key + RLS로 직접 조회.
//
// 보안 헤더는 정적 export에서 next.config.headers()가 무시되므로 호스팅 측
// (Netlify의 [[headers]] / public/_headers)에서 적용한다.
const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
