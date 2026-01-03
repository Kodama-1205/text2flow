import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Text2Flow",
  description: "文章から業務フロー図を自動生成",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
