"use client";

import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import styles from "./page.module.css";

type Orientation = "TD" | "LR";
type Detail = "simple" | "detailed";

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

// 初期表示は“例”として見せたいだけなので、生成できない状態にする
const DEFAULT_EXAMPLE = `例）
1. 注文Excelを確認
2. 在庫と照合する
3. もし在庫が足りないなら：発注してSlack通知
4. そうでなければ：出荷準備へ進む
5. 終了`;

export default function InputPage() {
  // ★最初は空（例はplaceholderで表示）
  const [text, setText] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("TD");
  const [detail, setDetail] = useState<Detail>("simple");
  const [maxNodes, setMaxNodes] = useState(20);
  const [debug, setDebug] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const textCount = useMemo(() => text.trim().length, [text]);

  const canGenerate = useMemo(() => {
    // 何も入力されていない場合は生成不可（例としてのみ表示）
    return text.trim().length > 0;
  }, [text]);

  async function onGenerate() {
    setError("");
    const t = text.trim();

    // ★例だけの状態では生成させない
    if (!t) {
      setError("文章を入力するか、下のサンプルから選択してください。");
      return;
    }
    if (t.length > 6000) {
      setError("長すぎます（最大6000文字）。短くしてください。");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, orientation, detail, maxNodes, debug }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成に失敗しました");

      sessionStorage.setItem("text2flow:lastInputText", t);
      sessionStorage.setItem("text2flow:lastResult", JSON.stringify(data));
      sessionStorage.setItem(
        "text2flow:lastConfig",
        JSON.stringify({ orientation, detail, maxNodes, debug })
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
              </div>
            </div>
            <div className={styles.counter}>{textCount} chars</div>
          </div>

          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={DEFAULT_EXAMPLE}
          />

          <div className={styles.row}>
            <div className={styles.samples}>
              {samples.map((s) => (
                <button
                  key={s.name}
                  className={styles.pill}
                  type="button"
                  onClick={() => onSample(s.name)}
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
              disabled={loading || !canGenerate}
              title={!canGenerate ? "文章を入力するか、サンプルを選択してください" : ""}
            >
              {loading ? "Generating..." : "Generate Flow"}
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => setText("")}
              disabled={loading}
            >
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
              >
                縦（Top-Down）
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${orientation === "LR" ? styles.segOn : ""}`}
                onClick={() => setOrientation("LR")}
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
              >
                ざっくり
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${detail === "detailed" ? styles.segOn : ""}`}
                onClick={() => setDetail("detailed")}
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
              onChange={(e) => setMaxNodes(Number(e.target.value))}
            />
            <div className={styles.help}>暴走防止（MVPでも安定運用しやすい）。</div>
          </div>

          <div className={styles.field}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={debug}
                onChange={(e) => setDebug(e.target.checked)}
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
