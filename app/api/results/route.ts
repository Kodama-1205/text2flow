import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_PER_CLIENT = 50;

/** GET /api/results?client_id=xxx — 一覧取得 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get("client_id")?.trim();
  if (!client_id) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("text2flow_results")
    .select("id, client_id, input_text, explanation, config, flow_json, mermaid, steps, conditions, created_at")
    .eq("client_id", client_id)
    .order("created_at", { ascending: false })
    .limit(MAX_PER_CLIENT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ results: data ?? [] });
}

/** POST /api/results — 保存 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { client_id, input_text, explanation, config, flow_json, mermaid, steps, conditions } = body;

  if (!client_id || !input_text || !flow_json || !mermaid) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const supabase = createClient();

  // 上限超えたら古いものを削除
  const { data: existing } = await supabase
    .from("text2flow_results")
    .select("id, created_at")
    .eq("client_id", client_id)
    .order("created_at", { ascending: false });

  if (existing && existing.length >= MAX_PER_CLIENT) {
    const toDelete = existing.slice(MAX_PER_CLIENT - 1).map((r: any) => r.id);
    await supabase.from("text2flow_results").delete().in("id", toDelete);
  }

  const { data, error } = await supabase
    .from("text2flow_results")
    .insert({
      client_id,
      input_text: String(input_text).slice(0, 8000),
      explanation: explanation ?? "",
      config: config ?? {},
      flow_json,
      mermaid: String(mermaid),
      steps: steps ?? [],
      conditions: conditions ?? [],
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ result: data }, { status: 201 });
}
