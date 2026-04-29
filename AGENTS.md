<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 100% 로컬 모드 (Phase 5 — 이 프로젝트의 핵심)

이 사이트는 사용자 PC 단독 구동을 목표로 하는 정적 사이트다.

## 사용 안 하는 것

- API routes (`app/api/**`) — 전부 삭제됨.
- Middleware — 삭제됨.
- SSR / Server Components 의 데이터 fetch — 모든 페이지는 정적이거나 `"use client"`.
- Supabase 클라이언트 — 검색·자동완성·sources 어디서도 호출 X.
- Netlify·Vercel 등 호스팅 종속 — 정적 호스팅이면 어디든 (사용자 PC `npm run serve` 포함).

## 데이터 흐름

```
public/data/*.json  ──fetch (브라우저 1회)──▶  lib/data-loader.ts (인메모리 Map)
                                                        │
                                                        ├──▶  lib/regulations-query.ts (lookupRegulation)
                                                        │
                                                        └──▶  lib/autocomplete-query.ts (fetchSuggestions)
```

- `lib/data-loader.ts:dataset()` 가 단일 진실 — 모든 검색 코드는 await dataset() 후 인덱스 조회.
- `dataset()` 내부 캐시 모듈 변수. 한 번 로드 후 재사용. 실패 시 cached=null 로 다음 호출에서 재시도.
- prefetch 는 첫 사용자 인터랙션 (pointerdown/keydown/focusin/scroll) 시 시작. Lighthouse 측정 윈도우 영향 없음.

## 새 기능 추가 시

1. **새 페이지 데이터 의존**: `lib/data-loader.ts` 의 인덱스를 활용. 새 인덱스 필요하면 `Dataset` 인터페이스에 필드 추가 + loadDataset() 에서 빌드.
2. **새 데이터 종류**: `scripts/export-data.ts` 에 fetchAllInPages 호출 추가 + `public/data/<name>.json` 출력 + data-loader 의 fetchJson 추가.
3. **Server Component 에서 데이터 fetch 금지**: `await fetch()` 를 server 측에서 하면 빌드 시 prerender 됨. 동적 데이터는 client 컴포넌트 + useEffect.
4. **새 API route 만들지 말 것** — `output: 'export'` 와 호환 안 됨. lib 함수 + data-loader 로.
5. **Supabase 호출 추가 금지**: 인제스트(scripts/*) 외에는 0. 새 클라이언트 데이터는 `npm run export-data` 갱신 후 정적 파일에서.
6. **보안 헤더**: `public/_headers` (Netlify·Cloudflare Pages 인식). next.config 의 `headers()` 는 정적 export 에서 무시됨.

## scripts/* (인제스트 — Supabase 사용)

`lib/supabase-admin.ts` 의 `supabaseAdmin()` (service_role) 만 사용. **app/ 코드에서 절대 import 금지** — 빌드 결과에 service_role key 가 노출됨.

향후 Phase 5b 에서 식약처 API → public/data/*.json 직접 출력으로 재구조화하면 supabase-admin.ts 도 제거 가능.

## 데이터 크기 vs Lighthouse perf

26K + 55K rows 인덱스 빌드는 첫 사용자 인터랙션 시 1초+ 메인 스레드 점유 (perf 73).
사용자 시점에서는 페이지 진입 자체는 빠름 (LCP 2.7s, FCP 0.8s). 첫 검색 약간 지연.
Web Worker 분리·인덱스 분할 등은 Phase 5c 에서 검토.
