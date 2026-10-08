# Nota privacy policy

Updated October 5, 2026.

This page describes the current source implementation. A release's build configuration and enabled integrations affect its network behavior; read the release notes for the installer you use.

## Local workspace and AI

Workspace documents, attachments, meeting recordings, transcripts, and derived search data are stored locally. Local AI settings and downloaded models also use local application data. Hosted-provider API keys entered in AI Settings are persisted in a local settings file; this is not a claim that every setting is protected by the operating-system keychain.

Local inference processes data on your device. Initial managed-model downloads contact the upstream host, generally Hugging Face, which receives ordinary download-request information such as your IP address. Model files and local AI settings remain separate from a public source checkout.

When you explicitly choose a hosted AI provider, the app sends the prompt and relevant context to that provider using your API key. Depending on the operation, context can include selected document text, workspace search results, meeting transcripts, or image-generation inputs. That provider's retention and privacy terms apply. A missing local model does not automatically select a hosted provider merely because a key is saved.

## Recording

Recording uses operating-system permissions for microphone and system audio. Saved meeting output belongs to your local workspace. Optional Apple Speech features use Apple's framework and its platform capabilities; availability depends on the release and OS.

## Optional Google connection

You can use Nota locally without a Google account. Connecting Google uses Google sign-in and the configured hosted OAuth broker. The current connection requests these permissions; review Google's consent screen for the permissions requested by your build:

- `openid`, `email`, and `profile` identify the connected account and display its basic profile, including account identifier, email address, name, and profile picture when supplied by Google.
- `https://www.googleapis.com/auth/drive.appdata` reads and writes Nota workspace documents, attachments, and other synced workspace data in Google Drive's app-specific `appDataFolder`. It does not grant access to your ordinary Drive files. Workspace content sent to Drive remains in your Google account.
- `https://www.googleapis.com/auth/calendar.readonly` lists readable calendars and reads events from calendars you select for Nota's meeting workflow. Data can include calendar names and event identifiers, titles, descriptions, locations, start/end times, meeting links, attendee email addresses, display names and response status, and organizer details. Nota does not use this permission to change events.

Nota does not request Gmail mailbox access. Signing in with a Gmail address does not allow Nota to read your email.

### Google data handling and security

The OAuth broker processes authorization codes, access and refresh tokens, and basic account-profile information to complete and refresh a connection. Its Calendar routes process calendar and event responses. The current broker has no durable account or token database: it returns encrypted token envelopes to the app and decrypts them when needed for authorized requests. It uses AES-256-GCM for those envelopes. Authorization-code handoff envelopes expire after five minutes; refresh-token envelopes expire after 180 days. Those expiry periods are not a retention promise for Google or the hosting service's operational logs.

Supported desktop builds persist the Google session using Electron's operating-system-backed encryption. The app refuses to persist the session if encryption is unavailable or uses the unprotected `basic_text` fallback. This protection applies to the Google session; it is not a claim that every local setting or hosted-provider key uses a keychain.

Google and the broker's hosting service can receive operational metadata, such as IP addresses, request times, and error information, and maintain their own logs. Their applicable policies and infrastructure configuration govern that processing. This policy does not promise that infrastructure records no requests.

### Google API Limited Use

Nota's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Google Workspace API data, including Calendar data, is also subject to the [Google Workspace API User Data and Developer Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

Google user data is used to provide the Google connection, user-owned Drive sync, and Calendar meeting features you choose. Nota does not sell Google user data, use it for advertising, or use it to train generalized AI or machine-learning models. Nota does not operate a model-training pipeline.

If you choose hosted AI for workspace or meeting content, including content you brought in through a Google feature, relevant context may be sent to the chosen provider to fulfill your request. Transfers of Google-derived content for a user-requested feature remain subject to Limited Use: that content must not be used for advertising or to train generalized AI or machine-learning models. Choosing a hosted provider does not waive these restrictions. Integrations processing this data must use terms and settings that meet Google's requirements. The chosen provider's retention and processing terms also apply. This policy states Nota's obligations; it does not certify an independent provider or every user-configured integration.

Human access to Google user data is limited to cases permitted by the Limited Use requirements: your affirmative permission to access specific data, a necessary security or abuse investigation, compliance with applicable law, or internal operations using aggregated and de-identified data.

### Disconnecting, revoking access, and deleting copies

Disconnecting Google in Nota clears the local Google session. It does not revoke Google's authorization grant or delete synced workspace data and backups. To stop future Google access, also remove Nota's access from [your Google account's third-party connections](https://myaccount.google.com/connections).

You control retained local workspace content, exports, backups, and the app data in your Google account. Delete copies you no longer want from the relevant device or service. Revoking authorization prevents further authorized access; it does not automatically erase content already saved locally, exported, or retained by another service. Broker envelope expiry does not delete those copies.

## Other integrations

Configured MCP servers, public-page crawling, external links, updates, and some export operations can also make network requests. Only enable integrations you intend to use. Data sent to an external tool or service is subject to that service's behavior and terms.

## Diagnostics

The current frontend bootstrap disables usage-event tracking and renderer Sentry reporting. The source retains telemetry and Sentry support. Electron main-process Sentry reporting can be enabled by release build configuration, so this page does not promise that every custom or future build sends no diagnostics. A build that enables diagnostics must identify that configuration in its release notes.

The app can write local logs for failures and troubleshooting. Logs and screenshots may contain paths, document titles, or error context; inspect them before sharing. Do not submit API keys, authorization tokens, recordings, or personal workspace content in public issues.

## Your data and copies

You control your local workspace and optional exports/backups. Retention depends on the data and backups you keep, OS storage, and any services you explicitly use. Removing the app does not necessarily remove application data, exported files, or remote backups.

## Contact

For privacy questions or requests, email [kunjkariya@gmail.com](mailto:kunjkariya@gmail.com). For public product questions, use [GitHub Issues](https://github.com/madcodeorg/nota/issues). Do not post sensitive information in public issues, and do not email API keys or authorization tokens.
