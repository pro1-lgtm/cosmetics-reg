import { randomUUID } from "node:crypto";
import { REGULATION_SOURCES } from "./registry";
import { readRows, writeRows, updateMeta } from "../../lib/json-store";

// Phase 5b — Supabase 제거. registry → public/data/regulation-sources.json.
// 기존 행이 있으면 id 와 last_checked/last_changed/consecutive_failures 보존.

interface RegulationSourceRow {
  id: string;
  country_code: string;
  name: string;
  description: string | null;
  url: string;
  detect_method: string;
  content_selector: string | null;
  check_cadence_hours: number;
  tier: string;
  priority: number;
  active: boolean;
  last_checked_at: string | null;
  last_changed_at: string | null;
  content_hash: string | null;
  check_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  owner_email: string | null;
}

async function main() {
  const existing = await readRows<RegulationSourceRow>("regulation-sources");
  const existingByKey = new Map<string, RegulationSourceRow>();
  for (const e of existing) existingByKey.set(`${e.country_code}::${e.name}`, e);

  const merged: RegulationSourceRow[] = REGULATION_SOURCES.map((s) => {
    const key = `${s.country_code}::${s.name}`;
    const prev = existingByKey.get(key);
    return {
      id: prev?.id ?? randomUUID(),
      country_code: s.country_code,
      name: s.name,
      description: s.description ?? null,
      url: s.url,
      detect_method: s.detect_method,
      content_selector: s.content_selector ?? null,
      check_cadence_hours: s.check_cadence_hours ?? 24,
      tier: s.tier,
      priority: s.priority ?? 0,
      active: true,
      last_checked_at: prev?.last_checked_at ?? null,
      last_changed_at: prev?.last_changed_at ?? null,
      content_hash: prev?.content_hash ?? null,
      check_status: prev?.check_status ?? null,
      last_error: prev?.last_error ?? null,
      consecutive_failures: prev?.consecutive_failures ?? 0,
      owner_email: "tim10000@janytree.com",
    };
  });

  await writeRows("regulation-sources", merged);
  await updateMeta({ regulation_sources: merged.length });

  const byCountry: Record<string, { primary: number; secondary: number; tertiary: number }> = {};
  for (const r of merged) {
    byCountry[r.country_code] ??= { primary: 0, secondary: 0, tertiary: 0 };
    byCountry[r.country_code][r.tier as "primary" | "secondary" | "tertiary"]++;
  }

  console.log(`✓ regulation-sources.json: ${merged.length} 건`);
  console.log("국가별 (primary / secondary / tertiary):");
  Object.entries(byCountry)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([code, c]) => console.log(`  ${code}: ${c.primary} / ${c.secondary} / ${c.tertiary}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
