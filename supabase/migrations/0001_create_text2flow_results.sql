-- text2flow 結果保存テーブル
-- Supabase ダッシュボード > SQL Editor で実行してください

create table if not exists public.text2flow_results (
  id          uuid        primary key default gen_random_uuid(),
  client_id   text        not null,           -- ブラウザ生成UUID（ログイン不要）
  input_text  text        not null,
  explanation text,
  config      jsonb       not null default '{}',
  flow_json   jsonb       not null,
  mermaid     text        not null,
  steps       jsonb       not null default '[]',
  conditions  jsonb       not null default '[]',
  created_at  timestamptz not null default now()
);

create index if not exists text2flow_results_client_id_idx
  on public.text2flow_results (client_id);

-- client_id は公開鍵でフィルタ済みのため RLS は無効のままで運用可
-- （有効化する場合は下記を参考に）
-- alter table public.text2flow_results enable row level security;
