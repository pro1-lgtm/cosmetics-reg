# cosmetics-reg

화장품 원료 규제 정보 검색 — 한국·중국·EU·미국·일본·ASEAN·대만·브라질·아르헨티나·캐나다 (15국).
DB: 26K 원료 · 55K 규제. 데이터 소스: 식약처 공공데이터 API 4종 + 각국 공식 법령 변경 감지.

## 아키텍처

- **정적 사이트**: Next.js 16 `output: 'export'` — `out/` 디렉토리에 정적 파일 생성.
- **클라이언트가 직접 Supabase 호출**: publishable key + RLS read 정책. 서버·API routes·middleware 없음.
- **Netlify(또는 어디든) 정적 호스팅**: bandwidth는 정적 자산만 (캐시 무한). DB 트래픽은 사용자 브라우저 ↔ Supabase 직접.
- **로컬 단독 실행 가능**: `npm run build && npm run serve` → http://localhost:3010.

## 빠른 시작

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 채우기
npm install
npm run build                       # out/ 생성
npm run serve                       # http://localhost:3010
```

개발 서버:
```bash
npm run dev    # next dev (HMR)
```

## 검증

```bash
npm run build && npm run serve &        # 정적 서버 백그라운드
E2E_BASE=http://localhost:3010 npm run e2e
npm run lighthouse http://localhost:3010
```

## 인제스트·운영 (Node 서버 환경 — `SUPABASE_SECRET_KEY` 필요)

| 명령 | 용도 |
|---|---|
| `npm run mfds:ingest` | 식약처 API 4종 → regulations 갱신 (idempotent) |
| `npm run crawl` | 15국 공식 소스 변경 감지 (regulation_sources 기반) |
| `npm run parse` | Gemini 2-모델 합의로 변경분 파싱 → regulations/quarantine |
| `npm run sources:seed` | regulation_sources 19행 upsert |
| `npm run enrich:functions` | 원료 function_category Gemini 보강 |

## 마이그레이션

`supabase/migrations/` 의 SQL 을 Supabase SQL Editor 에 순서대로 실행. 정적 모드 전환 시 `0007_public_read_for_static.sql` 적용 필수 — 4 테이블(`source_documents`, `regulation_quarantine`, `regulation_sources`, `detected_changes`)의 anon SELECT 정책.

## 배포

- Netlify: `netlify.toml` 의 `publish = "out"` + `[[headers]]`. 빌드 후 `out/` 만 업로드.
- Cloudflare Pages / GitHub Pages 등 정적 호스팅 어디서든 작동.

자세한 운영 노트: `AGENTS.md`
