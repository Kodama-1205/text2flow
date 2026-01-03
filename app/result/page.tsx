// /web/app/result/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import Tabs from "@/components/Tabs";
import MermaidRenderer from "@/components/MermaidRenderer";
import CopyButton from "@/components/CopyButton";
import styles from "./page.module.css";

type Result = {
  mermaid: string;
  steps: string[];
  conditions: Array<{ condition: string; yes?: string; no?: string }>;
  dify_template: string;
  explanation: string;
  flow_json: any;
  debug?: any;
};

type FlowNode = {
  id: string;
  label: string;
  type: "start" | "task" | "decision" | "end";
  condition?: string;
};

type FlowEdge = {
  from: string;
  to: string;
  label?: string;
};

type FlowJson = {
  title?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

const TAB_ITEMS = [
  { key: "steps", label: "処理順" },
  { key: "conditions", label: "条件分岐" },
  { key: "dify", label: "Dify雛形" },
  { key: "code", label: "Mermaidコード" },
  { key: "json", label: "JSON" },
  { key: "debug", label: "Debug" },
];

function safeParseJsonLoose(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/^\uFEFF/, "") // BOM
    .replace(/\u00A0/g, " ") // ★ NBSP
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim()
    // 末尾カンマ除去（配列/オブジェクト）
    .replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isFlowJson(v: any): v is FlowJson {
  return (
    v &&
    typeof v === "object" &&
    Array.isArray(v.nodes) &&
    Array.isArray(v.edges) &&
    v.nodes.every(
      (n: any) =>
        n &&
        typeof n === "object" &&
        typeof n.id === "string" &&
        typeof n.label === "string" &&
        (n.type === "start" || n.type === "task" || n.type === "decision" || n.type === "end")
    ) &&
    v.edges.every(
      (e: any) =>
        e &&
        typeof e === "object" &&
        typeof e.from === "string" &&
        typeof e.to === "string" &&
        (typeof e.label === "string" || typeof e.label === "undefined")
    )
  );
}

function mermaidEscapeLabel(s: string) {
  return String(s).replace(/\r?\n/g, " ").replace(/"/g, '\\"');
}

function nodeToMermaid(n: FlowNode) {
  const label = mermaidEscapeLabel(n.label);
  if (n.type === "start") return `${n.id}([${label}])`;
  if (n.type === "end") return `${n.id}([${label}])`;
  if (n.type === "decision") return `${n.id}{${label}}`;
  return `${n.id}[${label}]`;
}

function edgeLabelNormalize(l?: string) {
  if (!l) return "";
  const t = l.trim().toLowerCase();
  if (t === "yes" || t === "y" || t === "true") return "Yes";
  if (t === "no" || t === "n" || t === "false") return "No";
  return l.trim();
}

function buildMermaidFromFlow(flow: FlowJson, orientation: string) {
  const dir = orientation === "LR" ? "LR" : "TD";

  const nodes = flow.nodes ?? [];
  const edges = flow.edges ?? [];

  const lines: string[] = [];
  lines.push(`flowchart ${dir}`);

  for (const n of nodes) {
    lines.push(`  ${nodeToMermaid(n)}`);
  }

  for (const e of edges) {
    const lbl = edgeLabelNormalize(e.label);
    if (lbl) lines.push(`  ${e.from} -- ${mermaidEscapeLabel(lbl)} --> ${e.to}`);
    else lines.push(`  ${e.from} --> ${e.to}`);
  }

  return lines.join("\n");
}

function computeSteps(flow: FlowJson): string[] {
  const nodes = flow.nodes ?? [];
  const edges = flow.edges ?? [];
  if (!nodes.length) return [];

  const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));
  const outMap = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from)!.push(e);
  }

  const startNode = nodes.find((n) => n.type === "start") ?? nodes[0];
  const visited = new Set<string>();
  const order: string[] = [];

  function sortOutgoing(list: FlowEdge[]) {
    return [...list].sort((a, b) => {
      const al = edgeLabelNormalize(a.label);
      const bl = edgeLabelNormalize(b.label);
      const score = (x: string) => (x === "Yes" ? 0 : x === "No" ? 1 : 2);
      return score(al) - score(bl);
    });
  }

  const q: string[] = [startNode.id];
  while (q.length) {
    const id = q.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const n = nodeMap.get(id);
    if (n) order.push(n.label);

    const outs = outMap.get(id) ?? [];
    for (const e of sortOutgoing(outs)) {
      if (!visited.has(e.to)) q.push(e.to);
    }
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) order.push(n.label);
  }

  return order;
}

