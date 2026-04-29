# cosmetics-reg

화장품 원료 규제 정보 검색 — 한국·중국·EU·미국·일본·ASEAN·대만·브라질·아르헨티나·캐나다 (15국).
26K 원료 · 55K 규제. 데이터 소스: 식약처 공공데이터 API 4종 + 각국 공식 법령.

## 아키텍처 (Phase 5 — 100% 로컬, 서버 0)

- **검색 시점 의존 0**: Supabase·Netlify·기타 외부 서버 호출 없음. 사용자 PC 단독 구동.
- **데이터**: `public/data/*.json` (countries / ingredients / regulations / quarantine / meta)
  로 정적 번들. 사용자 브라우저는 페이지 첫 로드 시 한 번 다운로드 → 인메모리 인덱스 →
  이후 검색은 메모리 lookup (RTT 0).
- **갱신**: 브라우저의 ETag/Last-Modified 자동 비교. `meta.json` 의 `generated_at` 이
  바뀌면 데이터 파일이 변경된 것 — 정적 호스팅이 새 ETag 줌, 변경 시만 다운로드.
  변경 없으면 304 Not Modified.
- **데이터 갱신**은 운영자가 수동: `npm run export-data` (Supabase 또는 식약처 API 직접
  fetch). 결과는 `public/data/` 에 새 JSON 파일로 출력 → 다음 빌드부터 반영.
  Phase 5b 에서 식약처 API 직접 호출로 Supabase 의존 완전 제거 예정.

## 빠른 시작 (사용자 PC)

```bash
npm install
npm run export-data    # public/data/*.json 생성 (Supabase 자격증명 필요 — .env.local)
npm run build          # out/ 디렉토리에 정적 사이트 빌드
npm run serve          # http://localhost:3010
```

`public/data/` 가 이미 있다면 `export-data` 생략 가능. 데이터 갱신 안 해도 검색은 정상 작동.

개발 서버 (Next.js HMR):
```bash
npm run dev
```

## 데이터 흐름

```
운영자 PC                        사용자 PC
─────────────                    ─────────────
npm run export-data              npm run serve
   │                                 │
   ▼                                 ▼
public/data/*.json  ──git─▶  out/data/*.json
   ▲                                 │
   │                                 ▼ (브라우저 첫 로드 시 1회 fetch + 메모리 인덱스)
Supabase or 식약처 API           검색·자동완성·sources 페이지 (메모리 lookup, RTT 0)
```

## 데이터 크기 (2026-04-29 기준)

| 파일 | raw | brotli (호스팅 자동 압축 시 다운로드 크기) |
|---|---|---|
| countries.json | 1KB | 0.4KB |
| ingredients.json | 10MB | 1.3MB |
| regulations.json | 31MB | 0.5MB |
| quarantine.json | 2KB | 1KB |
| meta.json | 0.2KB | 0.2KB |
| **합계** | **41MB** | **~2MB** |

첫 로드 시 다운로드 + 인덱스 빌드 1-2초 (Lighthouse perf 73). 이후 검색은 ms 단위.
사용자가 두 번째 방문하면 브라우저 캐시 + ETag 로 데이터 변경 시만 재다운로드.

## 검증

```bash
npm run build && npm run serve &
E2E_BASE=http://localhost:3010 npm run e2e          # 25/25
npm run lighthouse http://localhost:3010             # perf 73 / a11y 95 / best 100 / seo 100
```

## 인제스트·운영 (Node 서버 환경 — Supabase 자격증명 필요)

현재 데이터 채우기는 Supabase 를 중간 저장소로 사용. Phase 5b 에서 직접 JSON 출력으로
변경 예정 — 그러면 Supabase 도 완전히 사라짐.

| 명령 | 용도 |
|---|---|
| `npm run export-data` | Supabase → public/data/*.json 일괄 export (사용자 빌드용) |
| `npm run mfds:ingest` | 식약처 API 4종 → Supabase 갱신 (idempotent) |
| `npm run crawl` | 15국 공식 소스 변경 감지 (regulation_sources 기반) |
| `npm run parse` | Gemini 2-모델 합의로 변경분 파싱 → regulations/quarantine |
| `npm run enrich:functions` | 원료 function_category Gemini 보강 |

## 호스팅 (선택 — 외부 공유 시)

`out/` 디렉토리만 배포. 정적 호스팅 어디서든 작동. `public/_headers` 가 자동으로
보안 헤더 부여 (Netlify·Cloudflare Pages 인식).

자세한 운영 노트: `AGENTS.md`
