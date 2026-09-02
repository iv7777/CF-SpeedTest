# CF-SpeedTest Worker

A Cloudflare Worker that serves a byte stream for use as the `-url` target of
[XIU2/CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest), gated
behind a secret path segment so only requests that know the secret get a
response — everything else gets a plain `404`.

## Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iv7777/CF-SpeedTest)

Clicking this walks you through connecting your Cloudflare account and deploying
the Worker — no local CLI required.

**If the deployed Worker shows the default "Hello World" instead of this
repo's code:** the button's build pipeline sometimes doesn't pick up the
source correctly. The reliable fallback is to paste [`src/index.js`](src/index.js)
directly: Cloudflare dashboard → **Workers & Pages** → your worker →
**Edit code** (Quick Edit) → replace the contents → **Save and deploy**.

## After deploying: set the secret

The Worker checks the first path segment of every request against the
`SPEEDTEST_SECRET` environment variable/secret. It is **not** set in this repo
(it's public), so you must set it yourself after deploying:

1. Cloudflare dashboard → **Workers & Pages** → your worker → **Settings → Variables and Secrets**
2. Add a variable named `SPEEDTEST_SECRET`, type **Secret**, value of your choosing.
   Whatever you pick, it must match the path segment **exactly** — the check is
   case-sensitive and does a plain string match, no trimming.
3. Save — and if prompted, redeploy.

Your speed-test URL is then:
```
https://<your-worker-subdomain-or-custom-domain>/<your-secret>
```
Any request whose first path segment doesn't match returns `404`. Anything
after that first segment is ignored by the Worker, so `/<your-secret>/down`,
`/<your-secret>/anything`, or the bare `/<your-secret>` all behave identically
— add a trailing label only if you want the URL to read more clearly.

## Use it with CloudflareSpeedTest

```bash
CloudflareSpeedTest -url "https://<your-worker-subdomain-or-custom-domain>/<your-secret>" -debug
```

## Optional: fixed-size test files, for manual spot-checks only

Append a size as a second path segment — `50m.test`, `100m.test`, `1g.test`
(`k`/`m`/`g`, decimals allowed, `.test` optional) — to get back exactly that
many bytes with a real `Content-Length`, instead of the endless stream:
```bash
curl -o /dev/null -w '%{http_code} %{size_download} bytes\n' \
  "https://<your-domain>/<your-secret>/50m.test"
```
**Don't point CloudflareSpeedTest's `-url` at a sized variant.** If the
requested size is small enough that a fast connection finishes downloading it
before your `-dt` timeout elapses, the transfer ends on its own — and
`download.go`'s throughput sampler is specifically not designed to handle that
correctly (see below). Use the bare secret path (unbounded) for the actual
tool; use sized paths only for your own `curl`/browser verification.

## Built-in safety cap

Each connection is force-closed after 5 minutes of wall-clock time regardless
of client behavior (`MAX_DURATION_MS` in `src/index.js`) — a backstop against
a stuck or abusive connection, well above any realistic `-dt` value. Adjust
the constant if you routinely run much longer tests.

## Hardening beyond the secret path

A secret path only stops people who don't know it — it's not a hard deny. For
real access control:

- **Custom domain + WAF rule.** Attach the Worker to a domain you own
  (Workers & Pages → your worker → Settings → Domains & Routes → Add Custom
  Domain), then add a WAF custom rule (Security → WAF → Custom rules) blocking
  everything except your own IP on that path, e.g.:
  ```
  (http.request.uri.path contains "/<your-secret>/") and not ip.src in {203.0.113.10}
  ```
- **Rate limiting rule** on the same route as a backstop even if the secret leaks.

## Troubleshooting

- **Getting `0` speed:** confirm you're hitting the bare secret path, not a
  sized variant small enough to finish before `-dt` elapses (see above).
- **`curl` gets `404` but the dashboard's code-editor preview returns `200`
  for the same path:** the preview pane and your Worker's real, deployed
  **Settings → Variables and Secrets** value can differ. Re-enter
  `SPEEDTEST_SECRET` there (case-sensitive, no stray whitespace) rather than
  trusting the editor preview alone.
- **`curl` body is literally the text `Not found`:** your request *is*
  reaching this Worker — it's a secret mismatch (see above), not a
  routing/DNS problem.
- **`curl` body is something else (HTML, empty, a Cloudflare-branded error
  page):** the request likely never reached this Worker at all — check that
  your custom domain shows **Active** under Domains & Routes, and that its DNS
  record is proxied (orange cloud).
- **Random per-IP failures under `-debug`** (TLS errors, occasional `403`,
  timeouts on specific candidate IPs) **are normal**, including against the
  tool's default `-url` — Cloudflare's edge is a huge, geographically
  distributed network, and CloudflareSpeedTest is designed to test far more
  candidate IPs than it needs and simply discard the ones that fail. This
  alone is not a sign of misconfiguration if overall results still come back.
- **Every request 403s, including your own:** check whether a WAF
  IP-allowlist rule you added (see Hardening) still matches your *current*
  public IP — dynamic IPs change. Also check **Security → Bots** — Bot Fight
  Mode can flag this tool's Go HTTP client (its TLS fingerprint doesn't match
  the hardcoded Chrome `User-Agent` it sends) independently of anything you
  configured.

## Local development (optional, instead of the button)

```bash
npm install -g wrangler
wrangler login
wrangler secret put SPEEDTEST_SECRET   # enter your secret value when prompted
wrangler deploy
```

## Why the response never ends on its own

`CloudflareSpeedTest`'s `download.go` samples throughput in ~100ms slices and
only avoids a false "0 speed" result if the transfer never reaches EOF on its
own — it should only ever be cut off by the client's own `-dt` timeout (or the
5-minute safety cap above). That's why the unbounded path has no
`Content-Length` and never closes itself; see the `pull()` callback in
[`src/index.js`](src/index.js).
