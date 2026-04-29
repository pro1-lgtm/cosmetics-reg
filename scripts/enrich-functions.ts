import { loadEnv } from "./crawlers/env";
loadEnv();

import { GoogleGenAI } from "@google/genai";
import { readRows, writeRows } from "../lib/json-store";

// Phase 5b — Supabase 제거. ingredients.json 직접 read/update.
// 매 50 건마다 progressive write — Gemini quota 소진 또는 중단 시 진행 보존.

const CATEGORIES = [
  "보습제","미백","주름개선","자외선차단제","방부제","보존제","색소","향료",
  "계면활성제","유화제","점증제","항산화제","각질제거","세정제","pH조절제",
  "킬레이트제","완화제","수렴제","항균제","기타",
] as const;

const SCHEMA = {
  type: "object",
  properties: {
    function_category: { type: "string", enum: [...CATEGORIES], nullable: true },
    function_description: { type: "string", nullable: true },
  },
  required: [],
} as const;

interface IngredientRow {
  id: string;
  inci_name: string;
  korean_name: string | null;
  function_category: string | null;
  function_description: string | null;
  [k: string]: unknown;
}

interface RegulationRow {
  ingredient_id: string;
  [k: string]: unknown;
}

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

function parseRetryDelayMs(errMsg: string): number | null {
  const m1 = errMsg.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (m1) return Math.ceil(Number(m1[1]) * 1000);
  const m2 = errMsg.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  if (m2) return Math.ceil(Number(m2[1]) * 1000);
  return null;
}

async function enrichOne(
  ai: GoogleGenAI,
  inci: string,
  korean: string | null,
): Promise<{ function_category: string | null; function_description: string | null }> {
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
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
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /503|UNAVAILABLE|RESOURCE_EXHAUSTED|429|ECONNRESET|ETIMEDOUT/i.test(msg);
      if (!retryable || attempt === maxAttempts) throw e;
      const serverDelay = parseRetryDelayMs(msg);
      const waitMs = serverDelay ?? 2_000 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt} after ${Math.round(waitMs / 1000)}s — ${msg.slice(0, 60)}`);
      await new Promise((r) => setTimeout(r, waitMs + 500));
    }
  }
  throw lastErr;
}

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;

  const ingredients = await readRows<IngredientRow>("ingredients");
  const regs = await readRows<RegulationRow>("regulations");

  const countByIng = new Map<string, number>();
  for (const r of regs) countByIng.set(r.ingredient_id, (countByIng.get(r.ingredient_id) ?? 0) + 1);

  const byId = new Map<string, IngredientRow>();
  for (const i of ingredients) byId.set(i.id, i);

  const prioritizedIds = Array.from(countByIng.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const ordered = prioritizedIds.map((id) => byId.get(id)).filter(Boolean) as IngredientRow[];
  const targets = (force ? ordered : ordered.filter((i) => !i.function_category)).slice(0, limit);

  console.log(`대상 ${targets.length}건 (전체 규제 연결 ${ordered.length}건 중, limit=${limit}, force=${force})`);

  const MIN_INTERVAL_MS = 6_000;
  let okCount = 0, errCount = 0, consecutive429 = 0;
  let dirty = false;

  async function flush() {
    if (!dirty) return;
    await writeRows("ingredients", ingredients);
    dirty = false;
  }

  for (let idx = 0; idx < targets.length; idx++) {
    const ing = targets[idx];
    const startedAt = Date.now();
    try {
      const enriched = await enrichOne(ai, ing.inci_name, ing.korean_name);
      if (enriched.function_category || enriched.function_description) {
        ing.function_category = enriched.function_category;
        ing.function_description = enriched.function_description;
        dirty = true;
        okCount++;
        consecutive429 = 0;
        console.log(`[${idx + 1}/${targets.length}] ✓ ${ing.inci_name} → ${enriched.function_category ?? "-"} | ${enriched.function_description ?? "-"}`);
      } else {
        console.log(`[${idx + 1}/${targets.length}] · ${ing.inci_name} → (no data)`);
      }
    } catch (e) {
      errCount++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${idx + 1}/${targets.length}] ✗ ${ing.inci_name}: ${msg.slice(0, 150)}`);
      if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
        consecutive429++;
        if (consecutive429 >= 5) {
          console.error(`연속 429 ${consecutive429}회 — 일일 quota 소진 가능성. 중단.`);
          break;
        }
      } else consecutive429 = 0;
    }

    if ((idx + 1) % 50 === 0) {
      await flush();
      console.log(`  · checkpoint write @ ${idx + 1}`);
    }

    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, MIN_INTERVAL_MS - elapsed);
    if (idx < targets.length - 1 && wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  await flush();
  console.log(`완료: 성공 ${okCount} / 실패 ${errCount} / 대상 ${targets.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
