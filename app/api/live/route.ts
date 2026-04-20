import { NextResponse } from "next/server";
import { liveRegulationLookup } from "@/lib/live-fallback";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ingredient: string = body.ingredient ?? "";
    const country: string = body.country ?? "";

    if (!ingredient || !country) {
      return NextResponse.json(
        { error: "ingredient and country are required" },
        { status: 400 },
      );
    }

    const answer = await liveRegulationLookup(ingredient, country);
    return NextResponse.json(answer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
