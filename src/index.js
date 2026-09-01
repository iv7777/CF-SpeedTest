export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- auth: only requests carrying the secret path segment proceed ---
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== env.SPEEDTEST_SECRET) {
      return new Response("Not found", { status: 404 }); // 404, not 403 — don't confirm the path exists
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk); // never closes on its own — client's -dt timeout is what ends it
      },
    });

    return new Response(request.method === "HEAD" ? null : stream, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
      // no Content-Length set on purpose → chunked transfer, contentLength == -1 in download.go
    });
  },
};
