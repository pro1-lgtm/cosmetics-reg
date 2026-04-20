export interface MfdsListResponse<T> {
  header: { resultCode: string; resultMsg: string };
  body: {
    pageNo: number;
    totalCount: number;
    numOfRows: number;
    items: T[];
  };
}

// 원료성분정보 (21K) — master ingredient list
export interface IngredientMasterItem {
  INGR_KOR_NAME: string;
  INGR_ENG_NAME: string | null;
  CAS_NO: string | null;
  ORIGIN_MAJOR_KOR_NAME: string | null;
  INGR_SYNONYM: string | null;
}

// 사용제한 원료정보 (31K) — per-country ban/restriction rows
export interface UseRestrictionItem {
  REGULATE_TYPE: string; // "금지" | "제한"
  INGR_STD_NAME: string;
  INGR_ENG_NAME: string | null;
  CAS_NO: string | null;
  INGR_SYNONYM: string | null;
  COUNTRY_NAME: string;
  NOTICE_INGR_NAME: string | null;
  PROVIS_ATRCL: string | null;
  LIMIT_COND: string | null;
}

// 배합금지국가 상세 (6.6K) — detailed per-country conditions with concentrations
export interface CountryDetailItem {
  REGL_CODE: string;
  INGR_CODE: string;
  COUNTRY_NAME: string;
  NOTICE_INGR_NAME: string | null;
  PROVIS_ATRCL: string | null;
  LIMIT_COND: string | null;
}

// 규제정보 집계 (7.2K) — aggregate proh/limit countries per ingredient
export interface AggregateRegulationItem {
  INGR_STD_NAME: string;
  INGR_ENG_NAME: string;
  PROH_NATIONAL: string | null; // comma-sep country list
  LIMIT_NATIONAL: string | null; // comma-sep country list
}
