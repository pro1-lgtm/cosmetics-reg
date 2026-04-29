// 100% 로컬 런처 — node scripts/launch.cjs (또는 npm start, start.bat 더블클릭).
//
// 자동으로:
//   1) node_modules 없으면 npm install
//   2) out/index.html 없으면 npm run build
//   3) http://localhost:3010 에 정적 서버 띄움
//   4) 기본 브라우저로 자동 진입
//   5) Ctrl+C 시 서버 종료
//
// tsx 의존 없이 vanilla Node 로 작성 — 첫 실행에도 작동.

const { existsSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { platform } = require("node:os");
const http = require("node:http");
const path = require("node:path");

const PORT = 3010;
const BASE = `http://localhost:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
process.chdir(ROOT);

const isWin = platform() === "win32";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWin });
  return r.status ?? 1;
}

function ensureInstalled() {
  if (existsSync("node_modules")) return;
  console.log("\n▶ 의존성 설치 중 (최초 1회, 1-2분 소요)...\n");
  if (run("npm", ["install"]) !== 0) {
    console.error("\n✗ npm install 실패. Node.js 가 설치돼 있는지 확인하세요 (https://nodejs.org).");
    process.exit(1);
  }
}

function ensureBuilt() {
  if (existsSync(path.join("out", "index.html"))) return;
  console.log("\n▶ 빌드 중 (최초 1회 또는 코드 변경 시, 30초~1분)...\n");
  if (run("npm", ["run", "build"]) !== 0) {
    console.error("\n✗ 빌드 실패.");
    process.exit(1);
  }
}

function openBrowser(url) {
  const cmd = isWin ? "cmd" : platform() === "darwin" ? "open" : "xdg-open";
  const args = isWin ? ["/c", "start", "", url] : [url];
  spawnSync(cmd, args, { stdio: "ignore", detached: true });
}

function waitReady() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tick = () => {
      attempts++;
      const req = http.get(BASE, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (attempts >= 60) reject(new Error("정적 서버 시작 실패 (30초 timeout)"));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function main() {
  console.log("=================================================");
  console.log("  cosmetics-reg — 화장품 원료 규제 검색");
  console.log("  100% 로컬 구동 (서버·인터넷 의존 0)");
  console.log("=================================================\n");

  ensureInstalled();
  ensureBuilt();

  console.log(`\n▶ 정적 서버 시작: ${BASE}`);
  const server = spawn("npx", ["--yes", "serve", "out", "-l", String(PORT), "-L"], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: isWin,
  });

  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n▶ 종료 중...");
    try { server.kill(); } catch {}
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  server.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`\n✗ 정적 서버가 예기치 않게 종료됨 (exit ${code})`);
      process.exit(code ?? 1);
    }
  });

  try {
    await waitReady();
  } catch (e) {
    console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
    shutdown(1);
    return;
  }

  console.log(`\n✓ 준비 완료 — 브라우저를 엽니다.`);
  console.log(`  주소: ${BASE}`);
  console.log(`  종료: 이 창에서 Ctrl+C 또는 창 닫기\n`);
  openBrowser(BASE);

  // server.exit 또는 SIGINT 까지 대기 — main 이 일찍 끝나면 child 도 같이 종료됨.
  await new Promise(() => {});
}

main().catch((e) => {
  console.error("\n✗ 시작 실패:", e);
  process.exit(1);
});
