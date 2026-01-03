// /web/lib/flow-to-mermaid.ts

export type FlowNodeType = "start" | "end" | "task" | "decision";

export type FlowNode = {
  id: string;
  label: string;
  type: FlowNodeType;
  condition?: string;
};

export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
};

export type FlowJson = {
  title?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type DerivedCondition = { condition: string; yes?: string; no?: string };

function escLabel(s: string) {
  // Mermaidで崩れやすいものだけ最低限エスケープ
  return String(s).replace(/\r?\n/g, " ").replace(/"/g, '\\"');
}

function normalizeEdgeLabel(l?: string) {
  if (!l) return "";
  const t = l.trim().toLowerCase();
  if (t === "yes" || t === "y" || t === "true") return "Yes";
  if (t === "no" || t === "n" || t === "false") return "No";
  return l.trim();
}

function nodeToMermaid(n: FlowNode) {
  const label = escLabel(n.label);
  if (n.type === "start") return `${n.id}([${label}])`;
  if (n.type === "end") return `${n.id}([${label}])`;
  if (n.type === "decision") return `${n.id}{${label}}`;
  return `${n.id}[${label}]`;
}

/**
 * FlowJson -> Mermaid（flowchart）
 */
export function flowToMermaid(flow: FlowJson, orientation: "TD" | "LR" = "TD"): string {
  const dir = orientation === "LR" ? "LR" : "TD";
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];

  const lines: string[] = [];
  lines.push(`flowchart ${dir}`);

  for (const n of nodes) {
    lines.push(`  ${nodeToMermaid(n)}`);
  }

  for (const e of edges) {
    const lbl = normalizeEdgeLabel(e.label);
    if (lbl) lines.push(`  ${e.from} -- ${escLabel(lbl)} --> ${e.to}`);
    else lines.push(`  ${e.from} --> ${e.to}`);
  }

  return lines.join("\n");
}

/**
 * フローから「処理順」を導出（Yes→No 優先）
 * - UI側で「1. 」を除去している想定でも、番号付きで返してOK
 */
export function deriveSteps(flow: FlowJson): string[] {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];
  if (!nodes.length) return [];

  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));

  // ✅ ここが肝：Map を型付きで定義（noImplicitAny 対策）
  const out = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }

  const start = nodes.find((n) => n.type === "start") ?? nodes[0];

  const visited = new Set<string>();
  const order: string[] = [];

  const score = (lbl: string) => (lbl === "Yes" ? 0 : lbl === "No" ? 1 : 2);
  const sortOut = (list: FlowEdge[]) =>
    [...list].sort((a, b) => score(normalizeEdgeLabel(a.label)) - score(normalizeEdgeLabel(b.label)));

  const q: string[] = [start.id];

  while (q.length) {
    const id = q.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (node) order.push(node.label);

    if (node?.type === "end") continue;

    const outs: FlowEdge[] = out.get(id) ?? [];
    for (const e of sortOut(outs)) {
      if (!visited.has(e.to)) q.push(e.to);
    }
  }

  // 未到達ノードを最後に追加（孤立対策）
  for (const n of nodes) {
    if (!visited.has(n.id)) order.push(n.label);
  }

  // 番号付け
  return order.map((label, i) => `${i + 1}. ${label}`);
}

/**
 * decision の Yes/No 分岐先を導出
 */
export function deriveConditions(flow: FlowJson): DerivedCondition[] {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];

  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));

  // ✅ 型付きMap
  const out = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }

  const decisions = nodes.filter((n) => n.type === "decision");

  return decisions.map((d) => {
    const outs: FlowEdge[] = out.get(d.id) ?? [];
    const yes = outs.find((e) => normalizeEdgeLabel(e.label) === "Yes");
    const no = outs.find((e) => normalizeEdgeLabel(e.label) === "No");

    return {
      condition: d.condition ?? d.label,
      yes: yes ? nodeMap.get(yes.to)?.label : undefined,
      no: no ? nodeMap.get(no.to)?.label : undefined,
    };
  });
}
