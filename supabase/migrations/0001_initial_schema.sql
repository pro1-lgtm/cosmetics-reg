-- Cosmetics Regulation Search — initial schema
-- Source of truth: structured regulatory data per (ingredient × country)

create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- ============================================================
-- Countries
-- ============================================================
create table countries (
  code text primary key,
  name_ko text not null,
  name_en text not null,
  regulation_framework text,
  inherits_from text references countries(code),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Ingredients (canonical entity)
-- ============================================================
create table ingredients (
  id uuid primary key default uuid_generate_v4(),
  inci_name text not null unique,
  korean_name text,
  chinese_name text,
  japanese_name text,
  cas_no text,
  ec_no text,
  synonyms text[] not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ingredients_inci_lower on ingredients (lower(inci_name));
create index idx_ingredients_korean on ingredients (korean_name);
create index idx_ingredients_cas on ingredients (cas_no);
create index idx_ingredients_synonyms_gin on ingredients using gin (synonyms);

-- ============================================================
-- Regulations (per ingredient × country; multiple rows per country
-- allowed when product categories have different limits)
-- ============================================================
create type regulation_status as enum (
  'banned',       -- 배합금지
  'restricted',   -- 배합한도 있음
  'allowed',      -- 일반 사용 허용
  'listed',       -- positive list 수록 (예: IECIC)
  'not_listed',   -- positive list 미수록 (수출 불가 근거)
  'unknown'
);

create table regulations (
  id uuid primary key default uuid_generate_v4(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  country_code text not null references countries(code),
  status regulation_status not null,
  max_concentration numeric,
  concentration_unit text default '%',
  product_categories text[] not null default '{}',
  conditions text,
  inherits_from_country text references countries(code),
  override_note text,
  source_url text,
  source_document text,
  source_page int,
  last_verified_at timestamptz not null default now(),
  auto_verified boolean not null default true,
  confidence_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_regulations_ingredient on regulations (ingredient_id);
create index idx_regulations_country on regulations (country_code);
create index idx_regulations_status on regulations (status);
create index idx_regulations_ingredient_country on regulations (ingredient_id, country_code);

-- ============================================================
-- Source documents (hash-based change detection targets)
-- ============================================================
create table source_documents (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null references countries(code),
  doc_key text not null,
  title text not null,
  source_url text not null,
  content_hash text,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  check_status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, doc_key)
);

create index idx_source_docs_country on source_documents (country_code);

-- ============================================================
-- Quarantine queue (low-confidence or model-disagreement rows)
-- ============================================================
create table regulation_quarantine (
  id uuid primary key default uuid_generate_v4(),
  ingredient_name_raw text,
  country_code text references countries(code),
  proposed_data jsonb not null,
  confidence_score numeric,
  flash_result jsonb,
  pro_result jsonb,
  rejection_reason text,
  source_document_id uuid references source_documents(id),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_quarantine_status on regulation_quarantine (status);
create index idx_quarantine_country on regulation_quarantine (country_code);

-- ============================================================
-- Crawl runs (for death detection / monitoring)
-- ============================================================
create table crawl_runs (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null references countries(code),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text,
  docs_checked int not null default 0,
  docs_changed int not null default 0,
  regulations_updated int not null default 0,
  quarantined int not null default 0,
  error_message text,
  raw_log text
);

create index idx_crawl_runs_country_started on crawl_runs (country_code, started_at desc);

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_countries_updated_at before update on countries
  for each row execute function set_updated_at();
create trigger trg_ingredients_updated_at before update on ingredients
  for each row execute function set_updated_at();
create trigger trg_regulations_updated_at before update on regulations
  for each row execute function set_updated_at();
create trigger trg_source_documents_updated_at before update on source_documents
  for each row execute function set_updated_at();
create trigger trg_regulation_quarantine_updated_at before update on regulation_quarantine
  for each row execute function set_updated_at();

-- ============================================================
-- RLS: public read for ingredients/regulations/countries,
-- writes via service_role only (crawler/parser jobs)
-- ============================================================
alter table countries enable row level security;
alter table ingredients enable row level security;
alter table regulations enable row level security;
alter table source_documents enable row level security;
alter table regulation_quarantine enable row level security;
alter table crawl_runs enable row level security;

create policy "countries_public_read" on countries for select using (true);
create policy "ingredients_public_read" on ingredients for select using (true);
create policy "regulations_public_read" on regulations for select using (true);
-- source_documents, quarantine, crawl_runs: no public read policy → service_role only
