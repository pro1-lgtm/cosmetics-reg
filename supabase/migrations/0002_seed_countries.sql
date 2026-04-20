-- Seed 8 priority countries + ASEAN expansion candidates
-- ASEAN countries inherit from EU (ASEAN Cosmetic Directive harmonized with EU Annexes)

insert into countries (code, name_ko, name_en, regulation_framework, inherits_from, notes) values
  ('KR', '대한민국', 'South Korea',     'MFDS_KR',      null, '식약처 화장품 안전기준에 관한 규정'),
  ('CN', '중국',     'China',            'NMPA_CN',      null, 'NMPA 화장품감독관리조례 + IECIC 2021'),
  ('EU', '유럽연합', 'European Union',   'EU_1223_2009', null, 'Regulation (EC) No 1223/2009 + CosIng'),
  ('US', '미국',     'United States',    'FDA_US',       null, 'FD&C Act + 21 CFR 700.11 prohibited/restricted'),
  ('JP', '일본',     'Japan',            'MHLW_JP',      null, '厚生労働省 화장품기준 고시'),
  ('VN', '베트남',   'Vietnam',          'ASEAN_ACD',    'EU', 'ASEAN Cosmetic Directive + 베트남 고유 규정'),
  ('TH', '태국',     'Thailand',         'ASEAN_ACD',    'EU', 'ASEAN Cosmetic Directive + 태국 고유 규정'),
  ('ID', '인도네시아','Indonesia',       'ASEAN_ACD',    'EU', 'BPOM + ASEAN ACD'),
  ('MY', '말레이시아','Malaysia',        'ASEAN_ACD',    'EU', 'NPRA + ASEAN ACD'),
  ('PH', '필리핀',   'Philippines',      'ASEAN_ACD',    'EU', 'FDA Philippines + ASEAN ACD'),
  ('SG', '싱가포르', 'Singapore',        'ASEAN_ACD',    'EU', 'HSA + ASEAN ACD')
on conflict (code) do update
  set name_ko = excluded.name_ko,
      name_en = excluded.name_en,
      regulation_framework = excluded.regulation_framework,
      inherits_from = excluded.inherits_from,
      notes = excluded.notes;
