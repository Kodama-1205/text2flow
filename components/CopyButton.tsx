"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CopyButton.module.css";

type Props = {
  label: string;
  value: string;
  className?: string;
};

export default function CopyButton({ label, value, className }: Props) {
  const [toast, setToast] = useState<string>("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function copyText(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
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

  function showToast(message: string) {
    setToast(message);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToast(""), 1600);
  }

  async function onClick() {
    const v = String(value ?? "");
    if (!v) {
      showToast("コピーする内容がありません");
      return;
    }
    try {
      await copyText(v);
      showToast("コピーしました");
    } catch {
      showToast("コピーに失敗しました（権限/HTTPSを確認）");
    }
  }

  // ★外からの className を優先（/result の smallBtn で色を統一できる）
  const btnClass = className ? className : styles.btn;

  return (
    <>
      <button type="button" className={btnClass} onClick={onClick}>
        {label}
      </button>

      {toast ? (
        <div className={styles.toast} aria-live="polite">
          {toast}
        </div>
      ) : null}
    </>
  );
}
