#!/usr/bin/env bash
set -euo pipefail

resolve_vercel_bin() {
  if [[ -n "${VERCEL_BIN:-}" ]]; then
    printf '%s' "${VERCEL_BIN}"
    return
  fi

  if command -v vercel >/dev/null 2>&1; then
    command -v vercel
    return
  fi

  if [[ -x "${HOME}/.hermes/node/bin/vercel" ]]; then
    printf '%s' "${HOME}/.hermes/node/bin/vercel"
    return
  fi

  echo "Could not find Vercel CLI. Set VERCEL_BIN or install vercel." >&2
  exit 1
}

VERCEL_PROJECT="${VERCEL_PROJECT:-nota}"
VERCEL_BIN="$(resolve_vercel_bin)"
DEPLOY_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${DEPLOY_DIR}"
}
trap cleanup EXIT

mkdir -p "${DEPLOY_DIR}/api" "${DEPLOY_DIR}/server/google-oauth-broker"
cp -R api/google "${DEPLOY_DIR}/api/google"
cp -R public "${DEPLOY_DIR}/public"
cp \
  server/google-oauth-broker/calendar.cjs \
  server/google-oauth-broker/shared.cjs \
  "${DEPLOY_DIR}/server/google-oauth-broker/"

cat >"${DEPLOY_DIR}/package.json" <<'JSON'
{"private":true,"engines":{"node":"22.x"}}
JSON

cat >"${DEPLOY_DIR}/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "redirects": [
    {
      "source": "/download",
      "destination": "https://github.com/madcodeorg/nota/releases",
      "permanent": false
    }
  ],
  "rewrites": [
    {
      "source": "/",
      "destination": "/launch.html"
    }
  ]
}
JSON

"${VERCEL_BIN}" deploy "${DEPLOY_DIR}" --prod --yes --project "${VERCEL_PROJECT}" "$@"
