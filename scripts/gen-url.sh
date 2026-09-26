#!/usr/bin/env bash
# Generate a fresh, time-limited signed test URL.
#
# Usage:
#   SPEEDTEST_SIGNING_KEY="..." ./gen-url.sh <domain> [ttl_seconds]
#
# Example:
#   SPEEDTEST_SIGNING_KEY="the value you set in SIGNING_KEY" ./gen-url.sh speedtest.vura.cc 600
#
# Prints a URL valid for `ttl_seconds` (default 600 = 10 minutes) from now.
# Requires `openssl` (present on virtually every Linux/macOS system, including OpenWrt with
# the `openssl-util` package).

set -euo pipefail

: "${SPEEDTEST_SIGNING_KEY:?Set SPEEDTEST_SIGNING_KEY to the same value as the Worker SIGNING_KEY secret}"

DOMAIN="${1:?Usage: $0 <domain> [ttl_seconds]}"
TTL="${2:-600}"

EXP=$(( $(date +%s) + TTL ))
SIG=$(printf '%s' "$EXP" | openssl dgst -sha256 -hmac "$SPEEDTEST_SIGNING_KEY" -hex | awk '{print $2}')

echo "https://${DOMAIN}/${EXP}-${SIG}"
