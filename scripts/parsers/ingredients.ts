import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedRegulation } from "./schema";

export async function findOrCreateIngredient(
  supabase: SupabaseClient,
  reg: ExtractedRegulation,
): Promise<string> {
  const inci = reg.inci_name.trim();
  const cas = reg.cas_no?.trim();

  // 1) INCI exact match (case-insensitive)
  {
    const { data } = await supabase
      .from("ingredients")
      .select("id")
      .ilike("inci_name", inci)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 2) CAS match
  if (cas) {
    const { data } = await supabase
      .from("ingredients")
      .select("id")
      .eq("cas_no", cas)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 3) Synonyms array contains — 동일 synonym이 여러 원료에 들어있을 수 있으니
  // maybeSingle 금지 (2건+ 매치 시 PostgREST가 error 반환). limit(1)로 첫 건 사용.
  {
    const { data } = await supabase
      .from("ingredients")
      .select("id")
      .contains("synonyms", [inci])
      .limit(1);
    if (data?.[0]?.id) return data[0].id;
  }

  // 4) Create new
  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      inci_name: inci,
      korean_name: reg.korean_name,
      chinese_name: reg.chinese_name,
      japanese_name: reg.japanese_name,
      cas_no: cas ?? null,
      synonyms: reg.synonyms,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create ingredient ${inci}: ${error.message}`);
  return data.id;
}
