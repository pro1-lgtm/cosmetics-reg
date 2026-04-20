-- Track which content hash has already been parsed, to avoid re-parsing unchanged docs
alter table source_documents
  add column if not exists last_parsed_hash text,
  add column if not exists last_parsed_at timestamptz;
