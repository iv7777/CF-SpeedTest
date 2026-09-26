# CF-SpeedTest Worker

A Cloudflare Worker that serves a byte stream for use as the `-url` target of
[XIU2/CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest), gated
behind a short-lived, HMAC-signed token so only a freshly-generated URL works
— everything else (including an old URL whose window has lapsed) gets a plain
`404`. There's no static secret sitting in a URL forever; each test URL is
generated on demand and expires on its own shortly after.

## Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iv7777/CF-SpeedTest)

Clicking this walks you through connecting your Cloudflare account and deploying
the Worker — no local CLI required.

**If the deployed Worker shows the default "Hello World" instead of this
repo's code:** the button's build pipeline sometimes doesn't pick up the
source correctly. The reliable fallback is to paste [`src/index.js`](src/index.js)
directly: Cloudflare dashboard → **Workers & Pages** → your worker →
**Edit code** (Quick Edit) → replace the contents → **Save and deploy**.

## After deploying: set the signing key

The Worker validates the first path segment as `<unix-expiry>-<hmac-sha256-hex>`,
verified against the `SIGNING_KEY` secret. It is **not** set in this repo
(it's public), so you must set it yourself after deploying:

1. Cloudflare dashboard → **Workers & Pages** → your worker → **Settings → Variables and Secrets**
2. Add a variable named `SIGNING_KEY`, type **Secret**, value of your choosing
   (a long random string — this is a signing key, not something typed into a
   URL, so it doesn't need to be memorable).
3. Save — and if prompted, redeploy.

Anything not matching a currently-valid signature + expiry returns `404`.
Unlike the plain-secret approach, **you never type or reuse this key in a
URL** — you generate a fresh signed URL per test instead (next section).

## Generating a test URL

[`scripts/gen-url.sh`](scripts/gen-url.sh) is plain POSIX `sh` (no bashisms —
it runs fine under BusyBox `ash`, so it works as-is on an OpenWrt router, not
just a regular Linux/macOS shell). It needs the `openssl` CLI, which on
OpenWrt is **not** installed by default — even if Passwall/Xray-core is
running, they don't expose a shell-usable `openssl` binary:
```sh
opkg update && opkg install openssl-util
```

Then generate a URL valid for the next 10 minutes (default; pass a different
TTL in seconds as the second argument):
```sh
SPEEDTEST_SIGNING_KEY="<same value as the Worker's SIGNING_KEY secret>" \
  ./scripts/gen-url.sh <your-worker-subdomain-or-custom-domain> 600
```
This prints a complete URL, e.g. `https://speedtest.example.com/1790416074-3f9c…`
— the leading number is the expiry (unix time), the rest is an HMAC-SHA256
signature over it. Anyone who captures one of these URLs only gets a window
until it expires; it can't be reused or extended without your `SIGNING_KEY`.

**The TTL is a client-side choice, but the Worker independently caps it at
120 minutes** (`MAX_TTL_SECONDS` in `src/index.js`) — a token requesting a
longer window is rejected outright, regardless of whether its signature is
otherwise valid. Without this, the script's TTL argument would be pure
convention: nothing server-side would stop a token from being minted with an
effectively permanent expiry. The cap means even a mistakenly huge TTL, or a
worst case where `SIGNING_KEY` itself ever leaked, is bounded to at most a
120-minute window rather than unlimited.

## Use it with CloudflareSpeedTest

Generate a URL right before you run the test (see above), then:
```bash
CloudflareSpeedTest -url "$(SPEEDTEST_SIGNING_KEY="..." ./scripts/gen-url.sh <your-domain> 600)" -debug
```
If the test run (ping phase + download phase) might take longer than the
default 10-minute window, pass a larger TTL as the second argument (up to
120 minutes — see the cap noted above).

## Optional: fixed-size test files, for manual spot-checks only

Append a size as a second path segment — `50m.test`, `100m.test`, `1g.test`
(`k`/`m`/`g`, decimals allowed, `.test` optional) — to get back exactly that
many bytes with a real `Content-Length`, instead of the endless stream:
```bash
TOKEN=$(SPEEDTEST_SIGNING_KEY="..." ./scripts/gen-url.sh <your-domain> 600)
curl -o /dev/null -w '%{http_code} %{size_download} bytes\n' "${TOKEN}/50m.test"
```
**Don't point CloudflareSpeedTest's `-url` at a sized variant.** If the
requested size is small enough that a fast connection finishes downloading it
before your `-dt` timeout elapses, the transfer ends on its own — and
`download.go`'s throughput sampler is specifically not designed to handle that
correctly (see below). Use the bare token path (unbounded) for the actual
tool; use sized paths only for your own `curl`/browser verification.

## Built-in safety cap

Each connection is force-closed after 5 minutes of wall-clock time regardless
of client behavior (`MAX_DURATION_MS` in `src/index.js`) — a backstop against
a stuck or abusive connection, well above any realistic `-dt` value. Adjust
the constant if you routinely run much longer tests.

## Hardening beyond the signed token

A signed, expiring token is already a meaningfully stronger position than a
static secret path — but it's not a hard deny either (nothing stops someone
from replaying a captured URL until it expires). For real access control:

- **Custom domain + WAF rule.** Attach the Worker to a domain you own
  (Workers & Pages → your worker → Settings → Domains & Routes → Add Custom
  Domain), then add a WAF custom rule (Security → WAF → Custom rules) blocking
  everything except your own IP on that hostname, e.g.:
  ```
  (http.host eq "speedtest.example.com") and not ip.src in {203.0.113.10}
  ```
  Since the path itself is no longer a fixed string to match against, scoping
  by hostname (rather than a path substring) is simpler and still correct —
  nothing on this hostname ever returns anything but `404` without a valid
  signature anyway.
- **Rate limiting rule** on the same route as a backstop even if a URL leaks
  during its validity window.

## Troubleshooting

- **Getting `0` speed:** confirm you're hitting the bare token path, not a
  sized variant small enough to finish before `-dt` elapses (see above).
- **`404` even with a URL you just generated:** the most common cause is the
  script's `SPEEDTEST_SIGNING_KEY` not matching the Worker's `SIGNING_KEY`
  secret exactly (whitespace, wrong value re-pasted, or it was rotated on one
  side but not the other). Since Cloudflare never lets you read a secret's
  value back, if in doubt just set a brand-new value on both sides together.
- **`404` on a URL that worked a minute ago:** check the TTL you generated it
  with — the default is 10 minutes; pass a longer TTL as `gen-url.sh`'s second
  argument if a full ping+download run needs more time than that.
- **`curl` gets `404` but the dashboard's code-editor preview returns `200`
  for what looks like the same token:** the preview pane and the Worker's
  real, deployed `SIGNING_KEY` secret can differ, and a token you typed
  manually into the preview a few minutes ago may simply have expired by the
  time you check it in a real request. Generate a fresh one and retest rather
  than reusing an old value in either place.
- **`curl` body is literally the text `Not found`:** your request *is*
  reaching this Worker — it's an invalid or expired token (see above), not a
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

## Running from behind a transparent proxy (OpenWrt / Passwall)

If you're running `CloudflareSpeedTest` directly on a router that transparently
proxies its own traffic (e.g. OpenWrt with Passwall/Xray-core, where "proxy the
router itself" is on), the speed test measures your proxy's path instead of
your real WAN — usually not what you want. On OpenWrt's `nftables`/`fw4`
firewall, the most surgical fix is a UID-based exception so only the speed
test process bypasses the proxy, leaving everything else on the router
(and all LAN clients) unaffected:

1. **Create a dedicated user** to run the speed test as, so there's a stable
   UID to match on:
   ```sh
   opkg update && opkg install shadow-useradd
   useradd -M -s /bin/false speedtest
   id -u speedtest   # note this UID
   ```
2. **Find where your proxy actually intercepts local traffic.** Don't assume —
   inspect it:
   ```sh
   nft list ruleset | grep -B2 -A6 'hook output'
   ```
   Look for a `type nat hook output` (or `type route hook output`) chain that
   jumps into a proxy-managed chain (Passwall's is typically named something
   like `PSW_OUTPUT_NAT`/`PSW_OUTPUT_MANGLE`) ending in a `redirect to :<port>`
   or `tproxy ip to :<port>`. **A plain early `accept` verdict for your UID is
   not enough** — `accept` in one base chain only finishes *that* chain; it
   doesn't skip other independently-registered chains at the same hook, so a
   separately-registered NAT-type chain still runs afterward and can still
   redirect the packet. What actually works is checking whether that chain
   already has a built-in bypass convention — Passwall's does, in the form of
   a sentinel packet mark it explicitly checks and returns early on:
   ```
   meta mark 0x000000ff ... return
   ```
   (search for `0x000000ff` or `0xff` in your ruleset near the redirect rule —
   the exact value and chain names can differ by proxy suite/version, so
   confirm against your own output rather than assuming).
3. **Set that same mark for your dedicated UID, early enough to run before the
   proxy's chain** (priority `raw` is early enough for most setups):
   ```sh
   cat > /etc/nftables.d/95-speedtest-bypass.nft <<'EOF'
   chain speedtest_bypass_output {
       type filter hook output priority raw; policy accept;
       meta skuid <UID> meta mark set 0x000000ff accept
   }
   EOF
   /etc/init.d/firewall reload
   ```
   This file gets spliced into `table inet fw4` on every firewall reload (note
   it's a bare `chain` block, no `table` wrapper — that would be a syntax
   error, since it's inserted inside fw4's own table), so it survives reboots
   and proxy service restarts without depending on their dynamically-generated
   chain names.
4. **Run the test as that user**, generating a fresh signed URL first:
   ```sh
   URL=$(SPEEDTEST_SIGNING_KEY="..." ./scripts/gen-url.sh <your-domain> 600)
   su speedtest -c "CloudflareSpeedTest -url \"$URL\" -debug"
   ```
5. **Verify it's actually bypassing** — compare egress (e.g. `curl
   https://cloudflare.com/cdn-cgi/trace`) as the `speedtest` user vs. as
   another user; they should show different exit paths.

If your proxy suite doesn't expose an equivalent bypass-mark convention, the
same UID-matching principle still applies — you'd instead need a competing,
higher-precedence `ip rule` (`ip rule list` to see what your proxy already
installed) rather than an nftables mark.

## Local development (optional, instead of the button)

```bash
npm install -g wrangler
wrangler login
wrangler secret put SIGNING_KEY   # enter a long random value when prompted
wrangler deploy
```

## Why the response never ends on its own

`CloudflareSpeedTest`'s `download.go` samples throughput in ~100ms slices and
only avoids a false "0 speed" result if the transfer never reaches EOF on its
own — it should only ever be cut off by the client's own `-dt` timeout (or the
5-minute safety cap above). That's why the unbounded path has no
`Content-Length` and never closes itself; see the `pull()` callback in
[`src/index.js`](src/index.js).
