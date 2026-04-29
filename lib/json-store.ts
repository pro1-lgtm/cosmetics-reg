// Phase 5b — public/data/*.json 의 read/write 헬퍼.
// scripts/* (Node) 에서만 사용. atomic write (tmp → rename) 로 부분 실패 시
// 데이터 손상 방지. 클라이언트는 lib/data-loader.ts 가 별도로 fetch.

import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

export const DATA_DIR = "public/data";

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
  const payload = await readJson<DataPayload<T>>(`${DATA_DIR}/${name}.json`);
  return payload?.rows ?? [];
}

export async function writeRows<T>(name: string, rows: T[]): Promise<void> {
  await writeJson(`${DATA_DIR}/${name}.json`, {
    generated_at: new Date().toISOString(),
    rows,
  } satisfies DataPayload<T>);
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
