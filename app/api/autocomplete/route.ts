import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Sanitize user input: remove chars that could corrupt a PostgREST or() filter string
// (commas, parens, backslashes) or become unintended ILIKE wildcards (%, _).
function sanitize(s: string): string {
  return s.replace(/[,()%_\\"]/g, " ").trim();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("q") ?? "").trim();
  if (raw.length > 128) return NextResponse.json([]);
  const safe = sanitize(raw);
  if (safe.length < 1) return NextResponse.json([]);

  const supabase = supabaseAdmin();
  const pattern = `${safe}%`;

  // Run prefix matches in parallel on both name fields, then merge + dedupe.
  // (Avoids or() filter string entirely — no injection surface.)
  const [kr, eng] = await Promise.all([
    supabase
      .from("ingredients")
      .select("inci_name, korean_name, cas_no")
      .ilike("korean_name", pattern)
      .order("korean_name", { ascending: true })
      .limit(8),
    supabase
      .from("ingredients")
      .select("inci_name, korean_name, cas_no")
      .ilike("inci_name", pattern)
      .order("inci_name", { ascending: true })
      .limit(8),
  ]);
  if (kr.error) return NextResponse.json({ error: kr.error.message }, { status: 500 });
  if (eng.error) return NextResponse.json({ error: eng.error.message }, { status: 500 });

  const seen = new Set<string>();
  const merged: Array<{ inci_name: string; korean_name: string | null; cas_no: string | null }> = [];
  for (const row of [...(kr.data ?? []), ...(eng.data ?? [])]) {
    if (seen.has(row.inci_name)) continue;
    seen.add(row.inci_name);
    merged.push(row);
    if (merged.length >= 8) break;
  }
  return NextResponse.json(merged);
}
