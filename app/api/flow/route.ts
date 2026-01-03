// /web/app/api/flow/route.ts
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
    dify_template: "",
    explanation: "※現在はモック結果です。DIFY_API_KEY を設定すると Dify の結果で置き換わります。",
    ...(req.debug ? { debug: { mock: true, receivedTextPreview: req.text.slice(0, 140) } } : {}),
  };
}

/**
 * Dify返却文字列の“汚れ”を徹底的に除去してJSONとして読める形にする
 * - BOM
 * - ```json ... ``` フェンス
 * - NBSP(0xA0) や特殊空白
 * - 末尾カンマ
 * - 前後のゴミ
 */
function normalizeJsonText(s: string): string {
  return (
    s
      // BOM
      .replace(/^\uFEFF/, "")
      // NBSP & いわゆる“変な空白”を通常スペースへ
      .replace(/\u00A0/g, " ")
      .replace(/\u2007/g, " ")
      .replace(/\u202F/g, " ")
      // code fence 除去
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim()
      // 末尾カンマ除去（配列/オブジェクト）
      .replace(/,\s*([}\]])/g, "$1")
  );
}

/**
 * Difyの返却（文字列/二重JSON/前後にゴミが混ざる）を安全にJSON化する
 */
function parseLooseJson(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  let s = normalizeJsonText(raw);
  if (!s) return null;

  // 1) 素直にJSON.parse
  try {
    const a = JSON.parse(s);
    // 二重エンコード対策: もう一回
    if (typeof a === "string") {
      const s2 = normalizeJsonText(a);
      try {
        return JSON.parse(s2);
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
      const sub = normalizeJsonText(s.slice(i, j + 1));
      try {
        const b = JSON.parse(sub);
        if (typeof b === "string") {
          const s2 = normalizeJsonText(b);
          try {
            return JSON.parse(s2);
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

  // APIキー未設定ならモックで動作
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

    // Difyの最終Outputを flow_json_raw にしている前提で確実に拾う
    const rawPrimary =
      outputs.flow_json_raw ??
      outputs.flow_json ??
      outputs.flow ??
      outputs.json ??
      outputs.result ??
      outputs.text ??
      null;

    const parsedAny = parseLooseJson(rawPrimary);
    let flowCandidate = toFlowCandidate(parsedAny);

    // それでもダメなら、outputsの別キーも総当たりで救済（保険）
    if (!flowCandidate) {
      const keys = Object.keys(outputs ?? {});
      for (const k of keys) {
        const v = (outputs as any)[k];
        const p = parseLooseJson(v);
        const fc = toFlowCandidate(p);
        if (fc) {
          flowCandidate = fc;
          break;
        }
      }
    }

    // ★ここで取得できないなら「ダミー表示」はやめる（＝エラーとして返す）
    if (!flowCandidate) {
      return NextResponse.json(
        {
          error:
            "Difyの出力(flow_json_raw)を取得/解析できませんでした（ダミー表示は行いません）。",
          hint:
            "Dify側の最終出力変数名が flow_json_raw であること、JSONにNBSP/コードフェンス/末尾カンマ等が混入していないことを確認してください。",
          ...(debug
            ? {
                debug: {
                  dify_status: dify?.data?.status ?? dify?.status ?? "",
                  output_keys: Object.keys(outputs ?? {}),
                  raw_primary_preview:
                    typeof rawPrimary === "string" ? rawPrimary.slice(0, 500) : rawPrimary,
                  inputs_sent: inputs,
                },
              }
            : {}),
        },
        { status: 502 }
      );
    }

    // ノード数制限（暴走対策）
    if (Array.isArray(flowCandidate.nodes) && flowCandidate.nodes.length > maxNodes) {
      flowCandidate.nodes = flowCandidate.nodes.slice(0, maxNodes);
      if (Array.isArray(flowCandidate.edges)) {
        const allow = new Set(flowCandidate.nodes.map((n: any) => n.id));
        flowCandidate.edges = flowCandidate.edges.filter((e: any) => allow.has(e.from) && allow.has(e.to));
      }
    }

    const parsedFlow = FlowSchema.parse(flowCandidate);

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

    const dify_template =
      (typeof outputs.dify_template === "string" && outputs.dify_template.trim()) || "";

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
                typeof rawPrimary === "string" ? rawPrimary.slice(0, 500) : rawPrimary,
              inputs_sent: inputs,
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
