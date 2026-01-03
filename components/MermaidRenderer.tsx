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

  useEffect(() => {
    let mounted = true;

    async function render() {
      setErr("");
      setSvg("");

      try {
        const mermaidMod = await import("mermaid");
        const mermaidLib = mermaidMod.default;

        mermaidLib.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          flowchart: { curve: "basis" },
          themeVariables: {
            primaryColor: "#1a1330",
            primaryTextColor: "#ffffff",
            primaryBorderColor: "#a78bfa",
            lineColor: "#a78bfa",
            secondaryColor: "#100c20",
            tertiaryColor: "#0b0b14",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif',
          },
        });

        const { svg } = await mermaidLib.render(id, mermaid);
        if (!mounted) return;
        setSvg(svg);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Mermaid render failed");
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
      ) : (
        <div ref={hostRef} className={styles.canvas} />
      )}
    </div>
  );
}