function computeConditions(flow: FlowJson): Array<{ condition: string; yes?: string; no?: string }> {
  const nodes = flow.nodes ?? [];
  const edges = flow.edges ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));
  const outMap = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from)!.push(e);
  }

  const decisions = nodes.filter((n) => n.type === "decision");
  return decisions.map((d) => {
    const outs = outMap.get(d.id) ?? [];
    const yesEdge = outs.find((e) => edgeLabelNormalize(e.label) === "Yes");
    const noEdge = outs.find((e) => edgeLabelNormalize(e.label) === "No");

    const yesLabel = yesEdge ? nodeMap.get(yesEdge.to)?.label : undefined;
    const noLabel = noEdge ? nodeMap.get(noEdge.to)?.label : undefined;

    return {
      condition: d.condition ?? d.label,
      yes: yesLabel,
      no: noLabel,
    };
  });
}

function readLastOrientation(): string {
  try {
    const configRaw = sessionStorage.getItem("text2flow:lastConfig");
    const config = configRaw ? JSON.parse(configRaw) : null;
    return config?.orientation === "LR" ? "LR" : "TD";
  } catch {
    return "TD";
  }
}

export default function ResultPage() {
  const [data, setData] = useState<Result | null>(null);
  const [tab, setTab] = useState("steps");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const canShowDebug = useMemo(() => !!data?.debug, [data]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("text2flow:lastResult");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setData(parsed);
      if (!parsed?.debug) setTab("steps");
    } catch {
      // ignore
    }
  }, []);

  const tabs = useMemo(() => {
    if (!canShowDebug) return TAB_ITEMS.filter((t) => t.key !== "debug");
    return TAB_ITEMS;
  }, [canShowDebug]);

  const repaired = useMemo(() => {
    if (!data) return { flow: null as FlowJson | null, usedRepair: false };

    const candidates: unknown[] = [
      data.flow_json,
      (data as any)?.flow_json_raw,
      (data as any)?.debug?.flow_json_raw,
      (data as any)?.debug?.flow_json,
      (data as any)?.debug?.raw,
      (data as any)?.debug?.dify_output,
    ];

    for (const c of candidates) {
      const parsed = safeParseJsonLoose(c);
      if (isFlowJson(parsed)) {
        const usedRepair = typeof c === "string" || /```/i.test(String(c ?? ""));
        return { flow: parsed, usedRepair };
      }
      if (isFlowJson(c)) return { flow: c, usedRepair: false };
    }

    return { flow: null, usedRepair: false };
  }, [data]);

  const computed = useMemo(() => {
    if (!repaired.flow) return null;
    const orientation = readLastOrientation();
    const mermaid = buildMermaidFromFlow(repaired.flow, orientation);
    const steps = computeSteps(repaired.flow);
    const conditions = computeConditions(repaired.flow);
    return { mermaid, steps, conditions, orientation };
  }, [repaired.flow]);

  async function onRegenerate() {
    setErr("");
    setBusy(true);
    try {
      const configRaw = sessionStorage.getItem("text2flow:lastConfig");
      const config = configRaw
        ? JSON.parse(configRaw)
        : { orientation: "TD", detail: "simple", maxNodes: 20, debug: false };

      const lastInput = sessionStorage.getItem("text2flow:lastInputText") || "";
      if (!lastInput.trim()) {
        setErr("元の入力が見つかりません。/input から再生成してください。");
        return;
      }

      const payload = {
        text: lastInput,
        orientation: config?.orientation ?? "TD",
        detail: config?.detail ?? "simple",
        maxNodes: config?.maxNodes ?? 20,
        debug: !!config?.debug,
      };

      const res = await fetch("/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const next = await res.json();
      if (!res.ok) throw new Error(next?.error ?? "再生成に失敗しました");

      sessionStorage.setItem("text2flow:lastResult", JSON.stringify(next));
      setData(next);
    } catch (e: any) {
      setErr(e?.message ?? "再生成に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function downloadSvg() {
    const svgEl = document.querySelector("#resultSvgHost svg") as SVGElement | null;
    if (!svgEl) {
      setErr("SVGが見つかりません（図の描画が完了しているか確認してください）");
      return;
    }
    const blob = new Blob([svgEl.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "text2flow.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) {
    return (
      <AppShell>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>結果がありません</div>
          <div className={styles.emptyText}>/input から生成して /result を開いてください。</div>
          <a className={styles.link} href="/input">
            入力画面へ戻る →
          </a>
        </div>
      </AppShell>
    );
  }

  const mermaidCode = computed?.mermaid ?? data.mermaid ?? "";
  const steps = computed?.steps ?? data.steps ?? [];
  const conditions = computed?.conditions ?? data.conditions ?? [];
  const flowForDisplay = computed?.mermaid ? repaired.flow : data.flow_json;
  const jsonText = JSON.stringify(flowForDisplay ?? {}, null, 2);

  return (
    <AppShell>
      <div className={styles.topbar}>
        <div>
          <div className={styles.title}>Generated Flow</div>
          <div className={styles.sub}>{data.explanation}</div>
        </div>

        <div className={styles.topActions}>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => (window.location.href = "/input")}
          >
            ← Edit
          </button>
          <button className={styles.primary} type="button" onClick={onRegenerate} disabled={busy}>
            {busy ? "Regenerating..." : "Regenerate"}
          </button>
        </div>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>Flow Diagram</div>
          <div className={styles.sectionActions}>
            <CopyButton label="Copy Mermaid" value={mermaidCode} />
            <button className={styles.smallBtn} type="button" onClick={downloadSvg}>
              Download SVG
            </button>
          </div>
        </div>

        <div id="resultSvgHost" className={styles.diagram}>
          <MermaidRenderer mermaid={mermaidCode} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>Details</div>
          <div className={styles.tabsWrap}>
            <Tabs items={tabs} activeKey={tab} onChange={setTab} />
          </div>
        </div>

        <div className={styles.panel}>
          {tab === "steps" && (
            <div>
              <div className={styles.panelTitle}>処理順</div>
              <ol className={styles.list}>
                {steps?.map((s, i) => (
                  <li key={i}>{String(s).replace(/^\d+\.\s*/, "")}</li>
                ))}
              </ol>
            </div>
          )}

          {tab === "conditions" && (
            <div>
              <div className={styles.panelTitle}>条件分岐</div>
              {conditions?.length ? (
                <div className={styles.conditions}>
                  {conditions.map((c, i) => (
                    <div className={styles.condCard} key={i}>
                      <div className={styles.condTitle}>{c.condition}</div>
                      <div className={styles.condRow}>
                        <span className={styles.yn}>Yes</span>
                        <span className={styles.condTo}>{c.yes ?? "（未設定）"}</span>
                      </div>
                      <div className={styles.condRow}>
                        <span className={styles.yn}>No</span>
                        <span className={styles.condTo}>{c.no ?? "（未設定）"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.muted}>条件分岐は検出されませんでした。</div>
              )}
            </div>
          )}

          {tab === "dify" && (
            <div>
              <div className={styles.panelHead2}>
                <div className={styles.panelTitle}>Difyワークフロー雛形</div>
                <CopyButton label="Copy" value={data.dify_template ?? ""} />
              </div>
              <pre className={styles.pre}>{data.dify_template}</pre>
            </div>
          )}

          {tab === "code" && (
            <div>
              <div className={styles.panelHead2}>
                <div className={styles.panelTitle}>Mermaidコード</div>
                <CopyButton label="Copy" value={mermaidCode} />
              </div>
              <pre className={styles.pre}>{mermaidCode}</pre>
            </div>
          )}

          {tab === "json" && (
            <div>
              <div className={styles.panelHead2}>
                <div className={styles.panelTitle}>flow_json</div>
                <CopyButton label="Copy" value={jsonText} />
              </div>
              <pre className={styles.pre}>{jsonText}</pre>
            </div>
          )}

          {tab === "debug" && (
            <div>
              <div className={styles.panelHead2}>
                <div className={styles.panelTitle}>Debug</div>
                <CopyButton label="Copy" value={JSON.stringify(data.debug ?? {}, null, 2)} />
              </div>
              <pre className={styles.pre}>{JSON.stringify(data.debug ?? {}, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
