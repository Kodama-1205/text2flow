import { NextResponse } from "next/server";
import { FlowSchema, type Text2FlowResult } from "@/lib/flow-schema";
import { flowToMermaid, deriveSteps, deriveConditions } from "@/lib/flow-to-mermaid";
import { runDifyWorkflow } from "@/lib/dify";

type Req = {
  text: string;
  orientation?: "TD" | "LR";
  detail?: "simple" | "detailed";
  maxNodes?: number;
  debug?: boolean;
};

function isDemoMode() {
  return (process.env.DEMO_MODE ?? "").toLowerCase() === "true";
}

function mockResult(
  req: Required<Pick<Req, "text" | "orientation" | "detail" | "maxNodes" | "debug">>
): Text2FlowResult {
  const flow_json = FlowSchema.parse({
    title: "発注〜在庫確認フロー",
    nodes: [
      { id: "n0", label: "開始", type: "start" },
      { id: "n1", label: "注文Excelを確認", type: "task" },
      { id: "n2", label: "在庫と照合", type: "decision", condition: "在庫不足？" },
      { id: "n3", label: "不足分をSlack通知", type: "task" },
      { id: "n4", label: "終了", type: "end" },
    ],
    edges: [
      { from: "n0", to: "n1" },
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "Yes" },
      { from: "n2", to: "n4", label: "No" },
      { from: "n3", to: "n4" },
    ],
  });

  const mermaid = flowToMermaid(flow_json, req.orientation);
  const steps = deriveSteps(flow_json);
  const conditions = deriveConditions(flow_json);

  return {
    flow_json,
    mermaid,
    steps,
    conditions,
    dify_template: buildDifyTemplateFallback({
      orientation: req.orientation,
      detail: req.detail,
      maxNodes: req.maxNodes,
    }),
    explanation:
      "これはデモモード（DEMO_MODE=true）の固定出力です。見せたい時だけ DEMO_MODE=false にして本番呼び出しに切り替えてください。",
    ...(req.debug ? { debug: { mock: true, receivedTextPreview: req.text.slice(0, 140) } } : {}),
  };
}

/**
 * Dify雛形（常に返す）: Dify側が flow_json_raw しか返さなくてもOKにする
 */
function buildDifyTemplateFallback(opts: {
  orientation: "TD" | "LR";
  detail: "simple" | "detailed";
  maxNodes: number;
}) {
  // DifyのUIに貼りやすい“手順テキスト”形式にする（JSON/YAMLに固定しない）
  return [
    "Dify Workflow 雛形（最小構成）",
    "",
    "1) ユーザー入力（Start）",
    '   - text: text-input (String)',
    '   - orientation: text-input (String) 例: "TD" / "LR"',
    '   - detail: text-input (String) 例: "simple" / "detailed"',
    '   - max_nodes: text-input (String) 例: "20"',
    "",
    "2) LLM ノード（gpt-4o-mini 等）",
    "   - 指示: 入力文章から業務フローを抽出し、JSONのみで返す",
    '   - 最重要: コードフェンス禁止 / 末尾カンマ禁止 / Yes/No分岐 / idはn0..連番',
    "   - 出力変数名: flow_json_raw（String）←これが最重要",
    "",
    "3) 出力（End）",
    "   - flow_json_raw を最終出力に設定",
    "",
    "推奨（あなたの現状と一致）",
    `- orientation: ${opts.orientation}`,
    `- detail: ${opts.detail}`,
    `- max_nodes: ${String(opts.maxNodes)}`,
    "",
    "メモ",
    "- 本Webアプリは flow_json_raw を受け取り、サーバ側で厳密パース→Mermaid化します。",
  ].join("\n");
}

/**
 * Difyの返却（文字列/二重JSON/前後にゴミが混ざる）を安全にJSON化する
 */
