import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** サーバーサイド専用クライアント（API Route内で使用） */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createSupabaseClient(url, key);
}
