-- Migration 0005 - change detection registry + time-axis versioning
--
-- Goal: (1) manage all official primary sources via DB registry,
-- (2) log change-detection events for audit, (3) time-axis (valid_from/valid_to) +
-- source_version for regulations, (4) structurally distinguish positive/negative
-- list entries (inclusion_side) in addition to status.
--
-- Pipeline:
--   regulation_sources (surveillance policy)
--     -> source_documents (downloaded snapshot, existing table)
--         -> detected_changes (hash/etag diff events, review queue)
--             -> (human approval) -> regulations row (valid_from=now(),
--                                    previous version gets valid_to=now())
--
-- regulation_quarantine (existing) is a different queue: it captures
-- Gemini model disagreements on parse confidence, not regulatory change signals.

create table if not exists regulation_sources (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null references countries(code),
  name text not null,
  description text,
  url text not null,
  detect_method text not null check (detect_method in ('head','hash','rss','api')),
  content_selector text,
  check_cadence_hours int not null default 24 check (check_cadence_hours > 0),
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_etag text,
  last_modified_header text,
  content_hash text,
  check_status text check (check_status in ('ok','changed','failed','never')),
  last_error text,
  consecutive_failures int not null default 0,
  owner_email text,
  priority int not null default 0,
  active boolean not null default true,
  tier text not null default 'secondary' check (tier in ('primary','secondary','tertiary')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, name)
);

create index if not exists idx_reg_sources_active on regulation_sources (active, last_checked_at nulls first);
create index if not exists idx_reg_sources_country on regulation_sources (country_code);

create table if not exists detected_changes (
  id uuid primary key default uuid_generate_v4(),
  regulation_source_id uuid references regulation_sources(id) on delete set null,
  source_document_id uuid references source_documents(id) on delete set null,
  country_code text not null references countries(code),
  detected_at timestamptz not null default now(),
  change_type text not null check (change_type in ('content_changed','new_document','document_removed','source_unavailable','metadata_changed')),
  old_hash text,
  new_hash text,
  diff_summary text,
  diff_payload jsonb,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','promoted','superseded')),
  reviewed_by text,
  reviewed_at timestamptz,
  pr_url text,
  promotion_run_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_detected_changes_status on detected_changes (review_status, detected_at desc);
create index if not exists idx_detected_changes_source on detected_changes (regulation_source_id);
create index if not exists idx_detected_changes_country on detected_changes (country_code, detected_at desc);

alter table source_documents
  add column if not exists regulation_source_id uuid references regulation_sources(id),
  add column if not exists etag text,
  add column if not exists last_modified_header text,
  add column if not exists detect_method text not null default 'hash' check (detect_method in ('head','hash','rss','api'));

create index if not exists idx_source_docs_regulation_source on source_documents (regulation_source_id);

alter table regulations
  add column if not exists valid_from timestamptz not null default now(),
  add column if not exists valid_to timestamptz,
  add column if not exists source_version text,
  add column if not exists source_document_id uuid references source_documents(id),
  add column if not exists inclusion_side text check (inclusion_side in ('positive','negative')),
  add column if not exists annex_code text,
  add column if not exists detected_change_id uuid references detected_changes(id);

create index if not exists idx_regulations_active on regulations (country_code, ingredient_id, valid_from desc) where valid_to is null;
create index if not exists idx_regulations_window on regulations (ingredient_id, country_code, valid_from, valid_to);
create index if not exists idx_regulations_inclusion on regulations (country_code, inclusion_side) where inclusion_side is not null;

create or replace view regulations_active as
select * from regulations
where valid_from <= now() and (valid_to is null or valid_to > now());

alter table regulation_sources enable row level security;
alter table detected_changes enable row level security;

drop trigger if exists trg_regulation_sources_updated_at on regulation_sources;
create trigger trg_regulation_sources_updated_at before update on regulation_sources
  for each row execute function set_updated_at();
