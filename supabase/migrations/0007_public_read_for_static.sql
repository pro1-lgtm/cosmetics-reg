-- Migration 0007 - public anon SELECT for tables read by the (now static) frontend
--
-- Context: app moved from Next.js SSR + API routes (service_role on server) to
-- static export + Supabase-from-browser (anon publishable key). Tables that
-- previously had no anon SELECT policy now need one for the UI to work.
--
-- Tables: source_documents, regulation_quarantine, regulation_sources, detected_changes
-- These rows were already returned to anonymous users via the SSR API surface;
-- this migration formalizes that exposure under RLS.
--
-- Writes remain restricted to service_role (no public INSERT/UPDATE/DELETE policies).

create policy "source_documents_public_read" on source_documents
  for select using (true);

create policy "regulation_quarantine_public_read" on regulation_quarantine
  for select using (true);

create policy "regulation_sources_public_read" on regulation_sources
  for select using (true);

create policy "detected_changes_public_read" on detected_changes
  for select using (true);
