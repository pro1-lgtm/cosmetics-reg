// Phase 5b — public/data/*.json 의 read/write 헬퍼.
// scripts/* (Node) 에서만 사용. atomic write (tmp → rename) 로 부분 실패 시
// 데이터 손상 방지. 클라이언트는 lib/data-loader.ts 가 별도로 fetch.
//
// "regulations" 는 special-case: 단일 파일이 GitHub 50MB 권장치를 넘어 split 됨.
// public/data/regulations/{cc}.json 으로 country_code 별 분할.

import { readFile, writeFile, rename, mkdir, stat, readdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const DATA_DIR = "public/data";
export const REGULATIONS_DIR = `${DATA_DIR}/regulations`;

export interface DataPayload<T> {
  generated_at: string;
  rows: T[];
}

export interface MetaPayload {
  generated_at: string;
  counts: {
    countries: number;
    ingredients: number;
    regulations: number;
    quarantine_pending: number;
    regulation_sources?: number;
    detected_changes_pending?: number;
  };
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(payload), "utf8");
  await rename(tmp, path);
}

export async function readRows<T>(name: string): Promise<T[]> {
  if (name === "regulations") return readRegulationsSplit<T>();
  const payload = await readJson<DataPayload<T>>(`${DATA_DIR}/${name}.json`);
  return payload?.rows ?? [];
}

export async function writeRows<T>(name: string, rows: T[]): Promise<void> {
  if (name === "regulations") {
    await writeRegulationsSplit(rows as Array<T & { country_code?: string }>);
    return;
  }
  await writeJson(`${DATA_DIR}/${name}.json`, {
    generated_at: new Date().toISOString(),
    rows,
  } satisfies DataPayload<T>);
}

// regulations 분할 read — public/data/regulations/{cc}.json 모두 합산.
async function readRegulationsSplit<T>(): Promise<T[]> {
  let files: string[];
  try {
    files = await readdir(REGULATIONS_DIR);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const all: T[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const p = await readJson<DataPayload<T>>(`${REGULATIONS_DIR}/${f}`);
    if (p?.rows) all.push(...p.rows);
  }
  return all;
}

// regulations 분할 write — country_code 로 group 후 각 group 파일 atomic rewrite.
// 어떤 country 에도 속하지 않는 row 는 error (country_code 누락 = 데이터 결함).
// 기존 cc 파일 중 새 group 에 없는 cc 는 삭제 (해당 국가 모든 row 가 사라진 경우).
async function writeRegulationsSplit<T extends { country_code?: string }>(rows: T[]): Promise<void> {
  await mkdir(REGULATIONS_DIR, { recursive: true });
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const cc = r.country_code;
    if (!cc) throw new Error("regulation row missing country_code");
    let g = groups.get(cc);
    if (!g) { g = []; groups.set(cc, g); }
    g.push(r);
  }
  // existing files 가운데 group 에 없는 cc 는 삭제 (drift 방지).
  let existingFiles: string[] = [];
  try { existingFiles = await readdir(REGULATIONS_DIR); } catch {}
  const generatedAt = new Date().toISOString();
  for (const [cc, list] of groups) {
    await writeJson(`${REGULATIONS_DIR}/${cc}.json`, {
      generated_at: generatedAt,
      rows: list,
    });
  }
  for (const f of existingFiles) {
    if (!f.endsWith(".json")) continue;
    const cc = f.replace(/\.json$/, "");
    if (!groups.has(cc)) {
      await unlink(`${REGULATIONS_DIR}/${f}`).catch(() => {});
    }
  }
}

export interface CountsForMeta {
  countries?: number;
  ingredients?: number;
  regulations?: number;
  quarantine_pending?: number;
  regulation_sources?: number;
  detected_changes_pending?: number;
}

/** 일부 카운트만 갱신 — 기존 값을 유지하면서 머지. */
export async function updateMeta(partial: CountsForMeta): Promise<MetaPayload> {
  const path = `${DATA_DIR}/meta.json`;
  const existing = await readJson<MetaPayload>(path);
  const merged: MetaPayload = {
    generated_at: new Date().toISOString(),
    counts: {
      countries: partial.countries ?? existing?.counts.countries ?? 0,
      ingredients: partial.ingredients ?? existing?.counts.ingredients ?? 0,
      regulations: partial.regulations ?? existing?.counts.regulations ?? 0,
      quarantine_pending: partial.quarantine_pending ?? existing?.counts.quarantine_pending ?? 0,
      regulation_sources: partial.regulation_sources ?? existing?.counts.regulation_sources,
      detected_changes_pending:
        partial.detected_changes_pending ?? existing?.counts.detected_changes_pending,
    },
  };
  await writeJson(path, merged);
  return merged;
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return null;
  }
}
