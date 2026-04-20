import type { ExtractedRegulation } from "./schema";

export type ConsensusOutcome =
  | { kind: "agreed"; merged: ExtractedRegulation; confidence: number }
  | {
      kind: "disagreed";
      flash: ExtractedRegulation;
      pro: ExtractedRegulation;
      reason: string;
    }
  | { kind: "flash_only"; flash: ExtractedRegulation }
  | { kind: "pro_only"; pro: ExtractedRegulation };

function keyOf(r: ExtractedRegulation): string {
  return (r.cas_no?.trim() || r.inci_name.trim().toLowerCase());
}

export function consensusCheck(
  flashResults: ExtractedRegulation[],
  proResults: ExtractedRegulation[],
): ConsensusOutcome[] {
  const flashMap = new Map(flashResults.map((r) => [keyOf(r), r]));
  const proMap = new Map(proResults.map((r) => [keyOf(r), r]));
  const allKeys = new Set([...flashMap.keys(), ...proMap.keys()]);
  const outcomes: ConsensusOutcome[] = [];

  for (const k of allKeys) {
    const f = flashMap.get(k);
    const p = proMap.get(k);
    if (f && !p) {
      outcomes.push({ kind: "flash_only", flash: f });
      continue;
    }
    if (p && !f) {
      outcomes.push({ kind: "pro_only", pro: p });
      continue;
    }
    if (!f || !p) continue;

    const statusMatches = f.status === p.status;
    const concMatches = concentrationMatches(f.max_concentration, p.max_concentration);
    if (statusMatches && concMatches) {
      outcomes.push({
        kind: "agreed",
        merged: mergeSupplementaryFields(f, p),
        // Same-family dual Flash (Flash + Flash-lite) → 0.80.
        // Upgrade to 0.95 if Pro becomes available later.
        confidence: 0.8,
      });
    } else {
      const reasons: string[] = [];
      if (!statusMatches) reasons.push(`status mismatch (flash=${f.status}, pro=${p.status})`);
      if (!concMatches)
        reasons.push(
          `concentration mismatch (flash=${f.max_concentration}, pro=${p.max_concentration})`,
        );
      outcomes.push({ kind: "disagreed", flash: f, pro: p, reason: reasons.join("; ") });
    }
  }

  return outcomes;
}

function concentrationMatches(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  // Allow 2% relative tolerance for rounding
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return diff / scale <= 0.02;
}

function mergeSupplementaryFields(
  f: ExtractedRegulation,
  p: ExtractedRegulation,
): ExtractedRegulation {
  return {
    ...f,
    korean_name: f.korean_name ?? p.korean_name,
    chinese_name: f.chinese_name ?? p.chinese_name,
    japanese_name: f.japanese_name ?? p.japanese_name,
    cas_no: f.cas_no ?? p.cas_no,
    synonyms: Array.from(new Set([...f.synonyms, ...p.synonyms])),
    product_categories: Array.from(
      new Set([...f.product_categories, ...p.product_categories]),
    ),
    conditions: f.conditions ?? p.conditions,
    source_section: f.source_section ?? p.source_section,
  };
}

export function isOutlier(
  newValue: number | null,
  existing: number | null,
): { outlier: boolean; reason?: string } {
  if (newValue === null || existing === null) return { outlier: false };
  if (existing === 0) return { outlier: false };
  const ratio = newValue / existing;
  if (ratio > 5 || ratio < 0.2) {
    return {
      outlier: true,
      reason: `new=${newValue} existing=${existing} ratio=${ratio.toFixed(2)} (>5x or <0.2x)`,
    };
  }
  return { outlier: false };
}
