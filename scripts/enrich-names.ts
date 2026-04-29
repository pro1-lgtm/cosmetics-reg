import { loadEnv } from "./crawlers/env";
loadEnv();

import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../lib/supabase-admin";

const SCHEMA = {
  type: "object",
  properties: {
    korean_name: { type: "string", nullable: true },
    chinese_name: { type: "string", nullable: true },
    japanese_name: { type: "string", nullable: true },
    cas_no: { type: "string", nullable: true },
    synonyms: { type: "array", items: { type: "string" } },
  },
  required: ["synonyms"],
} as const;

function prompt(inci: string) {
  return `
화장품 원료의 표준 INCI명: "${inci}"

이 원료의 **공식·표준 현지 명칭**을 알려주세요.

- korean_name: 식약처 화장품 성분 공정서 표준 한글명. 확신 없으면 null.
- chinese_name: 중국 NMPA IECIC 또는 GB 표준 중국어명. 확신 없으면 null.
- japanese_name: 厚生労働省 화장품기준 일본어명. 확신 없으면 null.
- cas_no: CAS 등록번호. 확신 없으면 null.
- synonyms: 이 원료의 대체 영문명·상품명·약어 목록(배열, 없으면 빈 배열).

**엄격한 규칙**: 정확하지 않은 이름을 만들어내지 말 것. 불확실한 필드는 null 로 둘 것.
`;
}

async function enrichOne(
  ai: GoogleGenAI,
  inci: string,
): Promise<{
  korean_name: string | null;
  chinese_name: string | null;
  japanese_name: string | null;
  cas_no: string | null;
  synonyms: string[];
}> {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt(inci),
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
    },
  });
  const text = res.text ?? "{}";
  const parsed = JSON.parse(text);
  return {
    korean_name: parsed.korean_name ?? null,
    chinese_name: parsed.chinese_name ?? null,
    japanese_name: parsed.japanese_name ?? null,
    cas_no: parsed.cas_no ?? null,
    synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms : [],
  };
}

async function main() {
  const supabase = supabaseAdmin();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const force = process.argv.includes("--force");

  const { data: ingredients, error } = await supabase
    .from("ingredients")
    .select("id, inci_name, korean_name, chinese_name, japanese_name, cas_no, synonyms");
  if (error) throw error;
  if (!ingredients) return;

  const targets = force
    ? ingredients
    : ingredients.filter(
        (i) =>
          !(i.korean_name as string | null) ||
          !(i.chinese_name as string | null) ||
          !(i.japanese_name as string | null),
      );

  console.log(`대상 원료 ${targets.length}건 / 전체 ${ingredients.length}건`);

  for (const ing of targets) {
    try {
      const inci = ing.inci_name as string;
      const enriched = await enrichOne(ai, inci);
      const existingSyn = (ing.synonyms as string[] | null) ?? [];
      const mergedSyn = Array.from(new Set([...existingSyn, ...enriched.synonyms]));

      await supabase
        .from("ingredients")
        .update({
          korean_name: enriched.korean_name ?? (ing.korean_name as string | null) ?? null,
          chinese_name: enriched.chinese_name ?? (ing.chinese_name as string | null) ?? null,
          japanese_name: enriched.japanese_name ?? (ing.japanese_name as string | null) ?? null,
          cas_no: enriched.cas_no ?? (ing.cas_no as string | null) ?? null,
          synonyms: mergedSyn,
        })
        .eq("id", ing.id);

      console.log(
        `✓ ${inci} → KR:${enriched.korean_name ?? "-"} / CN:${enriched.chinese_name ?? "-"} / JP:${enriched.japanese_name ?? "-"}`,
      );
      await new Promise((r) => setTimeout(r, 800)); // rate limit courtesy
    } catch (e) {
      console.error(`✗ ${ing.inci_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
