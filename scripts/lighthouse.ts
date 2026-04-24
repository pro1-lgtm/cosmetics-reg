import { execSync } from "node:child_process";

const URL = process.argv[2] || "https://cosmetics-reg-tim10000.netlify.app";

const TARGETS: Record<string, number> = {
  performance: 70,
  accessibility: 90,
  "best-practices": 90,
  seo: 90,
};

interface LhReport {
  categories: Record<string, { score: number | null; title: string; auditRefs: { id: string }[] }>;
  audits: Record<string, { score: number | null; title: string; displayValue?: string }>;
}

async function main() {
  console.log(`Lighthouse: ${URL}`);
  // Lighthouse CLI는 Windows에서 temp 정리 중 EPERM으로 non-zero exit 가능. stdout의 JSON은
  // 정상. exception.stdout 경유로 우회.
  let json = "";
  try {
    json = execSync(
      `npx lighthouse "${URL}" --quiet --output=json --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices,seo`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 50 * 1024 * 1024 },
    );
  } catch (e) {
    const err = e as { stdout?: string };
    if (err.stdout && err.stdout.length > 1000) {
      json = err.stdout;
    } else {
      throw e;
    }
  }

  const report = JSON.parse(json) as LhReport;

  console.log("\n=== 점수 (0-100) ===");
  let allPass = true;
  for (const [key, target] of Object.entries(TARGETS)) {
    const cat = report.categories[key];
    const score = cat?.score != null ? Math.round(cat.score * 100) : null;
    const ok = score != null && score >= target;
    if (!ok) allPass = false;
    console.log(`  ${ok ? "✅" : "❌"} ${key.padEnd(16)}: ${score ?? "?"} (target ≥ ${target})`);
  }

  console.log("\n=== 핵심 지표 ===");
  const metricIds = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"];
  for (const id of metricIds) {
    const a = report.audits[id];
    if (!a) continue;
    console.log(`  ${id.padEnd(26)}: ${a.displayValue ?? "-"}`);
  }

  console.log("\n=== 실패 audit 상위 5 ===");
  const failed: { id: string; title: string; category: string }[] = [];
  for (const cat of Object.keys(TARGETS)) {
    const refs = report.categories[cat]?.auditRefs ?? [];
    for (const ref of refs) {
      const a = report.audits[ref.id];
      if (!a || a.score === null || a.score >= 0.9) continue;
      failed.push({ id: ref.id, title: a.title, category: cat });
    }
  }
  failed.slice(0, 5).forEach((f) => console.log(`  [${f.category}] ${f.id}: ${f.title}`));

  if (!allPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
