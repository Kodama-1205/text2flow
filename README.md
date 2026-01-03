# Text2Flow（文章 → 業務フロー図）

文章（箇条書き/手順/条件分岐）から **業務フローJSON** を生成し、**Mermaidでフロー図表示**できるWebアプリです。  
Dify（Workflow）と連携し、最終出力 `flow_json_raw` を **Web側で安全にパース/補正**して表示します。

- `/input`：文章入力 + オプション（向き/詳細度/max_nodes/debug）
- `/result`：フロー図 + 手順/条件分岐/JSON/Raw/Debug + Copy/Download SVG

---

## 特徴

- ✅ **Difyの返却が文字列JSONでもOK**（BOM / ```json / 末尾カンマ などを自動補正）
- ✅ `flow_json_raw` を最優先で取得（Dify側の最終Output名を固定）
- ✅ Debug ON のときだけ `Raw / Debug` タブ表示（運用時は隠れる）
- ✅ Copy / Download SVG に成功トースト表示
- ✅ APIキーはフロントに出さず、**Next.js API Route** からDifyを呼び出し

---

## 動作要件

- Node.js 18 以上（推奨: 20）
- npm / pnpm / yarn いずれか

---

## ローカル起動

### 1) インストール
```bash
# ルートが web の場合
npm install
