-- 국가별 규제 체계 유형 (positive list vs negative list vs hybrid)
-- - negative_list: 금지·제한 원료 외에는 일반 허용 (KR, US)
-- - positive_list: 등록된 원료만 사용 가능 (CN IECIC, TW)
-- - hybrid: 일반 원료는 허용이나 특정 카테고리(보존제·색소·자외선차단제 등)는 positive list (EU, JP, ASEAN)
alter table countries
  add column if not exists regulation_type text not null default 'negative_list';

update countries set regulation_type = 'positive_list' where code in ('CN', 'TW');
update countries set regulation_type = 'hybrid'
  where code in ('EU', 'JP', 'VN', 'TH', 'ID', 'MY', 'PH', 'SG');
-- KR, US, BR, AR, CA는 기본값 'negative_list' 유지

-- 원료 기능/효능 정보 (Gemini 등으로 점진 보강)
alter table ingredients
  add column if not exists function_category text,
  add column if not exists function_description text;

create index if not exists idx_ingredients_function_category
  on ingredients (function_category);
