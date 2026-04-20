import { NextResponse } from "next/server";
import { FlowSchema, type Text2FlowResult } from "@/lib/flow-schema";
import { flowToMermaid, deriveSteps, deriveConditions } from "@/lib/flow-to-mermaid";

// ── レートリミット（ask-designと同方式: 1IPあたり5回/60秒）──────────────
const STORE_KEY = "__TEXT2FLOW_RL__";
type Bucket = { ts: number[] };

function getBucketStore(): Map<string, Bucket> {
  const g = globalThis as any;
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map<string, Bucket>();
  return g[STORE_KEY] as Map<string, Bucket>;
}

function rateLimit(ip: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const store = getBucketStore();
  const key = `flow:${ip}`;
  const b = store.get(key) ?? { ts: [] };
  b.ts = b.ts.filter((t) => now - t < windowMs);
  if (b.ts.length >= limit) {
    store.set(key, b);
    const resetInMs = windowMs - (now - b.ts[0]);
    return { ok: false as const, retryAfterSec: Math.ceil(resetInMs / 1000) };
  }
  b.ts.push(now);
  store.set(key, b);
  return { ok: true as const };
}

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "unknown";
}

// ── プロンプト ───────────────────────────────────────────────────────────
function buildSystemPrompt(detail: string, maxNodes: number) {
  const detailNote =
    detail === "detailed"
      ? "処理をできるだけ細かく分解し、詳細なステップを含めてください。"
      : "処理を大まかにまとめ、主要なステップのみを抽出してください。";

  return `あなたは業務フロー抽出AIです。ユーザーの入力文章から業務フローを抽出し、以下のJSONのみを返してください（マークダウン・コードブロック不要）：

{"title":"フロータイトル（省略可）","nodes":[{"id":"n0","label":"開始","type":"start"},{"id":"n1","label":"処理A","type":"task"},{"id":"n2","label":"条件B?","type":"decision","condition":"条件の説明"},{"id":"n3","label":"終了","type":"end"}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n2","to":"n3","label":"Yes"},{"from":"n2","to":"n4","label":"No"}]}

ルール：
- type は "start" / "task" / "decision" / "end" のいずれか（必須）
- id は n0, n1, n2... の連番（必須）
- 条件分岐（decision）の出力エッジには label: "Yes" または "No" を付ける
- 最初のノードは type: "start"、最後は type: "end"
- nodes と edges は必須。ノード数は最大${maxNodes}個
- コードフェンス（\`\`\`）・末尾カンマは禁止
- ${detailNote}`;
}

function buildUserMessage(text: string) {
  return `以下の文章から業務フローを抽出してください：\n\n${text}`;
}

// ── JSONパース（ゴミ混入耐性） ───────────────────────────────────────────
function parseLooseJson(raw: string): any | null {
  let s = raw
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/,\s*([}\]])/g, "$1");

  try {
    const a = JSON.parse(s);
    if (typeof a === "string") {
      try {
        return JSON.parse(a.trim());
      } catch {
        return a;
      }
    }
    return a;
  } catch {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(s.slice(i, j + 1));
      } catch {}
    }
    return null;
  }
}

// ── メインハンドラ ───────────────────────────────────────────────────────
type Req = {
  text: string;
  orientation?: "TD" | "LR";
  detail?: "simple" | "detailed";
  maxNodes?: number;
  debug?: boolean;
};

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // ① レートリミット
  const rl = rateLimit(ip, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってから再試行してください。" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY が設定されていません。" }, { status: 500 });
  }

  const body = (await request.json()) as Req;
  const text = (body.text ?? "").trim();

  // ② 入力バリデーション
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > 6000) {
    return NextResponse.json({ error: "入力が長すぎます（最大6000文字）。" }, { status: 400 });
  }

  const orientation: "TD" | "LR" = body.orientation ?? "TD";
  const detail: "simple" | "detailed" = body.detail ?? "simple";
  const maxNodes = Math.max(5, Math.min(40, body.maxNodes ?? 20));
  const debug = !!body.debug;

  try {
    // ③ DeepSeek 呼び出し
    const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: buildSystemPrompt(detail, maxNodes) },
          { role: "user", content: buildUserMessage(text) },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    if (!dsRes.ok) {
      const errText = await dsRes.text().catch(() => "");
      return NextResponse.json(
        { error: `DeepSeek API エラー (${dsRes.status})`, detail: errText.slice(0, 300) },
        { status: 502 }
      );
    }

    const dsJson = await dsRes.json().catch(() => null);
    const rawContent: string = dsJson?.choices?.[0]?.message?.content ?? "";

    if (!rawContent) {
      return NextResponse.json({ error: "DeepSeekからの応答が空です。" }, { status: 502 });
    }

    const parsed = parseLooseJson(rawContent);
    if (!parsed?.nodes) {
      return NextResponse.json(
        {
          error: "フローの解析に失敗しました。",
          hint: "DeepSeekがJSONを返せなかった可能性があります。",
          ...(debug ? { raw: rawContent.slice(0, 500) } : {}),
        },
        { status: 502 }
      );
    }

    // ノード数制限
    if (Array.isArray(parsed.nodes) && parsed.nodes.length > maxNodes) {
      parsed.nodes = parsed.nodes.slice(0, maxNodes);
      const allow = new Set(parsed.nodes.map((n: any) => n.id));
      parsed.edges = (parsed.edges ?? []).filter(
        (e: any) => allow.has(e.from) && allow.has(e.to)
      );
    }

    const flow_json = FlowSchema.parse(parsed);
    const mermaid = flowToMermaid(flow_json, orientation);
    const steps = deriveSteps(flow_json);
    const conditions = deriveConditions(flow_json);
    const explanation = `文章を構造化し、業務フロー（${flow_json.nodes.length}ノード）として整理しました。`;

    const result: Text2FlowResult = {
      flow_json,
      mermaid,
      steps,
      conditions,
      explanation,
      ...(debug
        ? {
            debug: {
              model: "deepseek-chat",
              max_tokens: 2000,
              raw_content_preview: rawContent.slice(0, 500),
            },
          }
        : {}),
    };

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: "フロー生成に失敗しました。", detail: e?.message ?? "" },
      { status: 500 }
    );
  }
}
