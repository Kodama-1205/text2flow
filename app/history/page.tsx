"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import MermaidRenderer from "@/components/MermaidRenderer";
import { getHistory, deleteResult, clearHistory, type HistoryItem } from "@/lib/history";
import styles from "./page.module.css";
import toastStyles from "@/components/CopyButton.module.css";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function nodeCount(item: HistoryItem) {
  return Array.isArray(item.flow_json?.nodes) ? item.flow_json.nodes.length : 0;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [viewItem, setViewItem] = useState<HistoryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    setItems(getHistory());
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }

  function handleDelete(id: string) {
    setItems(deleteResult(id));
    if (viewItem?.id === id) setViewItem(null);
    showToast("削除しました");
  }

  function handleClearAll() {
    clearHistory();
    setItems([]);
    setConfirmClear(false);
    showToast("全件削除しました");
  }

  function openInResult(item: HistoryItem) {
    try {
      sessionStorage.setItem("text2flow:lastInputText", item.input_text);
      sessionStorage.setItem(
        "text2flow:lastResult",
        JSON.stringify({
          flow_json: item.flow_json,
          mermaid: item.mermaid,
          steps: item.steps,
          conditions: item.conditions,
          explanation: item.explanation,
        })
      );
      sessionStorage.setItem(
        "text2flow:lastConfig",
        JSON.stringify(item.config)
      );
    } catch {
      // ignore
    }
    window.location.href = "/result";
  }

  return (
    <AppShell>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>保存済み結果</div>
          <div className={styles.sub}>{items.length} 件保存されています</div>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.navBtn} href="/input">
            ← 入力
          </a>
          {items.length > 0 && (
            <button
              className={styles.dangerBtn}
              type="button"
              onClick={() => setConfirmClear(true)}
            >
              全件削除
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>保存された結果がありません</div>
          <div className={styles.emptyText}>
            結果ページで「保存する」を押すとここに表示されます。
          </div>
          <a className={styles.link} href="/input">
            入力画面へ →
          </a>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div key={item.id} className={styles.card}>
              <div className={styles.cardMeta}>
                <span className={styles.date}>{formatDate(item.saved_at)}</span>
                <span className={styles.badge}>{nodeCount(item)} ノード</span>
                <span className={styles.badge}>
                  {item.config.orientation === "LR" ? "横" : "縦"}
                </span>
                <span className={styles.badge}>
                  {item.config.detail === "detailed" ? "詳細" : "ざっくり"}
                </span>
              </div>

              <p className={styles.preview}>
                {item.input_text.slice(0, 100)}
                {item.input_text.length > 100 ? "…" : ""}
              </p>

              <div className={styles.cardActions}>
                <button
                  className={styles.ghostBtn}
                  type="button"
                  onClick={() => setViewItem(item)}
                >
                  プレビュー
                </button>
                <button
                  className={styles.primaryBtn}
                  type="button"
                  onClick={() => openInResult(item)}
                >
                  結果ページで開く
                </button>
                <button
                  className={styles.deleteBtn}
                  type="button"
                  onClick={() => handleDelete(item.id)}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* プレビューモーダル */}
      {viewItem && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                {viewItem.input_text.slice(0, 50)}
                {viewItem.input_text.length > 50 ? "…" : ""}
              </div>
              <button
                className={styles.closeBtn}
                type="button"
                onClick={() => setViewItem(null)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <div className={styles.modalMeta}>{formatDate(viewItem.saved_at)}</div>
            <div className={styles.modalDiagram}>
              <MermaidRenderer mermaid={viewItem.mermaid} />
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.primaryBtn}
                type="button"
                onClick={() => { openInResult(viewItem); setViewItem(null); }}
              >
                結果ページで開く
              </button>
              <button
                className={styles.deleteBtn}
                type="button"
                onClick={() => handleDelete(viewItem.id)}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全件削除確認モーダル */}
      {confirmClear && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.confirmModal}>
            <div className={styles.modalTitle}>全件削除しますか？</div>
            <p className={styles.confirmText}>
              保存済み {items.length} 件が削除されます。この操作は取り消せません。
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.ghostBtn}
                type="button"
                onClick={() => setConfirmClear(false)}
              >
                キャンセル
              </button>
              <button
                className={styles.dangerBtn}
                type="button"
                onClick={handleClearAll}
              >
                全件削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={toastStyles.toast} aria-live="polite">
          {toast}
        </div>
      )}
    </AppShell>
  );
}
