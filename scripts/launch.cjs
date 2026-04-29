// 100% 로컬 런처 — node scripts/launch.cjs (또는 npm start, start.bat 더블클릭).
// 자동: 의존성 설치 → 데이터 다운로드 → 빌드 → 정적 서버 → 브라우저.
// tsx 의존 없이 vanilla Node — 첫 실행에도 작동.

const { existsSync, mkdirSync } = require("node:fs");
const { writeFile } = require("node:fs/promises");
const { spawn, spawnSync } = require("node:child_process");
const { platform } = require("node:os");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const PORT = 3010;
const BASE = `http://localhost:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const DATA_FILES = ["meta.json", "countries.json", "ingredients.json", "regulations.json", "quarantine.json"];
const DATA_BASE_URL = "https://raw.githubusercontent.com/pro1-lgtm/cosmetics-reg/main/public/data";
process.chdir(ROOT);

const isWin = platform() === "win32";

// Windows 에선 npm/npx 가 .cmd 래퍼. Node 22+ 의 BatBadBut 패치로 .cmd 직접 spawn 은
// EINVAL. shell:true + args 배열 조합은 DEP0190 warning. cmd.exe /c 로 감싸는 방식은
// shell:false 유지 + EINVAL 회피 + 경고 0.
function spawnCmd(executable, args, opts) {
  if (isWin) return spawn("cmd.exe", ["/c", executable, ...args], { ...opts, shell: false });
  return spawn(executable, args, { ...opts, shell: false });
}
function spawnSyncCmd(executable, args, opts) {
  if (isWin) return spawnSync("cmd.exe", ["/c", executable, ...args], { ...opts, shell: false });
  return spawnSync(executable, args, { ...opts, shell: false });
}

function run(cmd, args) {
  const r = spawnSyncCmd(cmd, args, { stdio: "inherit" });
  return r.status ?? 1;
}

function ensureInstalled() {
  if (existsSync("node_modules")) return;
  console.log("의존성 설치 중 (1-2분)...");
  if (run("npm", ["install"]) !== 0) {
    console.error("npm install 실패.");
    process.exit(1);
  }
}

function ensureBuilt() {
  if (existsSync(path.join("out", "index.html"))) return;
  console.log("빌드 중 (~30초)...");
  if (run("npm", ["run", "build"]) !== 0) {
    console.error("빌드 실패.");
    process.exit(1);
  }
}

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("too many redirects"));
    https
      .get(url, { headers: { "User-Agent": "cosmetics-reg-launcher" } }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          return downloadFile(res.headers.location, dest, redirectCount + 1).then(resolve).catch(reject);
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${code}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => writeFile(dest, Buffer.concat(chunks)).then(resolve).catch(reject));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function ensureData() {
  if (existsSync(path.join(DATA_DIR, "meta.json"))) return;
  console.log("데이터 다운로드 중 (~10MB)...");
  mkdirSync(DATA_DIR, { recursive: true });
  for (const f of DATA_FILES) {
    try {
      await downloadFile(`${DATA_BASE_URL}/${f}`, path.join(DATA_DIR, f));
    } catch (e) {
      console.error(`데이터 다운로드 실패 (${f}): ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  }
}

function openBrowser(url) {
  if (isWin) {
    spawn("cmd.exe", ["/c", "start", "", url], { stdio: "ignore", shell: false, detached: true }).unref();
  } else {
    const cmd = platform() === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", shell: false, detached: true }).unref();
  }
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
        if (attempts >= 60) reject(new Error("server timeout"));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function main() {
  ensureInstalled();
  await ensureData();
  ensureBuilt();

  const server = spawnCmd("npx", ["--yes", "serve", "out", "-l", String(PORT), "-L"], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { server.kill(); } catch {}
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  server.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`server stopped (exit ${code})`);
      process.exit(code ?? 1);
    }
  });

  try {
    await waitReady();
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : e}`);
    shutdown(1);
    return;
  }

  console.log(`${BASE}  (Ctrl+C 종료)`);
  openBrowser(BASE);

  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
