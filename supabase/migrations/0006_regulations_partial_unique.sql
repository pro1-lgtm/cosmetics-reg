-- Migration 0006 — regulations 활성 버전 유일성 강제 (DEFERRED)
--
-- 상태: 2026-04-24 세션에서 적용했다가 F-33(MFDS ingest vs cross-source active row
-- conflict)로 인해 drop. 재적용은 Phase 4에서 MFDS ingest가 upsert-conflict 패턴
-- (INSERT ... ON CONFLICT (ingredient_id, country_code) WHERE valid_to IS NULL
-- DO UPDATE)으로 재설계된 후.
--
-- 본 파일은 DDL 발생 이력 기록용. 다음 세션이 재적용할 땐:
--   1) scripts/mfds/ingest.ts 의 replaceMfdsRegulations 를 upsert 패턴으로 전환
--   2) scripts/parsers/upsert.ts 도 동일 패턴 (이미 F-31 수정으로 일부 개선됨)
--   3) 본 파일 실행 → partial unique 복원

-- 재도입 시 실행할 SQL:
-- create unique index if not exists uniq_regulations_active_ingredient_country
--   on regulations (ingredient_id, country_code)
--   where valid_to is null;

-- 현재는 NO-OP (drop도 migration 파일엔 넣지 않음. 운영 중 긴급 drop은 SQL Editor로 수동).
select 1;  -- placeholder
