#!/bin/sh
# Generate a signed nginx secure_link URL, for the VPS+nginx origin alternative
# to the Worker (see README: "Alternative: VPS + nginx origin").
# POSIX sh — works under OpenWrt's BusyBox ash too.
#
# Usage:
#   NGINX_SECURE_LINK_SECRET="..." ./gen-url-nginx.sh <domain> <uri-path> [ttl_seconds]
# Example:
#   NGINX_SECURE_LINK_SECRET="my-shared-secret-here" \
#     ./gen-url-nginx.sh vps.example.com /speedtest/payload.bin
#
# Requires the openssl CLI. On OpenWrt this is NOT installed by default:
#   opkg update && opkg install openssl-util

set -eu

: "${NGINX_SECURE_LINK_SECRET:?Set NGINX_SECURE_LINK_SECRET to match secure_link_md5 in nginx.conf}"

DOMAIN="${1:?Usage: $0 <domain> <uri-path> [ttl_seconds]}"
URI="${2:?Usage: $0 <domain> <uri-path> [ttl_seconds]}"
TTL="${3:-3600}"

EXPIRES=$(( $(date +%s) + TTL ))

MD5=$(printf '%s' "${EXPIRES}${URI} ${NGINX_SECURE_LINK_SECRET}" \
  | openssl dgst -md5 -binary \
  | openssl base64 -A \
  | tr '+/' '-_' | tr -d '=')

echo "https://${DOMAIN}${URI}?md5=${MD5}&expires=${EXPIRES}"
