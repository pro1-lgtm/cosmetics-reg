<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Static export 모드 (이 프로젝트의 핵심)

이 사이트는 `output: 'export'` 정적 사이트다. Next.js의 다음 기능을 **사용하지 않는다**:
- API routes (`app/api/**`) — 모두 삭제됨. 클라이언트가 `lib/regulations-query.ts` / `lib/autocomplete-query.ts` 의 `supabaseClient()` 로 Supabase 에 직접 호출.
- Middleware (`middleware.ts`) — 삭제됨. Rate limit 은 Supabase 자체 throttling 에 위임.
- SSR / Server Components 의 데이터 fetch — 모든 페이지는 정적이거나 `"use client"`.
- `next.config` 의 `headers()`/`redirects()` — 정적 export 에서 무시됨. 보안 헤더는 `netlify.toml [[headers]]` + `public/_headers` 에 정의.

새 기능 추가 시:
1. Server Component 에서 `await fetch()` 형태로 SSR 데이터 가져오면 안 된다 — 클라이언트 컴포넌트로 만들고 `useEffect` + `supabaseClient` 사용.
2. 새 API route 를 만들지 말고, 새 lib 함수를 만들어 `supabaseClient` 로 Supabase 에서 직접 가져와라.
3. 보안 헤더 변경은 `netlify.toml` 과 `public/_headers` 두 군데 모두 갱신.
4. RLS read 정책이 없는 테이블을 client 코드에서 SELECT 하면 빈 배열만 돌아온다 — 새 마이그레이션으로 정책 추가 필요.

서버 전용 코드 (scripts/* 의 ingest, crawler, parser) 만 `lib/supabase-admin.ts` 의 `supabaseAdmin()` (service_role) 사용. **절대 `app/` 코드에서 import 하지 말 것** — 빌드 결과에 service_role key 가 노출될 수 있다.
