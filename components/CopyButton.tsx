"use client";

import { useState } from "react";
import styles from "./CopyButton.module.css";

export default function CopyButton({
  label = "Copy",
  value,
}: {
  label?: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

  return (
    <button className={styles.btn} onClick={onCopy} type="button">
      {copied ? "Copied!" : label}
    </button>
  );
}