function parseLooseJson(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;

  if (typeof raw !== "string") return null;

  let s = raw.trim();
  if (!s) return null;

  // BOM/コードフェンス除去 + 末尾カンマ除去（NBSPなどの混入にも強くする）
  s = s
    .replace(/^\uFEFF/, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    // NBSP(0xA0) 等の不可視空白を通常スペースに寄せる
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");

  // 1) 素直にJSON.parse
  try {
    const a = JSON.parse(s);
    // 二重エンコード対策: もう一回
    if (typeof a === "string") {
      try {
        return JSON.parse(a.trim());
      } catch {
        return a;
      }
    }
    return a;
  } catch {
    // 2) 先頭の { から最後の } を抜き出してparse
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      const sub = s.slice(i, j + 1);
      try {
        const b = JSON.parse(sub);
        if (typeof b === "string") {
          try {
            return JSON.parse(b.trim());
          } catch {
            return b;
          }
        }
        return b;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toFlowCandidate(obj: any): any | null {
  if (!obj) return null;

  // すでにFlowっぽい
  if (obj?.nodes && obj?.edges) return obj;

  // { flow_json: {...} } 形式
  if (obj?.flow_json?.nodes && obj?.flow_json?.edges) return obj.flow_json;

  // { flow: {...} } 形式
  if (obj?.flow?.nodes && obj?.flow?.edges) return obj.flow;

  // { json: {...} } 形式
  if (obj?.json?.nodes && obj?.json?.edges) return obj.json;

  return null;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Req;

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const orientation: "TD" | "LR" = body.orientation ?? "TD";
  const detail: "simple" | "detailed" = body.detail ?? "simple";
  const maxNodes = Math.max(5, Math.min(40, body.maxNodes ?? 20));
  const debug = !!body.debug;

  // ✅ 普段はデモ（課金0）。見せたい時だけ DEMO_MODE=false にする
  if (isDemoMode()) {
    return NextResponse.json(mockResult({ text, orientation, detail, maxNodes, debug }));
  }

  // APIキー未設定ならモックで動作（ローカル/検証向け）
  if (!process.env.DIFY_API_KEY) {
    return NextResponse.json(mockResult({ text, orientation, detail, maxNodes, debug }));
  }

  const user = process.env.DIFY_USER || "text2flow-web";

  // Dify側が text-input の場合、数値でも「文字列」で渡す必要がある（invalid_param回避）
  const inputs: Record<string, any> = {
    text,
    orientation,
    detail,
    max_nodes: String(maxNodes),
  };

  try {
    const dify = await runDifyWorkflow({
      inputs,
      response_mode: "blocking",
      user,
    });

    const outputs =
      dify?.data?.outputs ??
      dify?.data?.output ??
      dify?.outputs ??
      dify?.output ??
      {};

    // ★Difyの最終Outputを flow_json_raw にしている前提で確実に拾う
    const rawPrimary =
      outputs.flow_json_raw ??
      outputs.flow_json ??
      outputs.flow ??
      outputs.json ??
      outputs.result ??
      outputs.text ??
      null;

    const parsedAny = parseLooseJson(rawPrimary);
    const flowCandidate = toFlowCandidate(parsedAny);

    // flow_json（object or string）を確実にFlow化
    let flow_json: any = flowCandidate;

    // それでもダメなら、outputsの別キーも総当たりで救済
    if (!flow_json) {
      const keys = Object.keys(outputs ?? {});
      for (const k of keys) {
        const v = (outputs as any)[k];
        const p = parseLooseJson(v);
        const fc = toFlowCandidate(p);
        if (fc) {
          flow_json = fc;
          break;
        }
      }
    }

    // ここでは “最低限フローで誤魔化す” より、解析できたら返す（失敗は500に倒す）
    if (!flow_json) {
      return NextResponse.json(
        {
          error: "Difyの出力(flow_json_raw)を取得/解析できませんでした。",
          hint: "Difyの最終出力変数名が flow_json_raw で、JSONのみ（コードフェンス/末尾カンマなし）を返しているか確認してください。",
        },
        { status: 500 }
      );
    }

    // ノード数制限（暴走対策）
    if (Array.isArray(flow_json.nodes) && flow_json.nodes.length > maxNodes) {
      flow_json.nodes = flow_json.nodes.slice(0, maxNodes);
      if (Array.isArray(flow_json.edges)) {
        const allow = new Set(flow_json.nodes.map((n: any) => n.id));
        flow_json.edges = flow_json.edges.filter((e: any) => allow.has(e.from) && allow.has(e.to));
      }
    }

    const parsedFlow = FlowSchema.parse(flow_json);

    const mermaid =
      (typeof outputs.mermaid === "string" && outputs.mermaid.trim()) ||
      flowToMermaid(parsedFlow, orientation);

    const steps: string[] =
      Array.isArray(outputs.steps)
        ? outputs.steps
        : typeof outputs.steps === "string"
          ? outputs.steps.split("\n").filter(Boolean)
          : deriveSteps(parsedFlow);

    const conditions =
      Array.isArray(outputs.conditions) ? outputs.conditions : deriveConditions(parsedFlow);

    // ★ここが今回：Difyが返さなくても、必ず雛形を返す
    const difyTemplateFromDify =
      typeof outputs.dify_template === "string" && outputs.dify_template.trim()
        ? outputs.dify_template.trim()
        : "";

    const dify_template =
      difyTemplateFromDify ||
      buildDifyTemplateFallback({ orientation, detail, maxNodes });

    const explanation =
      (typeof outputs.explanation === "string" && outputs.explanation.trim()) ||
      "文章を構造化し、業務フロー（ノード/エッジ/条件分岐）として整理しました。";

    const result: Text2FlowResult = {
      flow_json: parsedFlow,
      mermaid,
      steps,
      conditions,
      dify_template,
      explanation,
      ...(debug
        ? {
            debug: {
              dify_status: dify?.data?.status ?? dify?.status ?? "",
              output_keys: Object.keys(outputs ?? {}),
              primary_key_used: "flow_json_raw" in (outputs ?? {}) ? "flow_json_raw" : "other",
              raw_primary_preview:
                typeof rawPrimary === "string" ? rawPrimary.slice(0, 240) : rawPrimary,
              inputs_sent: inputs,
              dify_template_source: difyTemplateFromDify ? "dify" : "fallback",
            },
          }
        : {}),
    };

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message ?? "Unknown error",
        hint: "Dify側の入力フォーム型(text-input)と、Outputの変数名(flow_json_raw)を確認してください。",
      },
      { status: 500 }
    );
  }
}
