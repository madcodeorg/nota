#!/usr/bin/env bash
set -euo pipefail

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

default_acr_name() {
  local subscription_id suffix
  subscription_id="$(az account show --query id -o tsv)"
  suffix="$(printf '%s' "${subscription_id}" | shasum | awk '{print substr($1, 1, 10)}')"
  printf 'notaoauth%s' "${suffix}"
}

containerapp_exists() {
  az containerapp show \
    --name "${AZURE_CONTAINER_APP_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    >/dev/null 2>&1
}

containerapp_secret_exists() {
  local secret_name="$1"
  containerapp_exists &&
    az containerapp secret list \
      --name "${AZURE_CONTAINER_APP_NAME}" \
      --resource-group "${AZURE_RESOURCE_GROUP}" \
      --query '[].name' \
      -o tsv |
    grep -qx "${secret_name}"
}

wait_for_fqdn() {
  local fqdn
  for _ in $(seq 1 30); do
    fqdn="$(
      az containerapp show \
        --name "${AZURE_CONTAINER_APP_NAME}" \
        --resource-group "${AZURE_RESOURCE_GROUP}" \
        --query 'properties.configuration.ingress.fqdn' \
        -o tsv
    )"
    if [[ -n "${fqdn}" ]]; then
      printf '%s' "${fqdn}"
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for Container App FQDN" >&2
  return 1
}

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-nota-launch-rg}"
AZURE_LOCATION="${AZURE_LOCATION:-westus3}"
AZURE_CONTAINER_ENV="${AZURE_CONTAINER_ENV:-nota-launch-cae}"
AZURE_CONTAINER_APP_NAME="${AZURE_CONTAINER_APP_NAME:-nota-google-oauth-broker}"
AZURE_ACR_NAME="${AZURE_ACR_NAME:-$(default_acr_name)}"
AZURE_IMAGE_NAME="${AZURE_IMAGE_NAME:-nota-google-oauth-broker}"
AZURE_IMAGE_TAG="${AZURE_IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS="${NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS:-http://localhost:41013,http://127.0.0.1:41013,https://thenota.app,https://www.thenota.app}"
GOOGLE_OAUTH_SCOPES="${GOOGLE_OAUTH_SCOPES:-openid email profile https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.readonly}"

HAS_GOOGLE_OAUTH=false
if [[ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" || -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]]; then
  required GOOGLE_OAUTH_CLIENT_ID
  required GOOGLE_OAUTH_CLIENT_SECRET
  HAS_GOOGLE_OAUTH=true
else
  echo "GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set; deploying download page and broker shell only."
fi

if [[ -z "${GOOGLE_OAUTH_TOKEN_SECRET:-}" ]]; then
  if containerapp_secret_exists google-oauth-token-secret; then
    echo "Reusing existing Azure secret: google-oauth-token-secret"
  else
    GOOGLE_OAUTH_TOKEN_SECRET="$(openssl rand -base64 48)"
    echo "Generated GOOGLE_OAUTH_TOKEN_SECRET for Azure secret storage"
  fi
fi

LOGIN_SERVER="${AZURE_ACR_NAME}.azurecr.io"
IMAGE="${LOGIN_SERVER}/${AZURE_IMAGE_NAME}:${AZURE_IMAGE_TAG}"
BUILD_CONTEXT="$(mktemp -d)"

cleanup() {
  rm -rf "${BUILD_CONTEXT}"
}
trap cleanup EXIT

mkdir -p "${BUILD_CONTEXT}/api" "${BUILD_CONTEXT}/server/google-oauth-broker"
cp -R api/google "${BUILD_CONTEXT}/api/google"
cp -R public "${BUILD_CONTEXT}/public"
cp \
  server/google-oauth-broker/Dockerfile \
  server/google-oauth-broker/calendar.cjs \
  server/google-oauth-broker/standalone.cjs \
  server/google-oauth-broker/shared.cjs \
  "${BUILD_CONTEXT}/server/google-oauth-broker/"

echo "Creating/updating Azure resource group: ${AZURE_RESOURCE_GROUP} (${AZURE_LOCATION})"
az group create \
  --name "${AZURE_RESOURCE_GROUP}" \
  --location "${AZURE_LOCATION}" \
  --output none

if ! az acr show --name "${AZURE_ACR_NAME}" --resource-group "${AZURE_RESOURCE_GROUP}" >/dev/null 2>&1; then
  echo "Creating Azure Container Registry: ${AZURE_ACR_NAME}"
  az acr create \
    --name "${AZURE_ACR_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --location "${AZURE_LOCATION}" \
    --sku Basic \
    --admin-enabled true \
    --output none
else
  echo "Using Azure Container Registry: ${AZURE_ACR_NAME}"
  az acr update \
    --name "${AZURE_ACR_NAME}" \
    --admin-enabled true \
    --output none
fi

echo "Building image in ACR: ${IMAGE}"
az acr build \
  --registry "${AZURE_ACR_NAME}" \
  --image "${AZURE_IMAGE_NAME}:${AZURE_IMAGE_TAG}" \
  --file server/google-oauth-broker/Dockerfile \
  "${BUILD_CONTEXT}" \
  --output none

if ! az containerapp env show --name "${AZURE_CONTAINER_ENV}" --resource-group "${AZURE_RESOURCE_GROUP}" >/dev/null 2>&1; then
  echo "Creating Container Apps environment: ${AZURE_CONTAINER_ENV}"
  az containerapp env create \
    --name "${AZURE_CONTAINER_ENV}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --location "${AZURE_LOCATION}" \
    --output none
else
  echo "Using Container Apps environment: ${AZURE_CONTAINER_ENV}"
fi

REGISTRY_USERNAME="$(az acr credential show --name "${AZURE_ACR_NAME}" --query username -o tsv)"
REGISTRY_PASSWORD="$(az acr credential show --name "${AZURE_ACR_NAME}" --query 'passwords[0].value' -o tsv)"

SECRET_ARGS=()
if [[ "${HAS_GOOGLE_OAUTH}" == true ]]; then
  SECRET_ARGS+=(
    "google-oauth-client-id=${GOOGLE_OAUTH_CLIENT_ID}"
    "google-oauth-client-secret=${GOOGLE_OAUTH_CLIENT_SECRET}"
  )
fi
if [[ -n "${GOOGLE_OAUTH_TOKEN_SECRET:-}" ]]; then
  SECRET_ARGS+=("google-oauth-token-secret=${GOOGLE_OAUTH_TOKEN_SECRET}")
fi

if containerapp_exists; then
  echo "Updating Container App image and registry: ${AZURE_CONTAINER_APP_NAME}"
  az containerapp registry set \
    --name "${AZURE_CONTAINER_APP_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --server "${LOGIN_SERVER}" \
    --username "${REGISTRY_USERNAME}" \
    --password "${REGISTRY_PASSWORD}" \
    --output none

  if [[ ${#SECRET_ARGS[@]} -gt 0 ]]; then
    az containerapp secret set \
      --name "${AZURE_CONTAINER_APP_NAME}" \
      --resource-group "${AZURE_RESOURCE_GROUP}" \
      --secrets "${SECRET_ARGS[@]}" \
      --output none
  fi

  az containerapp update \
    --name "${AZURE_CONTAINER_APP_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --image "${IMAGE}" \
    --output none
else
  echo "Creating Container App: ${AZURE_CONTAINER_APP_NAME}"
  az containerapp create \
    --name "${AZURE_CONTAINER_APP_NAME}" \
    --resource-group "${AZURE_RESOURCE_GROUP}" \
    --environment "${AZURE_CONTAINER_ENV}" \
    --image "${IMAGE}" \
    --ingress external \
    --target-port 8080 \
    --registry-server "${LOGIN_SERVER}" \
    --registry-username "${REGISTRY_USERNAME}" \
    --registry-password "${REGISTRY_PASSWORD}" \
    --env-vars PORT=8080 \
    --output none

  if [[ ${#SECRET_ARGS[@]} -gt 0 ]]; then
    az containerapp secret set \
      --name "${AZURE_CONTAINER_APP_NAME}" \
      --resource-group "${AZURE_RESOURCE_GROUP}" \
      --secrets "${SECRET_ARGS[@]}" \
      --output none
  fi
fi

FQDN="$(wait_for_fqdn)"
GOOGLE_AUTH_BROKER_URL="${GOOGLE_AUTH_BROKER_URL:-https://${FQDN}}"
GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-${GOOGLE_AUTH_BROKER_URL}/api/google/callback}"

echo "Setting Container App broker environment from Azure CLI"
ENV_ARGS=(
  PORT=8080
  GOOGLE_OAUTH_TOKEN_SECRET=secretref:google-oauth-token-secret
  "GOOGLE_OAUTH_REDIRECT_URI=${GOOGLE_OAUTH_REDIRECT_URI}"
  "NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS=${NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS}"
  "GOOGLE_OAUTH_SCOPES=${GOOGLE_OAUTH_SCOPES}"
)
if [[ "${HAS_GOOGLE_OAUTH}" == true ]]; then
  ENV_ARGS+=(
    GOOGLE_OAUTH_CLIENT_ID=secretref:google-oauth-client-id
    GOOGLE_OAUTH_CLIENT_SECRET=secretref:google-oauth-client-secret
  )
fi

az containerapp update \
  --name "${AZURE_CONTAINER_APP_NAME}" \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --set-env-vars "${ENV_ARGS[@]}" \
  --output none

echo "Broker URL: ${GOOGLE_AUTH_BROKER_URL}"
echo "Google redirect URI: ${GOOGLE_OAUTH_REDIRECT_URI}"
echo "App build env: GOOGLE_AUTH_BROKER_URL=${GOOGLE_AUTH_BROKER_URL}"
