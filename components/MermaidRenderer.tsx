"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import styles from "./MermaidRenderer.module.css";

type Props = { mermaid: string };

export default function MermaidRenderer({ mermaid }: Props) {
  const id = useMemo(() => `mmd-${nanoid(8)}`, []);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function render() {
      setErr("");
      setSvg("");
      setLoading(true);

      try {
        const mermaidMod = await import("mermaid");
        const mermaidLib = mermaidMod.default;

        mermaidLib.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "strict",
          flowchart: {
            curve: "basis",
            padding: 24,
            useMaxWidth: true,
            htmlLabels: true,
          },
          themeVariables: {
            background: "#0f0b1e",
            primaryColor: "#6d28d9",
            primaryTextColor: "#ffffff",
            primaryBorderColor: "#7c3aed",
            lineColor: "#a78bfa",
            secondaryColor: "#1e1640",
            tertiaryColor: "#0f0b1e",
            edgeLabelBackground: "#1a1340",
            clusterBkg: "#1a1340",
            titleColor: "#e2d9fa",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif',
            fontSize: "14px",
          },
        });

        const { svg } = await mermaidLib.render(id, mermaid);
        if (!mounted) return;
        setSvg(svg);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Mermaid render failed");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    render();
    return () => {
      mounted = false;
    };
  }, [id, mermaid]);

  useEffect(() => {
    if (!hostRef.current) return;
    hostRef.current.innerHTML = svg || "";
  }, [svg]);

  return (
    <div className={styles.wrap}>
      {err ? (
        <div className={styles.error}>
          <div className={styles.errorTitle}>図の描画に失敗しました</div>
          <div className={styles.errorText}>{err}</div>
        </div>
      ) : loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <div className={styles.loadingText}>フロー図を描画中...</div>
        </div>
      ) : (
        <div ref={hostRef} className={styles.canvas} />
      )}
    </div>
  );
}
