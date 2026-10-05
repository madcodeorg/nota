#!/usr/bin/env bash
set -euo pipefail

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

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

vercel_env_add() {
  local name="$1"
  local value="$2"

  printf '%s' "${value}" | "${VERCEL_BIN}" env add "${name}" "${VERCEL_ENVIRONMENT}" \
    --yes \
    --force \
    --non-interactive \
    --cwd "${REPO_ROOT}" \
    >/dev/null
}

required GOOGLE_OAUTH_CLIENT_ID
required GOOGLE_OAUTH_CLIENT_SECRET

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERCEL_PROJECT="${VERCEL_PROJECT:-nota}"
VERCEL_ENVIRONMENT="${VERCEL_ENVIRONMENT:-production}"
VERCEL_BIN="$(resolve_vercel_bin)"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-nota-launch-rg}"
AZURE_CONTAINER_APP_NAME="${AZURE_CONTAINER_APP_NAME:-nota-google-oauth-broker}"
GOOGLE_AUTH_BROKER_URL="${GOOGLE_AUTH_BROKER_URL:-https://thenota.app}"
GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-${GOOGLE_AUTH_BROKER_URL}/api/google/callback}"
AZURE_GOOGLE_OAUTH_REDIRECT_URI="${AZURE_GOOGLE_OAUTH_REDIRECT_URI:-${GOOGLE_OAUTH_REDIRECT_URI}}"
NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS="${NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS:-http://localhost:41013,http://127.0.0.1:41013,https://thenota.app,https://www.thenota.app}"
GOOGLE_OAUTH_SCOPES="${GOOGLE_OAUTH_SCOPES:-openid email profile https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.readonly}"
GOOGLE_OAUTH_TOKEN_SECRET="${GOOGLE_OAUTH_TOKEN_SECRET:-$(openssl rand -base64 48)}"

echo "Configuring Vercel project ${VERCEL_PROJECT} (${VERCEL_ENVIRONMENT})"
vercel_env_add GOOGLE_OAUTH_CLIENT_ID "${GOOGLE_OAUTH_CLIENT_ID}"
vercel_env_add GOOGLE_OAUTH_CLIENT_SECRET "${GOOGLE_OAUTH_CLIENT_SECRET}"
vercel_env_add GOOGLE_OAUTH_TOKEN_SECRET "${GOOGLE_OAUTH_TOKEN_SECRET}"
vercel_env_add GOOGLE_OAUTH_REDIRECT_URI "${GOOGLE_OAUTH_REDIRECT_URI}"
vercel_env_add NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS "${NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS}"
vercel_env_add GOOGLE_OAUTH_SCOPES "${GOOGLE_OAUTH_SCOPES}"

if command -v az >/dev/null 2>&1; then
  echo "Configuring Azure Container App ${AZURE_CONTAINER_APP_NAME}"
  az containerapp secret set \
    --name "${AZURE_CONTAINER_APP_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --secrets \
      "google-oauth-client-id=${GOOGLE_OAUTH_CLIENT_ID}" \
      "google-oauth-client-secret=${GOOGLE_OAUTH_CLIENT_SECRET}" \
      "google-oauth-token-secret=${GOOGLE_OAUTH_TOKEN_SECRET}" \
    --output none

  az containerapp update \
    --name "${AZURE_CONTAINER_APP_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --set-env-vars \
      GOOGLE_OAUTH_CLIENT_ID=secretref:google-oauth-client-id \
      GOOGLE_OAUTH_CLIENT_SECRET=secretref:google-oauth-client-secret \
      GOOGLE_OAUTH_TOKEN_SECRET=secretref:google-oauth-token-secret \
      "GOOGLE_OAUTH_REDIRECT_URI=${AZURE_GOOGLE_OAUTH_REDIRECT_URI}" \
      "NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS=${NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS}" \
      "GOOGLE_OAUTH_SCOPES=${GOOGLE_OAUTH_SCOPES}" \
    --output none
else
  echo "Azure CLI not found; skipped Azure Container App env update."
fi

echo "Hosted Google OAuth environment is configured."
