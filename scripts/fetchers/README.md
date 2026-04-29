# scripts/fetchers/ — 각국 1차 소스 직접 fetcher

Phase B 의 핵심. MFDS (한국 식약처) 가 제공하는 2차 정리 데이터 (`source_priority=50`)
대신 각국 정부의 **1차 raw 데이터** 를 직접 fetch → `source_priority=100` 으로 자동 우선.

## 작동 원리

각 fetcher 는 mfds/ingest.ts 패턴 그대로:
1. 외부 API/PDF/HTML 에서 raw 데이터 fetch
2. 한글로 정리 + 매칭
3. `regulations.json` 의 같은 source_document 행만 in-place 교체 (다른 source 보존)
4. `source_priority=100` 으로 추가
5. `lib/regulations-query.ts` 가 lookup 시 자동으로 priority desc 정렬 → 1차 소스 표시

## 진행 상황

| 국가 | 1차 소스 | 상태 | fetcher |
|---|---|---|---|
| US | eCFR API (21 CFR 700) | **완료** ✓ | `us-ecfr.ts` (25 rows) |
| KR | MFDS 공공데이터 API | 자국 = 1차 (이미 있음) | `mfds/ingest.ts` (priority 100) |
| EU | CosIng / EUR-Lex 1223/2009 부속서 | 미작성 | TODO `eu-cosing.ts` |
| CN | NMPA IECIC + 化妆品安全技术规범 | 미작성 (Playwright 필요) | TODO `cn-nmpa.ts` |
| JP | MHLW 化粧品基準 PDF | 미작성 | TODO `jp-mhlw.ts` |
| TW | TFDA Positive List | 미작성 | TODO `tw-tfda.ts` |
| BR | ANVISA 결의 (Resolução RDC) | 미작성 | TODO `br-anvisa.ts` |
| AR | ANMAT Disposiciones | 미작성 | TODO `ar-anmat.ts` |
| CA | Health Canada Cosmetic Ingredient Hotlist | 미작성 | TODO `ca-hotlist.ts` |
| ASEAN 6 | EU 상속 (현재 처럼) — 자국 1차 추가 가능 | 차후 | TODO 각 국가별 |

## 새 fetcher 작성 가이드

1. `scripts/fetchers/<country>-<source>.ts` 신설.
2. `us-ecfr.ts` 를 템플릿으로 복사.
3. **고정 부분**:
   - `SOURCE_DOC` 상수 (예: `"EU CosIng"`)
   - `SOURCE_URL` 상수
   - `country_code` 한 자리 ISO 코드
   - `source_priority: 100`
4. **변경 부분**:
   - 외부 API/PDF/HTML fetch 로직
   - 데이터 → 인터페이스 매핑
   - INCI 후보 → ingredient 매칭 (existing first, fallback 신규)
   - 한글 conditions 빌드 (영문 원문 보존 OK, 한글 요약 우선)
5. `package.json` 에 npm script 등록 (예: `"eu:ingest"`)
6. `.github/workflows/crawl.yml` 의 daily refresh 에 step 추가:
   ```yaml
   - name: Refresh EU CosIng
     run: npm run eu:ingest
     continue-on-error: true
   ```

## 사이트별 알려진 제약

- **NMPA (CN)**: nmpa.gov.cn 이 Aliyun WAF (HTTP 412) 봇 차단. IECIC API
  (`hzpsys.nifdc.org.cn/hzpGS/queryYsyhzpylmlA`) 도 curl 직접 시 body `{code:500}`.
  → Playwright 헤드리스 Chrome 으로 우회 필요. `playwright` 가 이미 devDependency.
- **EU CosIng**: Angular SPA, main bundle 안에 API endpoint 있음. Playwright 또는
  EUR-Lex Cosmetic Regulation 1223/2009 consolidated text (XML/HTML) 직접 파싱 가능.
- **MHLW (JP)**: 페이지 정적 fetch 가능, but PDF 본문은 Gemini 파싱 필요 (quota 의존).
- **eCFR (US)**: 정형 XML, 일일 issue date 변경 — `/api/versioner/v1/titles` 로
  최신 date 조회 후 fetch. 한국 IP 제한 없음.

## 데이터 신선도

각 fetcher 는 idempotent — 매일 cron 실행해도 안전. 실 변경분만 commit 됨
(GitHub Actions `crawl.yml` 의 `git diff --cached --quiet` 체크).
