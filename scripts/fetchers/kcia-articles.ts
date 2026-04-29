import { loadEnv } from "../crawlers/env";
loadEnv();
import { writeRows, updateMeta } from "../../lib/json-store";

// 대한화장품협회 (KCIA) 의 해외법령·중국법령 게시물 metadata fetcher.
// 첨부 PDF 는 회원 로그인 필요 — 자동 다운 X. 게시물 link/제목/날짜만 fetch.
// UI 에서 "관련 협회 자료 N건" 보조 정보로 사용자에게 link 안내.
//
// 한국 사이트라 한국 IP 차단 X. 100% 자동화 가능.

const BASE = "https://kcia.or.kr";
const REFERER = `${BASE}/home/main/`;
const PAGES = [
  { url: `${BASE}/home/law/law_05.php`, category: "해외법령" },
  { url: `${BASE}/home/law/law_09.php`, category: "중국법령" },
];

interface KciaArticle {
  no: string;
  title: string;
  category: string;       // 페이지 카테고리 (해외법령/중국법령)
  country_inferred: string | null;  // 제목에서 국가 추론 (US/EU/CN/JP/CA/...)
  date: string;           // YYYY-MM-DD
  views: number;
  attach_pdf: boolean;
  attach_hwp: boolean;
  attach_excel: boolean;
  detail_url: string;     // KCIA 게시물 페이지 (사용자 클릭용)
}

// 국가 추론 휴리스틱 — 제목 키워드 매칭
const COUNTRY_KEYWORDS: { keys: string[]; code: string }[] = [
  { keys: ["미국", "FDA", "캘리포니아", "MoCRA", "California", "U.S."], code: "US" },
  { keys: ["EU", "유럽", "European Commission", "CosIng", "EUR-Lex"], code: "EU" },
  { keys: ["중국", "NMPA", "中国", "化妆品", "IECIC", "안전기술규범"], code: "CN" },
  { keys: ["일본", "MHLW", "厚生労働省", "化粧品基準"], code: "JP" },
  { keys: ["대만", "TFDA", "台灣"], code: "TW" },
  { keys: ["캐나다", "Health Canada", "Hotlist"], code: "CA" },
  { keys: ["베트남"], code: "VN" },
  { keys: ["태국", "Thailand"], code: "TH" },
  { keys: ["인도네시아", "BPOM"], code: "ID" },
  { keys: ["말레이시아", "NPRA"], code: "MY" },
  { keys: ["필리핀", "Philippines"], code: "PH" },
  { keys: ["싱가포르", "HSA"], code: "SG" },
  { keys: ["브라질", "ANVISA", "Brasil"], code: "BR" },
  { keys: ["아르헨티나", "ANMAT"], code: "AR" },
  { keys: ["콜롬비아", "DECISIÓN", "Colombia"], code: "CO" },
];

function inferCountry(title: string, fallbackCategory: string): string | null {
  for (const { keys, code } of COUNTRY_KEYWORDS) {
    if (keys.some((k) => title.includes(k))) return code;
  }
  // category fallback
  if (fallbackCategory === "중국법령") return "CN";
  return null;
}

async function fetchListPage(url: string, category: string, cookies: Record<string, string>): Promise<{ html: string; cookies: Record<string, string> }> {
  // GET with cookie + referer
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": REFERER,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const newCookies = { ...cookies };
  for (const sc of setCookie) {
    const m = sc.match(/^([^=]+)=([^;]+)/);
    if (m) newCookies[m[1]] = m[2];
  }
  return { html: await res.text(), cookies: newCookies };
}

function parseList(html: string, category: string): KciaArticle[] {
  const articles: KciaArticle[] = [];
  // table row pattern — 위 분석에서 본 구조:
  //   <td class="no"><p>16330</p></td>  또는 <p>공지</p>
  //   <td class="left"> <a href="?type=view&no=NNNN..." class="link">제목</a> </td>
  //   <td class="attach"> ...btn_attach pdf|hwp|excel ... </td>
  //   <td><p>조회수</p></td>
  //   <td><p>YYYY-MM-DD</p></td>
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const linkM = row.match(/href="(\?type=view&no=(\d+)[^"]*)"[^>]*>([^<]+)</);
    if (!linkM) continue;
    const detailUrl = linkM[1];
    const no = linkM[2];
    const title = linkM[3].trim();
    const dateM = row.match(/(\d{4}-\d{2}-\d{2})/);
    const viewsM = row.match(/<td>\s*<p>\s*(\d+)\s*<\/p>/);
    const attachPdf = /btn_attach\s+pdf/.test(row);
    const attachHwp = /btn_attach\s+hwp/.test(row);
    const attachExcel = /btn_attach\s+excel/.test(row);
    articles.push({
      no,
      title,
      category,
      country_inferred: inferCountry(title, category),
      date: dateM?.[1] ?? "",
      views: viewsM ? Number(viewsM[1]) : 0,
      attach_pdf: attachPdf,
      attach_hwp: attachHwp,
      attach_excel: attachExcel,
      detail_url: detailUrl.startsWith("http") ? detailUrl : `${BASE}/home/law/${category === "중국법령" ? "law_09" : "law_05"}.php${detailUrl}`,
    });
  }
  return articles;
}

async function main() {
  const startedAt = Date.now();
  // session 시작 — main 페이지 GET
  const initRes = await fetch(REFERER, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/125.0.0.0" },
  });
  if (!initRes.ok) throw new Error(`init: HTTP ${initRes.status}`);
  const initSetCookie = initRes.headers.getSetCookie?.() ?? [];
  let cookies: Record<string, string> = {};
  for (const sc of initSetCookie) {
    const m = sc.match(/^([^=]+)=([^;]+)/);
    if (m) cookies[m[1]] = m[2];
  }
  console.log(`▶ KCIA session: ${Object.keys(cookies).join(",")}`);

  const all: KciaArticle[] = [];
  for (const { url, category } of PAGES) {
    const { html, cookies: newCookies } = await fetchListPage(url, category, cookies);
    cookies = newCookies;
    const list = parseList(html, category);
    console.log(`  ${category}: ${list.length} 게시물`);
    all.push(...list);
  }

  // 정렬: 최신 순 (date desc)
  all.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // 중복 제거 (no 기준)
  const unique = new Map<string, KciaArticle>();
  for (const a of all) if (!unique.has(a.no)) unique.set(a.no, a);
  const final = Array.from(unique.values());

  await writeRows("kcia-articles", final);
  await updateMeta({});

  // country별 카운트
  const byCountry: Record<string, number> = {};
  for (const a of final) {
    if (a.country_inferred) byCountry[a.country_inferred] = (byCountry[a.country_inferred] ?? 0) + 1;
    else byCountry["?"] = (byCountry["?"] ?? 0) + 1;
  }
  console.log(`\n=== summary (${((Date.now()-startedAt)/1000).toFixed(1)}s) ===`);
  console.log(`  KCIA articles: ${final.length}`);
  console.log(`  by country:`, byCountry);
}

main().catch((e) => { console.error(e); process.exit(1); });
