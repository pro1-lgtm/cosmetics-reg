import { randomUUID } from "node:crypto";
import type { ExtractedRegulation } from "./schema";

// Phase 5b — JSON 기반. ingredients.json 의 in-memory 작업본을 받아 검색·신규 생성.
// caller 가 마지막에 한 번 writeRows("ingredients", ...) 로 영속화.

export interface IngredientLite {
  id: string;
  inci_name: string;
  korean_name: string | null;
  chinese_name: string | null;
  japanese_name: string | null;
  cas_no: string | null;
  synonyms: string[];
  description: string | null;
  function_category: string | null;
  function_description: string | null;
}

export function findOrCreateIngredient(
  ingredients: IngredientLite[],
  byInciLower: Map<string, IngredientLite>,
  byCas: Map<string, IngredientLite>,
  reg: ExtractedRegulation,
): string {
  const inci = reg.inci_name.trim();
  const lower = inci.toLowerCase();
  const cas = reg.cas_no?.trim() || null;

  const exact = byInciLower.get(lower);
  if (exact) return exact.id;

  if (cas) {
    const byC = byCas.get(cas);
    if (byC) return byC.id;
  }

  for (const ing of ingredients) {
    if (ing.synonyms.some((s) => s.toLowerCase() === lower)) return ing.id;
  }

  const id = randomUUID();
  const created: IngredientLite = {
    id,
    inci_name: inci,
    korean_name: reg.korean_name,
    chinese_name: reg.chinese_name,
    japanese_name: reg.japanese_name,
    cas_no: cas,
    synonyms: reg.synonyms ?? [],
    description: null,
    function_category: null,
    function_description: null,
  };
  ingredients.push(created);
  byInciLower.set(lower, created);
  if (cas) byCas.set(cas, created);
  return id;
}
