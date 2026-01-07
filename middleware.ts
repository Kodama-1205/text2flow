// web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const realm = "Protected";

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
    },
  });
}

function decodeBasic(base64: string) {
  try {
    if (typeof atob === "function") return atob(base64);
  } catch {}
  try {
    // eslint-disable-next-line no-undef
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;

  // ✅ ここ超重要：アセットは除外（ここを認証するとCSS/JSが読めず、見た目が崩れます）
  if (
    p.startsWith("/_next/static") ||
    p.startsWith("/_next/image") ||
    p === "/favicon.ico" ||
    p === "/robots.txt" ||
    p === "/sitemap.xml" ||
    /\.(?:css|js|map|ico|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot)$/.test(p)
  ) {
    return NextResponse.next();
  }

  const user = process.env.BASIC_AUTH_USER ?? "";
  const pass = process.env.BASIC_AUTH_PASS ?? "";

  // 未設定なら素通り（本番はVercelに必ず設定してください）
  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const b64 = auth.slice("Basic ".length).trim();
  const decoded = decodeBasic(b64);
  const [u, pw] = decoded.split(":");

  if (u !== user || pw !== pass) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
