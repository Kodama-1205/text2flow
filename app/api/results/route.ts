import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_PER_CLIENT = 50;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error(`Supabase env missing: url=${!!url} key=${!!key}`);
  return createClient(url, key);
}

/** GET /api/results?client_id=xxx — 一覧取得 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get("client_id")?.trim();
    if (!client_id) {
      return NextResponse.json({ error: "client_id is required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("text2flow_results")
      .select("id, client_id, input_text, explanation, config, flow_json, mermaid, steps, conditions, created_at")
      .eq("client_id", client_id)
      .order("created_at", { ascending: false })
      .limit(MAX_PER_CLIENT);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ results: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}

/** POST /api/results — 保存 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const { client_id, input_text, explanation, config, flow_json, mermaid, steps, conditions } = body;
    if (!client_id || !input_text || !flow_json || !mermaid) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    const supabase = getSupabase();

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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ result: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
