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

function mockResult(req: Required<Pick<Req, "text" | "orientation" | "detail" | "maxNodes" | "debug">>): Text2FlowResult {
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
 * 文字列を「JSON.parse 可能」に寄せるクリーニング
 * - ```json ... ``` の除去
 * - BOM除去
 * - 末尾カンマ除去（ {..,} / [..,] を許さないJSON対策）
 */
function cleanJsonString(input: string): string {
  return input
    .replace(/^\uFEFF/, "") // BOM
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim()
    .replace(/,\s*([}\]])/g, "$1"); // trailing commas
}

/**
 * Difyの返却（文字列/二重JSON/前後にゴミ/末尾カンマ/コードフェンス）を安全にJSON化する
 */
function parseLooseJson(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  let s = cleanJsonString(raw);
  if (!s) return null;

  const tryParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  // 1) そのままパース
  const a = tryParse(s);
  if (a !== null) {
    // 二重エンコード対策: もう一回
    if (typeof a === "string") {
      const s2 = cleanJsonString(a);
      const b = tryParse(s2);
      return b !== null ? b : a;
    }
    return a;
  }

  // 2) 先頭の { ... } を抜き出してparse
  const iObj = s.indexOf("{");
  const jObj = s.lastIndexOf("}");
  if (iObj >= 0 && jObj > iObj) {
    const sub = cleanJsonString(s.slice(iObj, jObj + 1));
    const b = tryParse(sub);
    if (b !== null) {
      if (typeof b === "string") {
        const s2 = cleanJsonString(b);
        const c = tryParse(s2);
        return c !== null ? c : b;
      }
      return b;
    }
  }

  // 3) 先頭の [ ... ] を抜き出してparse（念のため）
  const iArr = s.indexOf("[");
  const jArr = s.lastIndexOf("]");
  if (iArr >= 0 && jArr > iArr) {
    const sub = cleanJsonString(s.slice(iArr, jArr + 1));
    const b = tryParse(sub);
    if (b !== null) {
      if (typeof b === "string") {
        const s2 = cleanJsonString(b);
        const c = tryParse(s2);
        return c !== null ? c : b;
      }
      return b;
    }
  }

  return null;
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

    // ★ここが肝：Difyの最終Outputを flow_json_raw にしている前提で確実に拾う
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

    // それでもダメなら、outputsの別キーも総当たりで救済（「一回で終わらせる」ための保険）
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

    // 最終保険：最低限のフロー（ただし explanation に理由を明示）
    let usedFallback = false;
    if (!flow_json) {
      usedFallback = true;
      flow_json = {
        title: "Generated Flow",
        nodes: [
          { id: "n0", label: "開始", type: "start" },
          { id: "n1", label: "入力を解析", type: "task" },
          { id: "n2", label: "終了", type: "end" },
        ],
        edges: [
          { from: "n0", to: "n1" },
          { from: "n1", to: "n2" },
        ],
      };
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

    const dify_template =
      (typeof outputs.dify_template === "string" && outputs.dify_template.trim()) || "";

    const explanation =
      usedFallback
        ? "Difyの出力(flow_json_raw)を取得/解析できなかったため、最低限のフローを表示しています。"
        : (typeof outputs.explanation === "string" && outputs.explanation.trim())
          ? outputs.explanation
          : "文章を構造化し、業務フロー（ノード/エッジ/条件分岐）として整理しました。";

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
              // ★/result 側で再構築できるように“完全な生データ”も載せる（必要ならここを削ってもOK）
              flow_json_raw: rawPrimary,
              raw_primary_preview: typeof rawPrimary === "string" ? rawPrimary.slice(0, 240) : rawPrimary,
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
