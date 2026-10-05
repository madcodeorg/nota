# Google OAuth Broker

Nota can keep the desktop app local-first while using any hosted HTTPS service
as the Google OAuth broker for Drive backup. The production app should set
`GOOGLE_AUTH_BROKER_URL` to the deployed broker origin, for example
`https://thenota.app` or an Azure Container Apps URL.

## Hosted Routes

The broker exposes these HTTP routes:

- `GET /api/google/start?redirect_uri=...`
- `GET /api/google/callback`
- `POST /api/google/redeem-code`
- `POST /api/google/refresh`
- `GET /api/google/calendar/calendars`
- `POST /api/google/calendar/events`

The desktop app opens `/api/google/start` in a browser. Google redirects back to
`/api/google/callback`, the broker redirects to the app loopback callback with a
short-lived encrypted `broker_code`, and the app redeems that for a Google
access token plus an encrypted broker refresh token. These routes can run as
serverless functions or behind a normal Node HTTP server.

## Azure Container

The deploy script builds the container in Azure Container Registry, deploys it
to Azure Container Apps, and sets secrets/env vars through Azure CLI only.

Local shell variables for working Google sign-in:

```sh
export GOOGLE_OAUTH_CLIENT_ID=...
export GOOGLE_OAUTH_CLIENT_SECRET=...
```

Optional shell variables:

```sh
export GOOGLE_OAUTH_TOKEN_SECRET=...
export AZURE_RESOURCE_GROUP=nota-launch-rg
export AZURE_LOCATION=westus3
export AZURE_CONTAINER_ENV=nota-launch-cae
export AZURE_CONTAINER_APP_NAME=nota-google-oauth-broker
export AZURE_ACR_NAME=notaoauth...
```

Deploy:

```sh
./server/google-oauth-broker/deploy-azure.sh
```

If `GOOGLE_OAUTH_TOKEN_SECRET` is missing and the Container App does not already
have a `google-oauth-token-secret`, the script generates one and stores it as an
Azure Container App secret.

The script can also deploy the download page and broker shell without
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, but `/api/google/start`
will return a config error until those two real Google OAuth values are set.

## Vercel

`thenota.app` is hosted through the Vercel `nota` project. The deploy script
packages only `public/`, `api/google/`, and the broker helper modules into a
temporary deployment context so Vercel does not run the full monorepo build.

Deploy:

```sh
./server/google-oauth-broker/deploy-vercel.sh
```

Required production environment variables:

```sh
vercel env add GOOGLE_OAUTH_CLIENT_ID production
vercel env add GOOGLE_OAUTH_CLIENT_SECRET production
vercel env add GOOGLE_OAUTH_TOKEN_SECRET production
vercel env add GOOGLE_OAUTH_REDIRECT_URI production
vercel env add NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS production
vercel env add GOOGLE_OAUTH_SCOPES production
```

Use `https://thenota.app/api/google/callback` for
`GOOGLE_OAUTH_REDIRECT_URI`.

After creating the Google Web OAuth client, configure both hosted targets
without storing the secret in the repo:

```sh
export GOOGLE_OAUTH_CLIENT_ID='...apps.googleusercontent.com'
export GOOGLE_OAUTH_CLIENT_SECRET='...'
# Optional when Azure should handle its own Google callback instead of thenota.app.
export AZURE_GOOGLE_OAUTH_REDIRECT_URI='https://<azure-host>/api/google/callback'
./server/google-oauth-broker/configure-hosted-env.sh
./server/google-oauth-broker/deploy-vercel.sh
```

To turn on Google sign-in after the container is live, set the secrets and env
refs from Azure CLI:

```sh
az containerapp secret set \
  --name nota-google-oauth-broker \
  --resource-group nota-launch-rg \
  --secrets \
    google-oauth-client-id="$GOOGLE_OAUTH_CLIENT_ID" \
    google-oauth-client-secret="$GOOGLE_OAUTH_CLIENT_SECRET"

az containerapp update \
  --name nota-google-oauth-broker \
  --resource-group nota-launch-rg \
  --set-env-vars \
    GOOGLE_OAUTH_CLIENT_ID=secretref:google-oauth-client-id \
    GOOGLE_OAUTH_CLIENT_SECRET=secretref:google-oauth-client-secret \
    GOOGLE_OAUTH_REDIRECT_URI=https://<azure-host>/api/google/callback
```

