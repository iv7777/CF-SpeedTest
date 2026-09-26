#!/bin/sh
# Generate a fresh, time-limited signed test URL.
# Written for POSIX sh / BusyBox ash (OpenWrt's default shell) — no bashisms.
#
# Usage:
#   SPEEDTEST_SIGNING_KEY="..." ./gen-url.sh <domain> [ttl_seconds]
#
# Example:
#   SPEEDTEST_SIGNING_KEY="the value you set in SIGNING_KEY" ./gen-url.sh speedtest.vura.cc 600
#
# Prints a URL valid for ttl_seconds (default 600 = 10 minutes) from now.
#
# Requires the openssl CLI. On OpenWrt this is NOT installed by default even
# if Passwall/Xray-core is present (they don't expose a shell-usable openssl
# binary) — install it first:
#   opkg update && opkg install openssl-util

set -eu

: "${SPEEDTEST_SIGNING_KEY:?Set SPEEDTEST_SIGNING_KEY to the same value as the Worker SIGNING_KEY secret}"

DOMAIN="${1:?Usage: $0 <domain> [ttl_seconds]}"
TTL="${2:-600}"

EXP=$(( $(date +%s) + TTL ))
SIG=$(printf '%s' "$EXP" | openssl dgst -sha256 -hmac "$SPEEDTEST_SIGNING_KEY" -hex | awk '{print $2}')

echo "https://${DOMAIN}/${EXP}-${SIG}"
