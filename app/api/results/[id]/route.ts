import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** DELETE /api/results/[id] — 1件削除 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get("client_id")?.trim();

  if (!client_id) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }

  const supabase = createClient();

  // client_id も条件に加えることで他人のデータを削除できないようにする
  const { error } = await supabase
    .from("text2flow_results")
    .delete()
    .eq("id", id)
    .eq("client_id", client_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
