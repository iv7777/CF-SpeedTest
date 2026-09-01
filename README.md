# CF-SpeedTest Worker

A Cloudflare Worker that serves an endless, non-terminating byte stream for use
as the `-url` target of [XIU2/CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest),
gated behind a secret path segment so only requests that know the secret get a
response — everything else gets a plain `404`.

## Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iv7777/CF-SpeedTest)

Clicking this walks you through connecting your Cloudflare account and deploying
the Worker — no local CLI required.

## After deploying: set the secret

The Worker checks the first path segment of every request against the
`SPEEDTEST_SECRET` environment variable/secret. It is **not** set in this repo
(it's public), so you must set it yourself after deploying:

1. Cloudflare dashboard → **Workers & Pages** → your worker → **Settings → Variables and Secrets**
2. Add a variable named `SPEEDTEST_SECRET`, type **Secret**, value of your choosing
   (e.g. `CF-Speedtest-Path`).
3. Save and redeploy if prompted.

Your speed-test URL is then:
```
https://<your-worker-subdomain>.workers.dev/<your-secret>/down
```

Any request whose first path segment doesn't match returns `404`.

## Use it with CloudflareSpeedTest

```
CloudflareSpeedTest -url "https://<your-worker-subdomain>.workers.dev/<your-secret>/down" -debug
```

## Optional hardening

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
own — it should only ever be cut off by the client's own `-dt` timeout. That's
why this Worker's stream has no `Content-Length` and never closes itself;
see the `pull()` callback in [`src/index.js`](src/index.js).
