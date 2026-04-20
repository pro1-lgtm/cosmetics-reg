import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedRegulation } from "./schema";
import { findOrCreateIngredient } from "./ingredients";
import { isOutlier, type ConsensusOutcome } from "./consensus";

export interface UpsertContext {
  supabase: SupabaseClient;
  country_code: string;
  source_url: string;
  source_document: string;
  source_document_id: string;
}

export interface UpsertStats {
  inserted: number;
  updated: number;
  quarantined: number;
  skipped: number;
}

export async function applyOutcomes(
  ctx: UpsertContext,
  outcomes: ConsensusOutcome[],
): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, updated: 0, quarantined: 0, skipped: 0 };

  for (const outcome of outcomes) {
    if (outcome.kind === "disagreed") {
      // Create ingredient so users can still find it (result will be "pending")
      await findOrCreateIngredient(ctx.supabase, outcome.flash);
      await quarantine(ctx, {
        raw_name: outcome.flash.inci_name,
        proposed: outcome.flash,
        flash: outcome.flash,
        pro: outcome.pro,
        reason: `model_disagreement: ${outcome.reason}`,
        confidence: 0.5,
      });
      stats.quarantined++;
      continue;
    }

    if (outcome.kind === "flash_only" || outcome.kind === "pro_only") {
      const reg = outcome.kind === "flash_only" ? outcome.flash : outcome.pro;
      await findOrCreateIngredient(ctx.supabase, reg);
      await quarantine(ctx, {
        raw_name: reg.inci_name,
        proposed: reg,
        flash: outcome.kind === "flash_only" ? reg : null,
        pro: outcome.kind === "pro_only" ? reg : null,
        reason: `one_model_only_${outcome.kind}`,
        confidence: 0.3,
      });
      stats.quarantined++;
      continue;
    }

    // agreed — outlier check vs existing DB value
    const reg = outcome.merged;
    const ingredient_id = await findOrCreateIngredient(ctx.supabase, reg);

    const { data: existing } = await ctx.supabase
      .from("regulations")
      .select("id, max_concentration")
      .eq("ingredient_id", ingredient_id)
      .eq("country_code", ctx.country_code)
      .maybeSingle();

    if (existing) {
      const out = isOutlier(reg.max_concentration, existing.max_concentration as number | null);
      if (out.outlier) {
        await quarantine(ctx, {
          raw_name: reg.inci_name,
          proposed: reg,
          flash: reg,
          pro: reg,
          reason: `outlier_concentration: ${out.reason}`,
          confidence: outcome.confidence,
        });
        stats.quarantined++;
        continue;
      }
    }

    const row = {
      ingredient_id,
      country_code: ctx.country_code,
      status: reg.status,
      max_concentration: reg.max_concentration,
      concentration_unit: reg.concentration_unit,
      product_categories: reg.product_categories,
      conditions: reg.conditions,
      source_url: ctx.source_url,
      source_document: ctx.source_document,
      last_verified_at: new Date().toISOString(),
      auto_verified: true,
      confidence_score: outcome.confidence,
    };

    if (existing) {
      await ctx.supabase.from("regulations").update(row).eq("id", existing.id);
      stats.updated++;
    } else {
      await ctx.supabase.from("regulations").insert(row);
      stats.inserted++;
    }
  }

  return stats;
}

async function quarantine(
  ctx: UpsertContext,
  q: {
    raw_name: string;
    proposed: ExtractedRegulation;
    flash: ExtractedRegulation | null;
    pro: ExtractedRegulation | null;
    reason: string;
    confidence: number;
  },
) {
  await ctx.supabase.from("regulation_quarantine").insert({
    ingredient_name_raw: q.raw_name,
    country_code: ctx.country_code,
    proposed_data: q.proposed,
    confidence_score: q.confidence,
    flash_result: q.flash,
    pro_result: q.pro,
    rejection_reason: q.reason,
    source_document_id: ctx.source_document_id,
    status: "pending",
  });
}