The generic container entrypoint is:

```sh
node server/google-oauth-broker/standalone.cjs
```

Build the container from the repo root:

```sh
docker build -f server/google-oauth-broker/Dockerfile -t nota-google-oauth-broker .
```

Run locally:

```sh
docker run --rm -p 8080:8080 \
  -e GOOGLE_OAUTH_CLIENT_ID=... \
  -e GOOGLE_OAUTH_CLIENT_SECRET=... \
  -e GOOGLE_OAUTH_TOKEN_SECRET=... \
  -e GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8080/api/google/callback \
  nota-google-oauth-broker
```

For Azure Container Apps or App Service for Containers:

- Expose port `8080`.
- Set `GOOGLE_AUTH_BROKER_URL` in the app build to the public Azure HTTPS
  origin.
- Set `GOOGLE_OAUTH_REDIRECT_URI` in the container to
  `https://<azure-host>/api/google/callback`.
- Add that same callback URL to Google Cloud Console as an authorized redirect
  URI.

## Required Environment

Set these on the hosted broker:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_TOKEN_SECRET`: random high-entropy string used to encrypt broker
  codes and broker refresh tokens.
- `GOOGLE_OAUTH_REDIRECT_URI`: usually
  `https://<broker-host>/api/google/callback`.
- `NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS`: comma-separated app callback origins.
  Include `http://localhost:41013` for the desktop loopback callback.
- `GOOGLE_OAUTH_SCOPES`: optional. Defaults to `openid email profile
https://www.googleapis.com/auth/drive.appdata
https://www.googleapis.com/auth/calendar.readonly`.

Set this in the app build that should use the broker:

- `GOOGLE_AUTH_BROKER_URL=https://thenota.app`
- For Azure, use the public Azure HTTPS origin instead, for example
  `GOOGLE_AUTH_BROKER_URL=https://<app-name>.<region>.azurecontainerapps.io`.

Keep `GOOGLE_CLIENT_ID` only for local/dev direct PKCE builds. It is not a
secret, but the broker flow should be the production path when using a Google
web OAuth client secret.

## Google Cloud Console

Enable the Google Drive API and Google Calendar API in the same Google Cloud
project.

For production/broker mode, configure the OAuth client as a web application and
add:

- Authorized redirect URI: `https://thenota.app/api/google/callback`
- JavaScript origins as needed for the deployed site.

The desktop loopback URL is not registered with Google in broker mode. It is
only validated by the broker and receives the encrypted broker code after the
hosted callback completes.

For local direct PKCE development without the broker, use `GOOGLE_CLIENT_ID`
from a desktop OAuth client. Do not put a web OAuth client secret into the app
bundle.

## Calendar Scope And API Calls

Drive backup and Google Calendar use the same local Google token store. New
Google sign-ins must include the minimum Calendar scope:
`https://www.googleapis.com/auth/calendar.readonly`. Existing users who signed
in before this scope was requested need to disconnect and reconnect Google to
grant Calendar access.

The app calls Calendar through server routes rather than calling Calendar v3
directly from UI code:

- Broker mode: `${GOOGLE_AUTH_BROKER_URL}/api/google/calendar/calendars` and
  `${GOOGLE_AUTH_BROKER_URL}/api/google/calendar/events`
- Local backend mode: `/v1/google/calendar/calendars` and
  `/v1/google/calendar/events`

Both route families require `Authorization: Bearer <google-access-token>`.
Calendar events are read-only and use the user's OAuth grant; no Nota-managed
Google service account is involved.

## Cost

Google Drive and Calendar API usage does not have a per-request Google charge
for normal API access, but it is subject to Google quota, verification, and
consent-screen requirements. Hosting the broker may incur normal Azure
container/runtime costs depending on traffic and plan limits.
