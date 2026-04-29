# supabase/migrations/

**역사 기록용** — Phase 5b (2026-04-29) 이후 더 이상 적용 대상 없음.

이전 단계에서 Supabase 를 데이터 저장소로 사용했을 때의 스키마 진화 기록.
현재 프로젝트는 `public/data/*.json` 정적 번들로 100% 로컬 구동 (Supabase 의존 0).

이 디렉토리는 다음 두 경우만 의미가 있음:
1. 과거 데이터 모델 변천을 검토할 때 (히스토리)
2. Phase 5b 이전 commit (≤ cd42130) 으로 git checkout 해서 작업할 때

새 마이그레이션을 추가하지 마세요. 데이터 모델 변경은 `lib/data-loader.ts` 의
`Dataset` 인터페이스와 `lib/json-store.ts` + `scripts/*` 의 read/write 로직을 수정.
