-- Migration 0006 — regulations 활성 버전 유일성 강제
--
-- Phase 2까지는 (ingredient_id, country_code) 에 unique 제약 없음 →
-- parsers/upsert.ts의 maybeSingle 버그로 동일 조합 여러 활성 행 누적 (F-27/F-31 관측).
-- partial unique index: valid_to IS NULL 인 행만 (ingredient_id, country_code) 유니크.
-- 새 버전 insert 전에 이전 행을 valid_to=now()로 close 해야 함 → 시간축 정상 작동 강제.
--
-- 주의: 본 migration 적용 전에 기존 중복을 sweep 해야 실패 없이 적용됨.
-- scripts/db/sweep-duplicates.ts 가 가장 최근 last_verified_at 1건만 남기고 valid_to=now() close.

create unique index if not exists uniq_regulations_active_ingredient_country
  on regulations (ingredient_id, country_code)
  where valid_to is null;
