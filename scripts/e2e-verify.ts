import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = "https://cosmetics-reg-tim10000.netlify.app";
const SHOT_DIR = ".e2e-shots";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}  ${detail}`);
}

async function search(page: Page, q: string) {
  await page.fill('input[type="text"]', "");
  await page.fill('input[type="text"]', q);
  await page.keyboard.press("Enter");
  // article 렌더 또는 "찾지 못했습니다" 메시지 둘 중 하나 나타날 때까지
  await page
    .locator("article")
    .first()
    .or(page.locator("text=DB에서 찾지 못했습니다"))
    .waitFor({ timeout: 15_000 });
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Collect console errors
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url()}`); });

  // T1. 홈 로드
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  const title = await page.title();
  record("T1 홈 로드", title.includes("화장품"), `title="${title}"`);
  await page.screenshot({ path: `${SHOT_DIR}/t1-home.png`, fullPage: true });

  // T2. Retinol 검색 — 15개 카드 렌더
  await search(page, "Retinol");
  const cards = await page.locator("article").count();
  record("T2 Retinol 15개 국가 카드", cards === 15, `rendered ${cards} cards`);
  await page.screenshot({ path: `${SHOT_DIR}/t2-retinol.png`, fullPage: true });

  // T3. CN 카드 빨강 경고 (positive_list not_found 분기)
  const cnCard = page.locator("article", { hasText: "중국" }).first();
  const cnHtml = await cnCard.innerHTML();
  const cnHasRed = /bg-red-100|text-red-8/.test(cnHtml);
  const cnHasIECIC = /IECIC|등록 여부 확인/.test(cnHtml);
  record("T3 CN 빨강 경고 + IECIC 문구", cnHasRed && cnHasIECIC,
    `red-class=${cnHasRed} iecic-text=${cnHasIECIC}`);

  // T4. TW 카드 빨강 경고 (Positive List)
  const twCard = page.locator("article", { hasText: "대만" }).first();
  const twHtml = await twCard.innerHTML();
  const twHasRed = /bg-red-100|text-red-8/.test(twHtml);
  const twHasPositive = /Positive List|등록 여부 확인/.test(twHtml);
  record("T4 TW 빨강 경고 + Positive List 문구", twHasRed && twHasPositive,
    `red=${twHasRed} positive=${twHasPositive}`);

  // T5. JP 카드 노랑 주의 (hybrid not_found 분기). EU는 MFDS에 verified 데이터 있어 hybrid not_found 분기 미표시 가능.
  const jpCard = page.locator("article", { hasText: "일본" }).first();
  const jpHtml = await jpCard.innerHTML();
  const jpHasAmber = /bg-amber-100|text-amber-8/.test(jpHtml);
  const jpHasAnnex = /Annex|조건부 허용/.test(jpHtml);
  record("T5 JP 노랑 주의 (hybrid not_found)", jpHasAmber && jpHasAnnex,
    `amber=${jpHasAmber} annex=${jpHasAnnex}`);

  // T6. CA 카드 — verified 상태 표시
  const caCard = page.locator("article", { hasText: "캐나다" }).first();
  const caHtml = await caCard.innerHTML();
  const caHasVerified = /자동 업데이트|Maximum Concentration|배합한도/.test(caHtml);
  record("T6 CA verified 콘텐츠 표시", caHasVerified, `verified-text=${caHasVerified}`);

  // T7. Benzophenone-4 — function 배지
  await search(page, "Benzophenone-4");
  await page.waitForTimeout(500);
  const hdr = await page.locator("section").first().innerHTML();
  const hasSky = /bg-sky-100|자외선차단제/.test(hdr);
  const hasDesc = /자외선으로부터/.test(hdr);
  record("T7 function_category 배지 + description", hasSky && hasDesc,
    `sky=${hasSky} desc=${hasDesc}`);
  await page.screenshot({ path: `${SHOT_DIR}/t7-benzo.png`, fullPage: true });

  // T8. autocomplete 드롭다운 — "레티" 입력
  await page.fill('input[type="text"]', "");
  await page.type('input[type="text"]', "레티", { delay: 60 });
  await page.waitForTimeout(500);
  const drop = page.locator("ul").first();
  const dropVisible = await drop.isVisible().catch(() => false);
  const dropItems = await drop.locator("li").count().catch(() => 0);
  record("T8 autocomplete 드롭다운 (레티)", dropVisible && dropItems > 0,
    `visible=${dropVisible} items=${dropItems}`);
  await page.screenshot({ path: `${SHOT_DIR}/t8-autocomplete.png`, fullPage: false });

  // T9. 빈 입력 → 드롭다운 숨김 (F-10 수정의 런타임 검증)
  await page.fill('input[type="text"]', "");
  await page.waitForTimeout(300);
  const emptyDropVisible = await drop.isVisible().catch(() => false);
  record("T9 빈 입력 시 드롭다운 사라짐", !emptyDropVisible, `visible=${emptyDropVisible}`);

  // T10. 없는 원료 → "DB에서 찾지 못했습니다"
  await search(page, "ZZZNonExistentIngredient");
  const body = await page.textContent("body");
  const notFoundMsg = body?.includes("DB에서 찾지 못했습니다") ?? false;
  record("T10 없는 원료 friendly 메시지", notFoundMsg, `msg-shown=${notFoundMsg}`);

  // T11. console/network errors 없음
  record("T11 페이지 오류/5xx 없음", errs.length === 0, `errors=${errs.length} ${errs.slice(0,2).join(" | ")}`);

  await browser.close();

  // summary
  console.log("\n=== SUMMARY ===");
  const pass = results.filter(r => r.ok).length;
  console.log(`${pass}/${results.length} passed`);
  if (pass < results.length) {
    console.log("\n실패:");
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
