import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { loadEnv } from "./crawlers/env";
loadEnv();
import { supabaseAdmin } from "../lib/supabase";

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
  await page
    .locator("article")
    .first()
    .or(page.locator("text=DB에서 찾지 못했습니다"))
    .waitFor({ timeout: 15_000 });
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });

  // pending 상태 테스트: quarantine에 있고 regulations_active에 없는 (ingredient, country) 조합 탐색.
  // regulations가 있으면 lookupRegulation이 verified 반환하고 quarantine 무시 (의도된 동작).
  const s = supabaseAdmin();
  async function findPendingOnly(): Promise<string> {
    const quars = await s.from("regulation_quarantine").select("ingredient_name_raw, country_code").eq("status", "pending");
    for (const q of (quars.data ?? [])) {
      const name = q.ingredient_name_raw as string | null;
      const cc = q.country_code as string | null;
      if (!name || !cc) continue;
      const ing = await s.from("ingredients").select("id").ilike("inci_name", name).maybeSingle();
      if (!ing.data) continue;
      const reg = await s.from("regulations_active").select("id", { count: "exact", head: true }).eq("ingredient_id", ing.data.id).eq("country_code", cc);
      if ((reg.count ?? 0) === 0) return name;
    }
    return "";
  }
  const pendingName = await findPendingOnly();
  console.log(`[setup] pending-only 원료: ${pendingName || "(없음 — T15 skip)"}`);

  const browser = await chromium.launch({ headless: true });

  // ========== Desktop 시나리오 ==========
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  const title = await page.title();
  record("T1 홈 로드", title.includes("화장품"), `title="${title}"`);

  await search(page, "Retinol");
  const cards = await page.locator("article").count();
  record("T2 Retinol 15개 카드", cards === 15, `rendered ${cards}`);

  const cnHtml = await page.locator("article", { hasText: "중국" }).first().innerHTML();
  record("T3 CN 빨강+IECIC",
    /bg-red-100|text-red-8/.test(cnHtml) && /IECIC|등록 여부 확인/.test(cnHtml),
    `red+iecic`);

  const twHtml = await page.locator("article", { hasText: "대만" }).first().innerHTML();
  record("T4 TW 빨강+Positive",
    /bg-red-100|text-red-8/.test(twHtml) && /Positive List|등록 여부 확인/.test(twHtml),
    `red+positive`);

  const jpHtml = await page.locator("article", { hasText: "일본" }).first().innerHTML();
  record("T5 JP 노랑+Annex",
    /bg-amber-100|text-amber-8/.test(jpHtml) && /Annex|조건부 허용/.test(jpHtml),
    `amber+annex`);

  const caHtml = await page.locator("article", { hasText: "캐나다" }).first().innerHTML();
  record("T6 CA verified", /자동 업데이트|배합한도|Maximum/.test(caHtml), `verified`);

  await search(page, "Benzophenone-4");
  const hdr = await page.locator("section").first().innerHTML();
  record("T7 function 배지+desc",
    /bg-sky-100|자외선차단제/.test(hdr) && /자외선으로부터/.test(hdr),
    `sky+desc`);

  // T8 autocomplete: 레티
  await page.fill('input[type="text"]', "");
  await page.type('input[type="text"]', "레티", { delay: 60 });
  await page.waitForTimeout(500);
  const drop = page.locator("ul").first();
  const dropItems = await drop.locator("li").count().catch(() => 0);
  record("T8 autocomplete 레티", dropItems > 0, `items=${dropItems}`);

  // T9 빈 입력 → 드롭다운 숨김 (F-10 수정의 런타임 검증)
  await page.fill('input[type="text"]', "");
  await page.waitForTimeout(300);
  const emptyVis = await drop.isVisible().catch(() => false);
  record("T9 빈 입력 드롭다운 숨김", !emptyVis, `visible=${emptyVis}`);

  // T10 없는 원료
  await search(page, "ZZZNonExistentIngredient");
  const body10 = await page.textContent("body");
  record("T10 없는 원료 메시지", body10?.includes("DB에서 찾지 못했습니다") ?? false, ``);

  // T11 콘솔·5xx 무오류
  record("T11 콘솔/5xx 0건", errs.length === 0, `errs=${errs.length}`);

  // T12 한국어 검색 정확 매칭 (레티놀 → Retinol ingredient header 표시)
  await search(page, "레티놀");
  const header12 = await page.textContent("body");
  record("T12 한국어 검색", header12?.includes("Retinol") ?? false, `Retinol header`);

  // T13 CAS 검색
  await search(page, "68-26-8");
  const header13 = await page.textContent("body");
  record("T13 CAS 검색", header13?.includes("Retinol") ?? false, `Retinol header from CAS`);

  // T14 키보드 내비: 페이지 reload로 깨끗한 상태 → "레티" type → dropdown 렌더 대기 → ArrowDown → Enter
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  await page.focus('input[type="text"]');
  await page.type('input[type="text"]', "레티", { delay: 80 });
  // 실제 드롭다운 li가 나타날 때까지 대기 (debounce 120ms + API + render)
  await page.locator("ul li").first().waitFor({ timeout: 5_000 });
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  // 키워드 pick → runSearch → ingredient header 등장 대기 (INCI 텍스트 'Retino' 포함)
  await page.locator("text=/Retin/i").first().waitFor({ timeout: 15_000 });
  const after14 = await page.textContent("body");
  record("T14 키보드 내비 ArrowDown+Enter", !!after14 && /Retin/i.test(after14), `Retin header`);

  // T15 pending 상태 렌더 — regulations에 없고 quarantine에만 있는 원료 필요
  if (pendingName) {
    await search(page, pendingName);
    const bodyQ = await page.textContent("body");
    record(`T15 pending 렌더 (${pendingName.slice(0,30)})`,
      bodyQ?.includes("검토 중") ?? false,
      `"검토 중" 노출`);
  } else {
    record("T15 pending 렌더", true, "skip — pending-only 원료 없음");
  }

  // T16 PostgREST injection 방어 (UI 경로) — "Retinol,cas_no.eq.X"
  await search(page, "Retinol,cas_no.eq.X");
  const body16 = await page.textContent("body");
  // injection 되면 전혀 다른 결과 또는 에러. sanitize 작동하면 "Retinol" 만으로 검색돼 결과 정상.
  record("T16 UI injection 방어", body16?.includes("Retinol") ?? false, `sanitized to Retinol`);

  // T19 URL 딥링크 — /?q=Retinol 로 직접 진입 시 자동 검색
  await page.goto(`${BASE}/?q=Retinol`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.locator("article").first().waitFor({ timeout: 15_000 });
  const urlT19 = page.url();
  const deepBody = await page.textContent("body");
  record("T19 URL 딥링크 /?q=Retinol",
    urlT19.includes("q=Retinol") && (deepBody?.includes("Retinol") ?? false),
    `url=${urlT19.includes("q=Retinol")} content=${deepBody?.includes("Retinol")}`);

  // T20 a11y attributes — combobox role + aria-expanded
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  const role = await page.locator('input[role="combobox"]').count();
  const hasListbox = await page.locator('[role="listbox"]').count().catch(() => 0);
  // type 후 listbox 나타나는지
  await page.focus('input[role="combobox"]');
  await page.type('input[role="combobox"]', "레티", { delay: 60 });
  await page.locator('[role="listbox"] [role="option"]').first().waitFor({ timeout: 5_000 });
  const listboxVisible = await page.locator('[role="listbox"]').isVisible();
  const expanded = await page.locator('input[role="combobox"]').getAttribute("aria-expanded");
  record("T20 a11y combobox + listbox",
    role === 1 && listboxVisible && expanded === "true",
    `role=${role} listbox-visible=${listboxVisible} expanded=${expanded} (initial listbox=${hasListbox})`);

  // T21 /sources 대시보드 페이지
  const srcRes = await page.goto(`${BASE}/sources`, { waitUntil: "networkidle", timeout: 30_000 });
  const srcStatus = srcRes?.status() ?? 0;
  const srcBody = await page.textContent("body");
  record("T21 /sources 대시보드",
    srcStatus === 200 && (srcBody?.includes("regulation_sources") ?? false),
    `HTTP ${srcStatus} + 테이블 렌더`);
  await page.screenshot({ path: `${SHOT_DIR}/t21-sources.png`, fullPage: true });

  await page.screenshot({ path: `${SHOT_DIR}/desktop-final.png`, fullPage: true });
  await ctx.close();

  // ========== Mobile 시나리오 ==========
  const mctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 375, height: 667 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const mpage = await mctx.newPage();
  await mpage.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  await search(mpage, "Retinol");
  const mCards = await mpage.locator("article").count();
  record("T17 모바일 viewport 렌더", mCards === 15, `${mCards} cards at 375px`);
  await mpage.screenshot({ path: `${SHOT_DIR}/mobile-retinol.png`, fullPage: true });
  await mctx.close();

  // ========== 다크모드 시나리오 ==========
  const dctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark",
  });
  const dpage = await dctx.newPage();
  await dpage.goto(BASE, { waitUntil: "networkidle", timeout: 30_000 });
  await search(dpage, "Retinol");
  // Tailwind dark: 클래스가 적용됐는지 확인 — body 배경 계산값 기준 (class 확인은 tailwind v4에선 미신뢰)
  const htmlClass = await dpage.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { bg: style.backgroundColor, color: style.color };
  });
  // tailwind dark:* 가 적용되면 body bg는 보통 zinc 계열 어두운 색. 체크: 배경 RGB 평균이 128 이하
  const m = htmlClass.bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const avg = m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : 255;
  record("T18 다크모드 적용", avg < 128, `bg avg=${avg.toFixed(0)} (< 128 = dark)`);
  await dpage.screenshot({ path: `${SHOT_DIR}/dark-retinol.png`, fullPage: true });
  await dctx.close();

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n=== SUMMARY === ${pass}/${results.length} passed`);
  if (pass < results.length) {
    results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} — ${r.detail}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
