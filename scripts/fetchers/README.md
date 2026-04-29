# scripts/fetchers/ — 각국 1차 소스 직접 fetcher

Phase B 의 핵심. MFDS (한국 식약처) 가 제공하는 2차 정리 데이터 (`source_priority=50`)
대신 각국 정부의 **1차 raw 데이터** 를 직접 fetch → `source_priority=100` 으로 자동 우선.

## 작동 원리

각 fetcher 는 mfds/ingest.ts 패턴 그대로:
1. 외부 API/PDF/HTML 에서 raw 데이터 fetch
2. 한글 정리 + 매칭
3. `regulations.json` 의 같은 `source_document` 행만 in-place 교체 (다른 source 보존)
4. `source_priority=100` 으로 추가
5. `lib/regulations-query.ts` 가 lookup 시 자동으로 priority desc 정렬 → 1차 소스 표시

## 진행 상황 (Phase B)

| 국가 | 1차 소스 | 상태 | rows | fetcher |
|---|---|---|---|---|
| KR | MFDS 공공데이터 API | ✓ 자국 1차 | 4055 | `mfds/ingest.ts` |
| **US** | **eCFR 21 CFR 700** | **✓** | **25** | `us-ecfr.ts` |
| **CN** | **NMPA IECIC** | **✓** | **8959** | `cn-nmpa-iecic.ts` (Playwright) |
| CN | 化妆品安全技术规범 (PDF) | TODO | — | `cn-safety-spec.ts` (Playwright + PDF + Gemini) |
| EU | EUR-Lex 1223/2009 / CosIng | 차단 | — | EUR-Lex HTTP 202 봇 차단, CosIng Angular SPA — Playwright + 인내 |
| JP | MHLW 化粧品基準 (PDF) | 페이지 OK | — | `jp-mhlw.ts` (PDF 위치 + Gemini) |
| TW | TFDA Positive List (PDF) | 페이지 OK | — | `tw-tfda.ts` (sub-페이지 분석) |
| BR | ANVISA RDC 결의 | 페이지 OK | — | `br-anvisa.ts` |
| AR | ANMAT Disposiciones | 페이지 OK | — | `ar-anmat.ts` |
| CA | Health Canada Hotlist | **차단** | — | Imperva WAF 가 한국 IP 거부 (Playwright + 시스템 Chrome 도 동일) |
| ASEAN 6 | EU 상속 (현재) | — | — | 자국 1차 추가 가능 (각 사이트별) |

## 알려진 차단

| 사이트 | 증상 | 대응 |
|---|---|---|
| canada.ca / open.canada.ca | HTTP 200 + "Request Rejected" body (Imperva WAF) | VPN/proxy 또는 사용자가 직접 페이지 저장 후 우리 폴더에 |
| eur-lex.europa.eu | HTTP 202 (async render, 봇 차단) | Playwright 인내심 polling 또는 EU Open Data Portal 우회 |
| nmpa.gov.cn 메인 | HTTP 412 (Aliyun WAF) | Playwright + warmup. **하지만 NIFDC 의 IECIC API 는 별도로 작동** ✓ |

## 새 fetcher 작성 가이드

1. `scripts/fetchers/<country>-<source>.ts` 신설.
2. `us-ecfr.ts` 또는 `cn-nmpa-iecic.ts` 를 템플릿으로 복사.
3. **고정 부분**:
   - `SOURCE_DOC` 상수 (예: `"NMPA 化妆品安全技术规범 附录 1"`)
   - `country_code` ISO 코드
   - `source_priority: 100`
4. **변경 부분**:
   - 외부 API/PDF/HTML fetch 로직
   - 데이터 → 인터페이스 매핑
   - INCI 후보 → ingredient 매칭 (existing first, fallback 신규)
   - **한글 conditions 빌드** (영문 원문 보존 OK, 한글 요약 우선)
5. `package.json` 에 npm script 등록.
6. `.github/workflows/crawl.yml` 의 daily refresh 에 step 추가.

## Playwright 사용 시

- `playwright-helper.ts` 의 `launchContext()` 사용. 시스템 Chrome 우선
  (`channel: 'chrome'`) → bundled Chromium fallback.
- Windows 방화벽이 bundled Chromium 을 차단하면 시스템 Chrome 자동 사용.
- 헤드리스 — 사용자 화면에 띄움 X.
- 종료 후 `await ctx.close()` 필수 (브라우저 process leak 방지).

## 데이터 신선도

각 fetcher idempotent — 매일 cron (KST 03:17, `crawl.yml`) 실행해도 안전.
실 변경분만 commit 됨 (`git diff --cached --quiet` 체크).

## 다음 세션 우선순위

1. **JP MHLW** — 化粧品基準 PDF 위치 + 다운로드 (Gemini quota 회복 대기)
2. **TW TFDA** — sub-페이지 분석 + Positive list PDF
3. **BR/AR** — RDC/Disposiciones PDF
4. **CN 化妆品安全技术规범** — 附录 1/2 (금지) + 附录 3 (제한) PDF
5. **EU EUR-Lex** — Playwright + Annex II/III 파싱 (큰 작업)
6. **CA Hotlist** — VPN 우회 또는 사용자 협조 (한국 IP 차단)
