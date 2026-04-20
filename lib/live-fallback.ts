import { GoogleGenAI } from "@google/genai";

export interface LiveSource {
  url: string;
  title?: string;
}

export interface LiveAnswer {
  found: boolean;
  answer_text: string;
  sources: LiveSource[];
  searched_at: string;
  model: string;
  disclaimer: string;
}

const OFFICIAL_DOMAINS_HINT = `
공식 기관 도메인 예시:
- 🇰🇷 .go.kr (식약처 mfds.go.kr, 공공데이터 data.go.kr)
- 🇨🇳 nmpa.gov.cn, .gov.cn
- 🇪🇺 europa.eu, europarl.europa.eu, eur-lex.europa.eu
- 🇺🇸 .gov, fda.gov
- 🇯🇵 mhlw.go.jp, .go.jp
- 🇻🇳 .gov.vn, dav.gov.vn
- 🇹🇭 fda.moph.go.th, .go.th
`;

function liveFallbackPrompt(ingredient: string, countryCode: string) {
  return `
화장품 원료 "${ingredient}"의 "${countryCode}" 국가 규제 상태를 공식 기관 자료로만 조사해 주세요.

${OFFICIAL_DOMAINS_HINT}

답변에 반드시 포함할 내용:
1. 상태 (banned / restricted / allowed / listed / not_listed 중 하나). 명확히 확인 안 되면 "확인 불가".
2. 제한이 있으면 배합한도(%)와 조건.
3. 수출 가능성 판단(positive list 수록 여부 기반).

**엄격한 규칙**:
- 공식 기관 도메인 출처를 못 찾으면 "공식 출처에서 확인하지 못했습니다"라고 답할 것.
- 블로그·위키·뉴스는 출처로 쓰지 말 것.
- 추측·일반 지식으로 답하지 말 것 — 오직 검색된 공식 문서 기반.
- 답변은 3~5문장으로 간결하게.
`;
}

async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retriable = /\b(429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(msg);
      if (!retriable || attempt === maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

export async function liveRegulationLookup(
  ingredient: string,
  countryCode: string,
): Promise<LiveAnswer> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = "gemini-2.5-flash";

  const res = await callWithRetry(() =>
    ai.models.generateContent({
      model,
      contents: liveFallbackPrompt(ingredient, countryCode),
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0,
      },
    }),
  );

  const text = res.text ?? "";
  const sources: LiveSource[] = [];
  const gm = res.candidates?.[0]?.groundingMetadata;
  const chunks = gm?.groundingChunks ?? [];
  for (const c of chunks) {
    const web = (c as { web?: { uri?: string; title?: string } }).web;
    if (web?.uri) sources.push({ url: web.uri, title: web.title });
  }

  return {
    found: text.length > 0 && sources.length > 0,
    answer_text: text,
    sources,
    searched_at: new Date().toISOString(),
    model,
    disclaimer: "AI 실시간 검색 결과입니다. 최종 확인은 반드시 원문 링크의 공식 기관 문서 기준으로 해주세요.",
  };
}
