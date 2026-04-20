import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json([]);

  const supabase = supabaseAdmin();
  const pattern = `${q.replace(/[%_]/g, "\\$&")}%`;

  // Prefix match on korean_name or inci_name, limit 8
  const { data, error } = await supabase
    .from("ingredients")
    .select("inci_name, korean_name, cas_no")
    .or(`korean_name.ilike.${pattern},inci_name.ilike.${pattern}`)
    .order("korean_name", { ascending: true, nullsFirst: false })
    .limit(8);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
