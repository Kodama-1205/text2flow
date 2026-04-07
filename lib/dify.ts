type RunWorkflowRequest = {
  inputs: Record<string, any>;
  response_mode: "blocking" | "streaming";
  user: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runDifyWorkflow(payload: RunWorkflowRequest) {
  const baseUrl = (process.env.DIFY_BASE_URL || "https://api.dify.ai").replace(/\/+$/, "");
  const apiKey = process.env.DIFY_API_KEY;

  if (!apiKey) {
    throw new Error("DIFY_API_KEY が未設定です（.env.local を確認してください）");
  }

  const timeoutMs = Number(process.env.DIFY_TIMEOUT_MS ?? 90000); // 90s推奨
  const maxAttempts = Number(process.env.DIFY_RETRY ?? 3); // 3回（初回+2リトライ）
  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/v1/workflows/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        // 400系は設定ミスなのでリトライしない
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`Dify API error (${res.status}): ${text}`);
        }
        // 500系はリトライ候補としてマークして投げる
        const err = new Error(`Dify API error (${res.status}): ${text}`);
        (err as any).dify5xx = true;
        throw err;
      }

      try {
        return JSON.parse(text);
      } catch {
        // “途中切断”等でJSONが壊れている可能性 → リトライ候補
        throw new Error(`Dify response is not JSON (attempt ${attempt}): ${text.slice(0, 200)}`);
      }
    } catch (e: any) {
      lastErr = e;

      const msg = String(e?.message ?? "");
      const isTimeout = e?.name === "AbortError" || msg.includes("timeout");
      const isNetworkish =
        msg.includes("incomplete chunked read") ||
        msg.includes("RemoteProtocolError") ||
        msg.includes("fetch failed") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("EAI_AGAIN") ||
        isTimeout;

      // 4xxは設定問題なのでリトライしない
      if (msg.includes("Dify API error (4")) throw e;

      if (attempt < maxAttempts && (isNetworkish || (e as any).dify5xx)) {
        // 1回目 500ms, 2回目 1200ms くらいで待って再試行
        const backoff = attempt === 1 ? 500 : 1200;
        await sleep(backoff);
        continue;
      }

      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr ?? new Error("Dify request failed");
}
