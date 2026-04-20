import { NextResponse } from "next/server";
import { lookupRegulation } from "@/lib/regulations-query";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const query: string = body.query ?? "";
    const countries: string[] | undefined = Array.isArray(body.countries)
      ? body.countries
      : undefined;

    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return NextResponse.json(
        { error: "query must be a string of 2+ characters" },
        { status: 400 },
      );
    }

    const result = await lookupRegulation(query, countries);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
