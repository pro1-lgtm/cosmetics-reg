// MFDS COUNTRY_NAME 값을 우리 DB의 country_code[]로 변환.
// 아세안은 개별 6개국으로 fanout, 대만은 TW (migration 0004에서 추가), 기타는 log만 남기고 skip.

const MAPPING: Record<string, string[]> = {
  "한국": ["KR"],
  "대한민국": ["KR"],
  "중국": ["CN"],
  "EU": ["EU"],
  "유럽": ["EU"],
  "유럽연합": ["EU"],
  "미국": ["US"],
  "일본": ["JP"],
  "아세안": ["VN", "TH", "ID", "MY", "PH", "SG"],
  "ASEAN": ["VN", "TH", "ID", "MY", "PH", "SG"],
  "대만": ["TW"],
  "Taiwan": ["TW"],
  "브라질": ["BR"],
  "아르헨티나": ["AR"],
  "캐나다": ["CA"],
  // Andean Community (Comunidad Andina) — Decisión 833 으로 EU 규제 + FDA list 동시 채택.
  "콜롬비아": ["CO"],
  "에콰도르": ["EC"],
  "페루": ["PE"],
  "볼리비아": ["BO"],
  "안데스": ["CO", "EC", "PE", "BO"],
  "안데스공동체": ["CO", "EC", "PE", "BO"],
};

const warned = new Set<string>();

export function mapCountryName(name: string | null | undefined): string[] {
  if (!name) return [];
  const trimmed = name.trim();
  if (!trimmed) return [];
  if (MAPPING[trimmed]) return MAPPING[trimmed];
  if (!warned.has(trimmed)) {
    warned.add(trimmed);
    console.warn(`  [country-mapping] unknown COUNTRY_NAME="${trimmed}" — skipped`);
  }
  return [];
}

export function getUnknownCountries(): string[] {
  return Array.from(warned);
}
