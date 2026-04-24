import { loadEnv } from "./crawlers/env";
loadEnv();

import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../lib/supabase";

// Allowed function categories. Gemini must pick ONE (or null) from this set.
const CATEGORIES = [
  "보습제",
  "미백",
  "주름개선",
  "자외선차단제",
  "방부제",
  "보존제",
  "색소",
  "향료",
  "계면활성제",
  "유화제",
  "점증제",
  "항산화제",
  "각질제거",
  "세정제",
  "pH조절제",
  "킬레이트제",
  "완화제",
  "수렴제",
  "항균제",
  "기타",
] as const;

const SCHEMA = {
  type: "object",
  properties: {
    function_category: { type: "string", enum: [...CATEGORIES], nullable: true },
    function_description: { type: "string", nullable: true },
  },
  required: [],
} as const;

function prompt(inci: string, korean: string | null) {
  return `화장품 원료: INCI "${inci}"${korean ? ` (한글: ${korean})` : ""}

이 원료의 **화장품 내 주된 기능**을 JSON으로 알려주세요.

- function_category: 아래 카테고리 중 하나를 고르세요. 해당 없으면 "기타", 정말 모르면 null.
  [${CATEGORIES.join(", ")}]
- function_description: 12~30자 한국어로 이 원료의 역할·효능을 간결히 기술. 모르면 null.

**엄격한 규칙**:
- 추측 금지. 확신 없으면 두 필드 모두 null.
- 일반적·검증 가능한 사실만. 의약품 주장 금지.
- function_description은 한국어로만.`;
}

async function enrichOne(
  ai: GoogleGenAI,
  inci: string,
  korean: string | null,
): Promise<{ function_category: string | null; function_description: string | null }> {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt(inci, korean),
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
    },
  });
  const text = res.text ?? "{}";
  const parsed = JSON.parse(text);
  return {
    function_category: parsed.function_category ?? null,
    function_description: parsed.function_description ?? null,
  };
}

async function main() {
  const supabase = supabaseAdmin();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;

  // Priority: ingredients with regulations, most-regulated first.
  const { data: regCounts, error: regErr } = await supabase
    .from("regulations")
    .select("ingredient_id");
  if (regErr) throw regErr;

  const countByIng = new Map<string, number>();
  (regCounts ?? []).forEach((r) => {
    const id = r.ingredient_id as string;
    countByIng.set(id, (countByIng.get(id) ?? 0) + 1);
  });

  const prioritizedIds = Array.from(countByIng.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const { data: ingredients, error } = await supabase
    .from("ingredients")
    .select("id, inci_name, korean_name, function_category, function_description")
    .in("id", prioritizedIds);
  if (error) throw error;
  if (!ingredients) return;

  const byId = new Map<string, (typeof ingredients)[number]>();
  ingredients.forEach((i) => byId.set(i.id as string, i));

  const ordered = prioritizedIds.map((id) => byId.get(id)).filter(Boolean) as typeof ingredients;

  const targets = (force
    ? ordered
    : ordered.filter((i) => !(i.function_category as string | null))
  ).slice(0, limit);

  console.log(
    `대상 원료 ${targets.length}건 (전체 규제 연결 ${ordered.length}건 중, limit=${limit}, force=${force})`,
  );

  const MIN_INTERVAL_MS = 12_000; // 5 RPM → 12s/req
  let okCount = 0;
  let errCount = 0;

  for (let idx = 0; idx < targets.length; idx++) {
    const ing = targets[idx];
    const inci = ing.inci_name as string;
    const korean = (ing.korean_name as string | null) ?? null;
    const startedAt = Date.now();
    try {
      const enriched = await enrichOne(ai, inci, korean);
      if (enriched.function_category || enriched.function_description) {
        await supabase
          .from("ingredients")
          .update({
            function_category: enriched.function_category,
            function_description: enriched.function_description,
          })
          .eq("id", ing.id);
        okCount++;
        console.log(
          `[${idx + 1}/${targets.length}] ✓ ${inci} → ${enriched.function_category ?? "-"} | ${enriched.function_description ?? "-"}`,
        );
      } else {
        console.log(`[${idx + 1}/${targets.length}] · ${inci} → (no data, skipped)`);
      }
    } catch (e) {
      errCount++;
      console.error(
        `[${idx + 1}/${targets.length}] ✗ ${inci}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, MIN_INTERVAL_MS - elapsed);
    if (idx < targets.length - 1 && wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  console.log(`완료: 성공 ${okCount} / 실패 ${errCount} / 대상 ${targets.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
