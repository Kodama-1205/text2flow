"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import styles from "./page.module.css";

type Orientation = "TD" | "LR";
type Detail = "simple" | "detailed";

const STORAGE_INPUT = "text2flow:lastInputText";
const STORAGE_CONFIG = "text2flow:lastConfig";
const STORAGE_RESULT = "text2flow:lastResult";

const samples = [
  {
    name: "在庫・注文・Slack通知",
    text: `① 注文Excelを確認
② 在庫と照合
③ 不足分をSlack通知`,
  },
  {
    name: "問い合わせ対応（分岐あり）",
    text: `1. 問い合わせを受け取る
2. 内容を分類する（請求/不具合/その他）
3. もし請求なら：担当へエスカレーション
4. もし不具合なら：再現確認してチケット起票
5. それ以外：テンプレ回答してクローズ`,
  },
  {
    name: "週次レポート作成",
    text: `・注文ファイルを集計する
・カテゴリ別に売上を集約する
・グラフを作成する
・Slackに送信する`,
  },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function InputPage() {
  const [text, setText] = useState(samples[0].text);
  const [orientation, setOrientation] = useState<Orientation>("TD");
  const [detail, setDetail] = useState<Detail>("simple");
  const [maxNodes, setMaxNodes] = useState(20);
  const [debug, setDebug] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const textCount = useMemo(() => text.trim().length, [text]);

  // 初期復元（前回入力・前回設定）
  useEffect(() => {
    const lastText = sessionStorage.getItem(STORAGE_INPUT);
    if (lastText && lastText.trim()) setText(lastText);

    const cfg = safeParseJson<{
      orientation?: Orientation;
      detail?: Detail;
      maxNodes?: number;
      debug?: boolean;
    }>(sessionStorage.getItem(STORAGE_CONFIG));

    if (cfg) {
      if (cfg.orientation === "TD" || cfg.orientation === "LR") setOrientation(cfg.orientation);
      if (cfg.detail === "simple" || cfg.detail === "detailed") setDetail(cfg.detail);
      if (typeof cfg.maxNodes === "number") setMaxNodes(clamp(cfg.maxNodes, 5, 40));
      if (typeof cfg.debug === "boolean") setDebug(cfg.debug);
    }
  }, []);

  // 設定は都度保存（/result → Edit で戻っても維持）
  useEffect(() => {
    sessionStorage.setItem(
      STORAGE_CONFIG,
      JSON.stringify({ orientation, detail, maxNodes: clamp(maxNodes, 5, 40), debug })
    );
  }, [orientation, detail, maxNodes, debug]);

  async function onGenerate() {
    if (loading) return; // 二重送信防止
    setError("");

    const t = text.trim();
    if (!t) {
      setError("文章を入力してください。");
      return;
    }
    if (t.length > 6000) {
      setError("長すぎます（最大6000文字）。短くしてください。");
      return;
    }

    const safeMaxNodes = clamp(Number.isFinite(maxNodes) ? maxNodes : 20, 5, 40);

    setLoading(true);
    try {
      const res = await fetch("/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: t,
          orientation,
          detail,
          maxNodes: safeMaxNodes,
          debug,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "生成に失敗しました");

      // 再生成に必要な入力も保存
      sessionStorage.setItem(STORAGE_INPUT, t);
      sessionStorage.setItem(STORAGE_RESULT, JSON.stringify(data));
      sessionStorage.setItem(
        STORAGE_CONFIG,
        JSON.stringify({ orientation, detail, maxNodes: safeMaxNodes, debug })
      );

      window.location.href = "/result";
    } catch (e: any) {
      setError(e?.message ?? "生成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function onSample(name: string) {
    const s = samples.find((x) => x.name === name);
    if (s) {
      setText(s.text);
      setError("");
      sessionStorage.setItem(STORAGE_INPUT, s.text);
    }
  }

  function onClear() {
    if (loading) return;
    setText("");
    setError("");
    sessionStorage.removeItem(STORAGE_INPUT);
    sessionStorage.removeItem(STORAGE_RESULT);
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd + Enter で生成
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onGenerate();
    }
  }

  return (
    <AppShell>
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <div className={styles.h1}>文章を入力</div>
              <div className={styles.sub}>
                箇条書き・番号付きOK。条件分岐（もし〜なら/場合/そうでなければ）も拾います。
                <span style={{ opacity: 0.8, marginLeft: 8 }}>（Ctrl/Cmd + Enterで生成）</span>
              </div>
            </div>
            <div className={styles.counter}>{textCount} chars</div>
          </div>

          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="例）① 注文Excelを確認 ② 在庫と照合 ③ 不足分をSlack通知"
            disabled={loading}
          />

          <div className={styles.row}>
            <div className={styles.samples}>
              {samples.map((s) => (
                <button
                  key={s.name}
                  className={styles.pill}
                  type="button"
                  onClick={() => onSample(s.name)}
                  disabled={loading}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              onClick={onGenerate}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate Flow"}
            </button>
            <button className={styles.secondary} type="button" onClick={onClear} disabled={loading}>
              Clear
            </button>
          </div>
        </section>

        <aside className={styles.card}>
          <div className={styles.h2}>オプション</div>

          <div className={styles.field}>
            <div className={styles.label}>図の向き</div>
            <div className={styles.seg}>
              <button
                type="button"
                className={`${styles.segBtn} ${orientation === "TD" ? styles.segOn : ""}`}
                onClick={() => setOrientation("TD")}
                disabled={loading}
              >
                縦（Top-Down）
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${orientation === "LR" ? styles.segOn : ""}`}
                onClick={() => setOrientation("LR")}
                disabled={loading}
              >
                横（Left-Right）
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.label}>詳細度</div>
            <div className={styles.seg}>
              <button
                type="button"
                className={`${styles.segBtn} ${detail === "simple" ? styles.segOn : ""}`}
                onClick={() => setDetail("simple")}
                disabled={loading}
              >
                ざっくり
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${detail === "detailed" ? styles.segOn : ""}`}
                onClick={() => setDetail("detailed")}
                disabled={loading}
              >
                詳細
              </button>
            </div>
            <div className={styles.help}>
              ※ Dify側のプロンプトで粒度を調整する想定（このUIは最初から搭載）。
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.label}>最大ノード数</div>
            <input
              className={styles.input}
              type="number"
              min={5}
              max={40}
              value={maxNodes}
              onChange={(e) => setMaxNodes(clamp(Number(e.target.value || 0), 5, 40))}
              disabled={loading}
            />
            <div className={styles.help}>暴走防止（MVPでも安定運用しやすい）。</div>
          </div>

          <div className={styles.field}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={debug}
                onChange={(e) => setDebug(e.target.checked)}
                disabled={loading}
              />
              <span>デバッグ情報を出力（開発用）</span>
            </label>
          </div>

          <div className={styles.note}>
            <div className={styles.noteTitle}>Dify連携について</div>
            <div className={styles.noteText}>
              APIキー未設定でもモックで動きます。Dify連携は /api/flow 経由で行い、キーはフロントに出しません。
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
