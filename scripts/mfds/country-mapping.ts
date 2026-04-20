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
