import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error(`Supabase env missing: url=${!!url} key=${!!key}`);
  return createClient(url, key);
}

/** DELETE /api/results/[id] — 1件削除 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get("client_id")?.trim();

    if (!client_id) {
      return NextResponse.json({ error: "client_id is required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from("text2flow_results")
      .delete()
      .eq("id", id)
      .eq("client_id", client_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
