<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 100% 로컬 모드 (Phase 5b — 이 프로젝트의 핵심)

이 사이트는 사용자 PC 단독 구동을 목표로 하는 정적 사이트다.
**Supabase·Netlify·기타 외부 데이터베이스 의존 0** — 검색 path 와 데이터 갱신 path 모두.

## 사용 안 하는 것

- API routes (`app/api/**`) — 전부 삭제됨.
- Middleware — 삭제됨.
- SSR / Server Components 의 데이터 fetch — 모든 페이지는 정적이거나 `"use client"`.
- Supabase — 클라이언트 코드도, 인제스트 스크립트도. `@supabase/supabase-js` 패키지 의존 0.
- Netlify·Vercel 종속 — 정적 호스팅이면 어디든 (사용자 PC `npm run serve` 포함).

## 데이터 흐름

```
public/data/*.json  ──fetch (브라우저 1회)──▶  lib/data-loader.ts (인메모리 Map)
                                                        │
                                                        ├──▶  lib/regulations-query.ts (lookupRegulation)
                                                        │
                                                        └──▶  lib/autocomplete-query.ts (fetchSuggestions)
```

데이터 갱신:
```
scripts/mfds/ingest.ts        식약처 API → ingredients.json + regulations.json 머지
scripts/sources/seed.ts       registry → regulation-sources.json
scripts/crawlers/{base,run}   각국 사이트 → source-status.json + detected-changes.json + .crawl-raw/
scripts/parsers/{run,upsert}  변경된 raw → Gemini 듀얼 파싱 → regulations + quarantine
scripts/enrich-functions.ts   ingredients.json 의 function_category Gemini 보강
```

scripts/* 는 모두 `lib/json-store.ts` 의 `readRows`/`writeRows`/`updateMeta` 사용.
원자적 write (tmp → rename) 로 부분 실패 시 데이터 손상 방지.

## 새 기능 추가 시

1. **새 페이지 데이터 의존**: `lib/data-loader.ts` 의 인덱스 활용. 새 인덱스가 필요하면 `Dataset` 인터페이스에 필드 추가 + `loadDataset()` 에서 빌드.
2. **새 데이터 종류**: `public/data/<name>.json` 신설. scripts 에서 `writeRows("<name>", rows)`. 클라이언트에서 fetch 필요하면 data-loader 에 추가.
3. **Server Component 에서 데이터 fetch 금지**: 동적 데이터는 client 컴포넌트 + useEffect.
4. **새 API route 만들지 말 것** — `output: 'export'` 와 호환 안 됨. lib 함수 + data-loader 로.
5. **Supabase 호출 추가 절대 금지**: 어디서도 `@supabase/supabase-js` import 금지. 의존성에서도 빠짐.
6. **보안 헤더**: `public/_headers` (Netlify·Cloudflare Pages 인식). next.config 의 `headers()` 는 정적 export 에서 무시됨.

## scripts/* (인제스트)

- 모두 `lib/json-store.ts` 의 `readRows`/`writeRows`/`updateMeta` 사용.
- 식약처 / 각국 사이트 / Gemini 호출은 인터넷 필요 (운영자 시점).
- 결과는 `public/data/*.json` 에 in-place 머지. 기존 다른 source 데이터·보강 결과·id 보존.
- 완료 후 `git add public/data/ && git commit && push` (또는 `crawl.yml` 자동).

## 데이터 크기 vs Lighthouse perf

26K + 55K rows 인덱스 빌드는 첫 사용자 인터랙션 시 1초+ 메인 스레드 점유 (perf 73).
사용자 시점에서는 페이지 진입 자체는 빠름 (LCP 2.7s, FCP 0.8s). 첫 검색 약간 지연.
Web Worker 분리·인덱스 분할 등은 추후 검토.

## supabase/migrations/

역사 기록용. Phase 5b 이후 적용 대상 아님. 데이터 모델 변경은
`lib/data-loader.ts` `Dataset` + `lib/json-store.ts` + `scripts/*` 로직에서.
