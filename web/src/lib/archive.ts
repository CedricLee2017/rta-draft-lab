/**
 * 存檔：把抓過的玩家資料留在瀏覽器（IndexedDB），可整批匯出成 JSON、
 * 換裝置時再匯入（例如電腦 → 手機），不需要重新抓。
 *
 * 資料格式與 Worker API 回傳的 MatchPayload 完全相同，
 * 匯出檔可以直接看得懂，也可以再匯入。
 */

import { get, keys, set } from "idb-keyval";
import type { MatchPayload } from "./types";

const PREFIX = "rta:";

export interface ArchiveBundle {
  app: "rta-draft-lab";
  version: 1;
  exportedAt: string;
  items: MatchPayload[];
}

/**
 * IndexedDB 有時會被其他分頁／刪除請求鎖住而永遠不回應，
 * 所有存取都加上逾時，寧可當作「沒有存檔」也不要讓畫面卡住。
 */
const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

const isPayload = (v: unknown): v is MatchPayload => {  if (!v || typeof v !== "object") return false;
  const p = v as Partial<MatchPayload>;
  return (
    !!p.player &&
    typeof p.player.id === "number" &&
    Number.isInteger(p.player.id) &&
    Number.isInteger(p.season) &&
    Array.isArray(p.matches)
  );
};

/** 目前存在瀏覽器的所有存檔（依抓取時間新到舊） */
export async function listArchives(): Promise<MatchPayload[]> {
  const ks = await withTimeout<IDBValidKey[]>(keys(), 1500, []);
  if (!ks.length) return [];

  const out: MatchPayload[] = [];
  for (const k of ks) {
    if (typeof k !== "string" || !k.startsWith(PREFIX)) continue;
    const p = await withTimeout<MatchPayload | undefined>(
      get<MatchPayload>(k),
      500,
      undefined,
    );
    if (isPayload(p)) out.push(p);
  }
  return out.sort((a, b) => (Date.parse(b.fetchedAt) || 0) - (Date.parse(a.fetchedAt) || 0));
}

export function makeBundle(items: MatchPayload[]): ArchiveBundle {
  return {
    app: "rta-draft-lab",
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
  };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 觸發瀏覽器下載（手機 Safari/Chrome 會存到「檔案」或詢問位置） */
export function downloadJson(items: MatchPayload[], name?: string): string {
  const bundle = makeBundle(items);
  const text = JSON.stringify(bundle);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename =
    name ??
    (items.length === 1
      ? `rta-${items[0].player.id}-S${items[0].season}-${stamp()}.json`
      : `rta-archive-${stamp()}.json`);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

/** 解析匯入檔（支援單筆 payload 或整包 archive） */
export function parseBundle(text: string): MatchPayload[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 檔");
  }

  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as ArchiveBundle).items)
      ? (raw as ArchiveBundle).items
      : isPayload(raw)
        ? [raw]
        : [];

  const ok = list.filter(isPayload);
  if (!ok.length) throw new Error("檔案裡找不到對戰紀錄");
  return ok;
}

/** 寫回 IndexedDB（同玩家同賽季會覆蓋成檔案裡的版本） */
export async function saveImported(items: MatchPayload[]): Promise<void> {
  for (const p of items) {
    await withTimeout(set(`${PREFIX}${p.player.id}:${p.season}`, p), 1500, undefined);
  }
}

export function totalMatches(items: MatchPayload[]): number {
  return items.reduce((n, p) => n + (p.matches?.length ?? 0), 0);
}
