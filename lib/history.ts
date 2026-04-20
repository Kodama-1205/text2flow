// lib/history.ts
// localStorage ベースの結果保存ユーティリティ

export type HistoryItem = {
  id: string;
  saved_at: string; // ISO 8601
  input_text: string;
  explanation: string;
  config: {
    orientation: "TD" | "LR";
    detail: "simple" | "detailed";
    maxNodes: number;
  };
  flow_json: any;
  mermaid: string;
  steps: string[];
  conditions: Array<{ condition: string; yes?: string; no?: string }>;
};

const STORAGE_KEY = "text2flow:history";
const MAX_ITEMS = 50;

function load(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: HistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage 容量超過などは無視
  }
}

/** 新しい順で全件返す */
export function getHistory(): HistoryItem[] {
  return load().sort(
    (a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()
  );
}

/** 結果を保存して追加後の履歴を返す */
export function saveResult(item: Omit<HistoryItem, "id" | "saved_at">): HistoryItem[] {
  const items = load();
  const newItem: HistoryItem = {
    ...item,
    id: crypto.randomUUID(),
    saved_at: new Date().toISOString(),
  };
  items.unshift(newItem);
  // 上限超えたら古いものを切り捨て
  save(items.slice(0, MAX_ITEMS));
  return getHistory();
}

/** 1件削除 */
export function deleteResult(id: string): HistoryItem[] {
  const items = load().filter((x) => x.id !== id);
  save(items);
  return getHistory();
}

/** 全件削除 */
export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
