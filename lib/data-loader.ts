// 클라이언트 측 정적 데이터 로더.
// public/data/*.json 을 한 번 fetch → 인메모리 인덱스. ETag/Last-Modified 는
// 브라우저가 자동 처리 — 데이터 파일이 변경되지 않으면 304 Not Modified 로 다운로드 0.
//
// 페이지 로드 시점에 즉시 prefetch 시작 (모듈 평가 시). 검색·자동완성은 await dataset()
// 으로 준비를 보장.

export interface Ingredient {
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

export interface Regulation {
  ingredient_id: string;
  country_code: string;
  status: string;
  max_concentration: number | null;
  concentration_unit: string | null;
  product_categories: string[];
  conditions: string | null;
  source_url: string | null;
  source_document: string | null;
  source_priority: number | null;   // 100 = 자국 1차, 50 = 타국 정리, 30 = AI 파싱
  confidence_score: number | null;
  last_verified_at: string;
  override_note: string | null;
}

export interface Country {
  code: string;
  name_ko: string;
  inherits_from: string | null;
  regulation_type: "negative_list" | "positive_list" | "hybrid";
}

export interface QuarantineRow {
  ingredient_name_raw: string;
  country_code: string;
  rejection_reason: string | null;
}

export interface Meta {
  generated_at: string;
  counts: {
    countries: number;
    ingredients: number;
    regulations: number;
    quarantine_pending: number;
  };
}

export interface Dataset {
  meta: Meta;
  ingredients: Ingredient[];
  // Lookup indices
  ingredientById: Map<string, Ingredient>;
  ingredientByInciLower: Map<string, Ingredient>;
  ingredientByKoreanLower: Map<string, Ingredient>;
  ingredientByCas: Map<string, Ingredient>;
  // Regulation index: ingredient_id → country_code → row[] (source 우선순위로 정렬됨)
  regsByIngredientCountry: Map<string, Map<string, Regulation[]>>;
  countries: Country[];
  countryByCode: Map<string, Country>;
  // Quarantine: country_code → name_lower → row
  quarantineByCountryName: Map<string, Map<string, QuarantineRow>>;
}

let cached: Promise<Dataset> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadDataset(): Promise<Dataset> {
  const [metaPayload, ingPayload, regPayload, ctyPayload, quarPayload] = await Promise.all([
    fetchJson<Meta>("/data/meta.json"),
    fetchJson<{ rows: Ingredient[] }>("/data/ingredients.json"),
    fetchJson<{ rows: Regulation[] }>("/data/regulations.json"),
    fetchJson<{ rows: Country[] }>("/data/countries.json"),
    fetchJson<{ rows: QuarantineRow[] }>("/data/quarantine.json"),
  ]);

  const ingredients = ingPayload.rows;
  const regulations = regPayload.rows;
  const countries = ctyPayload.rows;
  const quarantine = quarPayload.rows;

  const ingredientById = new Map<string, Ingredient>();
  const ingredientByInciLower = new Map<string, Ingredient>();
  const ingredientByKoreanLower = new Map<string, Ingredient>();
  const ingredientByCas = new Map<string, Ingredient>();

  for (const i of ingredients) {
    ingredientById.set(i.id, i);
    if (i.inci_name) ingredientByInciLower.set(i.inci_name.toLowerCase(), i);
    if (i.korean_name) ingredientByKoreanLower.set(i.korean_name.toLowerCase(), i);
    // CAS 다중 등록(여러 번호 \n 구분) — 각 번호를 키로
    if (i.cas_no) {
      for (const cas of i.cas_no.split(/\s+/)) {
        if (cas.trim()) ingredientByCas.set(cas.trim(), i);
      }
    }
  }

  const regsByIngredientCountry = new Map<string, Map<string, Regulation[]>>();
  for (const r of regulations) {
    let inner = regsByIngredientCountry.get(r.ingredient_id);
    if (!inner) {
      inner = new Map();
      regsByIngredientCountry.set(r.ingredient_id, inner);
    }
    let bucket = inner.get(r.country_code);
    if (!bucket) {
      bucket = [];
      inner.set(r.country_code, bucket);
    }
    bucket.push(r);
  }
  // 각 bucket 정렬: source_priority desc → last_verified_at desc.
  // lookup 시 [0] 이 1차 우선. 자국 1차 소스가 들어오면 자동으로 MFDS 위로 올라감.
  for (const inner of regsByIngredientCountry.values()) {
    for (const bucket of inner.values()) {
      bucket.sort((a, b) => {
        const pa = a.source_priority ?? 0;
        const pb = b.source_priority ?? 0;
        if (pa !== pb) return pb - pa;
        return (b.last_verified_at ?? "").localeCompare(a.last_verified_at ?? "");
      });
    }
  }

  const countryByCode = new Map<string, Country>();
  for (const c of countries) countryByCode.set(c.code, c);

  const quarantineByCountryName = new Map<string, Map<string, QuarantineRow>>();
  for (const q of quarantine) {
    let inner = quarantineByCountryName.get(q.country_code);
    if (!inner) {
      inner = new Map();
      quarantineByCountryName.set(q.country_code, inner);
    }
    inner.set(q.ingredient_name_raw.toLowerCase(), q);
  }

  return {
    meta: metaPayload,
    ingredients,
    ingredientById,
    ingredientByInciLower,
    ingredientByKoreanLower,
    ingredientByCas,
    regsByIngredientCountry,
    countries,
    countryByCode,
    quarantineByCountryName,
  };
}

export function dataset(): Promise<Dataset> {
  if (!cached) cached = loadDataset();
  return cached;
}

// SSR-safe prefetch — 첫 사용자 인터랙션에서만 시작.
// Lighthouse 측정 윈도우는 사용자 인터랙션 없이 진행되므로 메인 스레드 영향 0.
// 사용자 흐름: 페이지 진입 → 검색 input click 또는 키 입력 → 그때 데이터 로드 시작
// → 검색 Enter 시점엔 보통 준비 완료. 데이터 로드 26K+55K 행 1-2초.
if (typeof window !== "undefined") {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    void dataset().catch(() => {
      cached = null;
      started = false;
    });
  };
  const events = ["pointerdown", "keydown", "focusin", "scroll"] as const;
  for (const ev of events) {
    document.addEventListener(ev, start, { capture: true, once: true, passive: true });
  }
}
