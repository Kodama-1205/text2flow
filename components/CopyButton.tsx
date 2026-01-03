"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CopyButton.module.css";

type Props = {
  label: string;
  value: string;
  className?: string;
};

export default function CopyButton({ label, value, className }: Props) {
  const [msg, setMsg] = useState<string>("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function copyText(text: string) {
    // 1) Clipboard API（基本）
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    // 2) フォールバック（古い環境/権限NG用）
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("copy_failed");
  }

  async function onClick() {
    // 空でも押せるが、意味がないので明示
    const v = String(value ?? "");
    if (!v) {
      setMsg("コピーする内容がありません");
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setMsg(""), 1600);
      return;
    }

    try {
      await copyText(v);
      setMsg("コピーしました");
    } catch {
      setMsg("コピーに失敗しました（ブラウザ権限を確認）");
    } finally {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setMsg(""), 1600);
    }
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.btn} ${className ?? ""}`}
        onClick={onClick}
      >
        {label}
      </button>

      {/* 親レイアウトに潰されないよう “通常フロー” で出す */}
      <div className={styles.msg} aria-live="polite">
        {msg}
      </div>
    </div>
  );
}
