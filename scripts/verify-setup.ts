import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const geminiKey = process.env.GEMINI_API_KEY!;

async function main() {
  console.log("▶ Supabase connection...");
  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.from("countries").select("code, name_ko").limit(3);
  if (error) {
    console.error("  ✗ Supabase error:", error.message);
    console.error("  → 스키마 마이그레이션이 아직 실행되지 않은 것 같습니다.");
  } else {
    console.log(`  ✓ Supabase OK (countries 행 ${data.length}개 확인)`);
    console.table(data);
  }

  console.log("▶ Gemini connection...");
  const gemini = new GoogleGenAI({ apiKey: geminiKey });
  const res = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "한 단어로 답해. '안녕'을 영어로?",
  });
  const text = res.text?.trim();
  console.log(`  ✓ Gemini OK (응답: "${text}")`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
