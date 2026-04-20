import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { ExtractionOutput, GEMINI_RESPONSE_SCHEMA } from "./schema";
import type { ExtractedRegulation } from "./schema";

const EXTRACT_PROMPT = (country: string, title: string, url: string) => `
당신은 화장품 규제 데이터 추출 전문가입니다. 아래 공식 규제 문서(${country})에서 언급된 모든 화장품 원료와 그 규제 내용을 추출하세요.

문서 제목: ${title}
출처 URL: ${url}

**엄격한 규칙**:
1. 문서 원문에 명시된 내용만 추출. 추측·보간 금지. 불명확하면 해당 항목 스킵.
2. inci_name은 국제 INCI 표준명(영문). 문서가 로컬 언어로만 쓰였다면 korean_name / chinese_name / japanese_name 중 해당 언어 필드에 채우고 INCI명도 표준명으로 변환.
3. status 값 의미:
   - banned: 배합금지 / 사용금지
   - restricted: 배합한도·조건부 허용
   - allowed: 일반 허용 (positive list 없는 국가에서)
   - listed: positive list(예: IECIC, EU Annex V 보존제) 수록 — 수출 가능 근거
   - not_listed: positive list 미수록 — 수출 불가 근거
4. max_concentration은 숫자만. 단위는 concentration_unit에 별도 표기(기본 %).
5. product_categories: leave_on / rinse_off / lip / eye_area / oral_care / aerosol / 등 문서에 명시된 대로.
6. conditions: 자유 텍스트로 제한 조건(예: "헹궈내는 제품만 허용", "점막 사용 금지").
7. source_section: 원문의 해당 조항·별표·페이지 참조(있으면).

**중요**: 1건이라도 불확실하면 전체 배열을 비워서 반환하세요. 잘못된 데이터가 DB에 들어가는 것보다 0건이 낫습니다.
`;

async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retriable = /\b(429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(msg);
      if (!retriable || attempt === maxAttempts) throw e;
      const backoffMs = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      console.log(`    · retry ${attempt}/${maxAttempts - 1} after ${backoffMs}ms (${msg.slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

function buildContents(filePath: string, prompt: string, raw: Buffer) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return [
      {
        role: "user" as const,
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "application/pdf", data: raw.toString("base64") } },
        ],
      },
    ];
  }
  // HTML, CSV, text — pass as text payload
  return [
    {
      role: "user" as const,
      parts: [{ text: `${prompt}\n\n<<<DOCUMENT START>>>\n${raw.toString("utf8")}\n<<<DOCUMENT END>>>` }],
    },
  ];
}

export async function extractWithModel(args: {
  model: string;
  filePath: string;
  country: string;
  title: string;
  url: string;
}): Promise<ExtractedRegulation[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const raw = await readFile(args.filePath);
  const prompt = EXTRACT_PROMPT(args.country, args.title, args.url);

  const res = await callWithRetry(async () =>
    ai.models.generateContent({
      model: args.model,
      contents: buildContents(args.filePath, prompt, raw),
      config: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0,
      },
    }),
  );

  const text = res.text ?? "";
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model ${args.model} returned non-JSON: ${text.slice(0, 200)}`);
  }

  const result = ExtractionOutput.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Model ${args.model} output failed schema validation: ${result.error.message}`,
    );
  }
  return result.data.regulations;
}
