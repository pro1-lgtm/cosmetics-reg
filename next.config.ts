import type { NextConfig } from "next";

// 보안 헤더: clickjacking / MIME 스니핑 / 과도한 referrer 누출 / 불필요 권한 방지.
// CSP는 Netlify Edge 단계에서 별도 관리 (Supabase·Gemini·Google Fonts 등 allowlist 복잡).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
