import type { Flow } from "./flow-schema";

/**
 * Mermaidのラベルで壊れやすい記号を除去/置換
 * - []{}()| は構文に使われるので避ける
 * - 改行はスペースに
 */
function sanitizeLabel(s: string) {
  return (s ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\n", " ")
    .replaceAll("[", "［")
    .replaceAll("]", "］")
    .replaceAll("{", "｛")
    .replaceAll("}", "｝")
    .replaceAll("(", "（")
    .replaceAll(")", "）")
    .replaceAll("|", "｜")
    .trim();
}

/**
 * MermaidのIDは英数字/アンダースコアが安全。
 * Dify等から日本語IDが来ても壊れないように変換して使う。
 */
function safeId(raw: string) {
  let id = (raw ?? "").trim();
  if (!id) id = "n";
  id = id.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(id)) id = `n_${id}`;
  return id;
}

function normEdgeLabel(s: string) {
  return (s ?? "").trim().toLowerCase();
}

function isYesLabel(s: string) {
  const t = normEdgeLabel(s);
  return (
    t.includes("yes") ||
    t === "y" ||
    t.includes("true") ||
    t.includes("はい") ||
    t.includes("有") ||
    t.includes("あり") ||
    t.includes("不足あり") ||
    t.includes("在庫不足") // ざっくり吸収
  );
}

function isNoLabel(s: string) {
  const t = normEdgeLabel(s);
  return (
    t.includes("no") ||
    t === "n" ||
    t.includes("false") ||
    t.includes("いいえ") ||
    t.includes("無") ||
    t.includes("なし") ||
    t.includes("不足なし")
  );
}

export function flowToMermaid(flow: Flow, orientation: "TD" | "LR" = "TD") {
  const lines: string[] = [];
  lines.push(`flowchart ${orientation}`);

  // 変換マップ（元ID → Mermaid安全ID）
  const idMap = new Map<string, string>();
  for (const n of flow.nodes) {
    idMap.set(n.id, safeId(n.id));
  }

  // Node定義
  for (const n of flow.nodes) {
    const mid = idMap.get(n.id)!;
    const label = sanitizeLabel(n.label);

    if (n.type === "decision") {
      lines.push(`  ${mid}{${label}}`);
    } else if (n.type === "start" || n.type === "end") {
      lines.push(`  ${mid}([${label}])`);
    } else {
      lines.push(`  ${mid}[${label}]`);
    }
  }

  // Edge定義
  const edges = flow.edges ?? [];
  for (const e of edges) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to) continue;

    if (e.label) {
      const el = sanitizeLabel(e.label);
      lines.push(`  ${from} -->|${el}| ${to}`);
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
  }

  // スタイル
  lines.push("");
  lines.push("  classDef task fill:#120c24,stroke:#a78bfa,stroke-width:1px,color:#fff;");
  lines.push("  classDef decision fill:#1a1330,stroke:#a78bfa,stroke-width:1px,color:#fff;");
  lines.push("  classDef terminal fill:#0f0b1f,stroke:#a78bfa,stroke-width:1px,color:#fff;");
  lines.push("");

  for (const n of flow.nodes) {
    const mid = idMap.get(n.id)!;
    if (n.type === "decision") lines.push(`  class ${mid} decision;`);
    else if (n.type === "start" || n.type === "end") lines.push(`  class ${mid} terminal;`);
    else lines.push(`  class ${mid} task;`);
  }

  return lines.join("\n");
}

/**
 * ✅ “読みやすい処理順”を作る
 * - 以前: トポロジカルソート（分岐の順が人間の感覚とズレやすい）
 * - 変更: start から辿り、decision は Yes/No を明示して並べる
 *   例:
 *   1. 開始
 *   2. 注文Excelを確認
 *   3. 在庫と照合
 *   4. 在庫不足か
 *   5. Yes: 発注
 *   6. Yes: Slackに通知
 *   7. No: 出荷準備へ
 *   8. 終了
 */
export function deriveSteps(flow: Flow): string[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = flow.edges ?? [];

  // adjacency
  const out = new Map<string, Array<{ to: string; label?: string }>>();
  for (const n of flow.nodes) out.set(n.id, []);
  for (const e of edges) out.get(e.from)?.push({ to: e.to, label: e.label });

  const startNode =
    flow.nodes.find((n) => n.type === "start") ??
    flow.nodes.find((n) => (out.get(n.id)?.length ?? 0) > 0) ??
    flow.nodes[0];

  const endNode = flow.nodes.find((n) => n.type === "end");
  const stopId = endNode?.id;

  // 分岐対応のトラバース（stopId は末尾で1回だけ出す）
  function expandFrom(startId: string | undefined, prefix: string, localStopId?: string): string[] {
    if (!startId) return [];
    if (localStopId && startId === localStopId) return [];

    const res: string[] = [];
    const visited = new Set<string>();
    let id: string | undefined = startId;

    while (id && !(localStopId && id === localStopId) && !visited.has(id)) {
      visited.add(id);

      const node = byId.get(id);
      if (!node) break;

      res.push(`${prefix}${node.label}`);

      const outs = out.get(id) ?? [];
      if (node.type === "end") break;

      // decision or multi-out: 分岐として扱う
      if (node.type === "decision" || outs.length > 1) {
        const yesEdge = outs.find((o) => isYesLabel(o.label ?? ""));
        const noEdge = outs.find((o) => isNoLabel(o.label ?? ""));

        const used = new Set<string>();
        const y = yesEdge ?? outs[0];
        const n = noEdge ?? outs.find((x) => x !== y) ?? outs[1];

        if (y) {
          used.add(`${y.to}:${y.label ?? ""}`);
          res.push(...expandFrom(y.to, `${prefix}Yes: `, localStopId));
        }
        if (n) {
          used.add(`${n.to}:${n.label ?? ""}`);
          res.push(...expandFrom(n.to, `${prefix}No: `, localStopId));
        }

        // それ以外の枝（万一）
        for (const o of outs) {
          if (used.has(`${o.to}:${o.label ?? ""}`)) continue;
          const tag = o.label ? sanitizeLabel(o.label) : "Branch";
          res.push(...expandFrom(o.to, `${prefix}${tag}: `, localStopId));
        }

        break;
      }

      // linear
      if (outs.length === 1) {
        id = outs[0].to;
        continue;
      }

      break;
    }

    return res;
  }

  const labels = expandFrom(startNode?.id, "", stopId);
  if (endNode) labels.push(endNode.label);

  // 空のときの保険
  const final = labels.length ? labels : flow.nodes.map((n) => n.label);

  return final.map((t, i) => `${i + 1}. ${t}`);
}

export function deriveConditions(flow: Flow) {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = flow.edges ?? [];
  const result: Array<{ condition: string; yes?: string; no?: string }> = [];

  for (const n of flow.nodes) {
    if (n.type !== "decision") continue;

    const outs = edges.filter((e) => e.from === n.id);
    const yes = outs.find((o) => isYesLabel(o.label ?? ""));
    const no = outs.find((o) => isNoLabel(o.label ?? ""));

    result.push({
      condition: n.condition ?? n.label,
      yes: yes ? byId.get(yes.to)?.label : undefined,
      no: no ? byId.get(no.to)?.label : undefined,
    });
  }

  return result;
}
