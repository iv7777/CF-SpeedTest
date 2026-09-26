function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// token format: "<unix-expiry>-<hex hmac-sha256 of the expiry, signed with env.SIGNING_KEY>"
// generated fresh per use by scripts/gen-url.sh — nothing here is a static, reusable secret.
const MAX_TTL_SECONDS = 120 * 60; // hard cap, enforced independently of the signature — see README

async function verifyToken(token, key) {
  const match = /^([0-9]+)-([0-9a-f]{64})$/i.exec(token || "");
  if (!match) return false;
  const [, expStr, sigHex] = match;
  const exp = parseInt(expStr, 10);
  const now = Date.now() / 1000;
  if (!Number.isFinite(exp) || exp <= now) return false; // expired
  if (exp - now > MAX_TTL_SECONDS) return false; // requested window too far out — reject even if the signature is otherwise valid

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    hexToBytes(sigHex),
    new TextEncoder().encode(expStr)
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- auth: only requests carrying a currently-valid signed token proceed ---
    const parts = url.pathname.split("/").filter(Boolean);
    if (!(await verifyToken(parts[0], env.SIGNING_KEY))) {
      return new Response("Not found", { status: 404 }); // 404, not 403 — don't confirm the path exists
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    // optional fixed size via a second path segment, e.g. /50m.test, /100m.test, /1g.test
    // — for manual spot-checks only; leave this off (bare token path) for CloudflareSpeedTest's -url,
    // since a size small enough to finish before -dt elapses reintroduces the "finished early" EWMA bug.
    let sizeBytes = null;
    const sizeMatch = parts[1]?.match(/^(\d+(?:\.\d+)?)(k|m|g)b?(?:\.test)?$/i);
    if (sizeMatch) {
      const n = parseFloat(sizeMatch[1]);
      const mult = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[sizeMatch[2].toLowerCase()];
      sizeBytes = Math.round(n * mult);
    }

    const MAX_DURATION_MS = 5 * 60 * 1000; // safety valve for a stuck/abusive connection — well above any sane -dt
    const started = Date.now();
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sizeBytes !== null && sent >= sizeBytes) {
          return controller.close();
        }
        if (Date.now() - started > MAX_DURATION_MS) {
          return controller.close();
        }
        const n = sizeBytes !== null ? Math.min(chunk.byteLength, sizeBytes - sent) : chunk.byteLength;
        const piece = n === chunk.byteLength ? chunk : chunk.subarray(0, n);
        controller.enqueue(piece);
        sent += n;
      },
    });

    const headers = { "Content-Type": "application/octet-stream" };
    if (sizeBytes !== null) {
      headers["Content-Length"] = String(sizeBytes); // only set when a fixed size was requested — otherwise
    }                                                  // chunked transfer, contentLength == -1 in download.go

    return new Response(request.method === "HEAD" ? null : stream, {
      status: 200,
      headers,
    });
  },
};
