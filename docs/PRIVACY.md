# Nota privacy information

Updated October 5, 2026.

This page describes the current source implementation. A release's build configuration and enabled integrations affect its network behavior; read the release notes for the installer you use.

## Local workspace and AI

Workspace documents, attachments, meeting recordings, transcripts, and derived search data are stored locally. Local AI settings and downloaded models also use local application data. Hosted-provider API keys entered in AI Settings are persisted in a local settings file; this is not a claim that every setting is protected by the operating-system keychain.

Local inference processes data on your device. Initial managed-model downloads contact the upstream host, generally Hugging Face, which receives ordinary download-request information such as your IP address. Model files and local AI settings remain separate from a public source checkout.

When you explicitly choose a hosted AI provider, the app sends the prompt and relevant context to that provider using your API key. Depending on the operation, context can include selected document text, workspace search results, meeting transcripts, or image-generation inputs. That provider's retention and privacy terms apply. A missing local model does not automatically select a hosted provider merely because a key is saved.

## Recording and integrations

Recording uses operating-system permissions for microphone and system audio. Saved meeting output belongs to your local workspace. Optional Apple Speech features use Apple's framework and its platform capabilities; availability depends on the release and OS.

Google connection is optional. When enabled, the OAuth flow uses Google and the configured hosted broker. The broker processes authorization codes, access/refresh tokens, and basic account-profile information to complete and refresh the connection. Its Calendar routes also process calendar and event responses when that integration is used. Requested scopes can include Google Drive app-data access and read-only Calendar access; review Google's consent screen for the actual request.

Authorizing Drive allows workspace data to be sent to your Google account. Google and the broker's hosting service can receive network-request metadata and maintain their own logs. Disconnect in Nota and revoke the app's access in your Google account when you no longer want the integration. This does not delete data or backups already retained elsewhere.

Configured MCP servers, public-page crawling, external links, updates, and some export operations can also make network requests. Only enable integrations you intend to use. Data sent to an external tool or service is subject to that service's behavior and terms.

## Diagnostics

The current frontend bootstrap disables usage-event tracking and renderer Sentry reporting. The source retains telemetry and Sentry support. Electron main-process Sentry reporting can be enabled by release build configuration, so this page does not promise that every custom or future build sends no diagnostics. A build that enables diagnostics must identify that configuration in its release notes.

The app can write local logs for failures and troubleshooting. Logs and screenshots may contain paths, document titles, or error context; inspect them before sharing. Do not submit API keys, authorization tokens, recordings, or personal workspace content in public issues.

## Your data and copies

You control your local workspace and optional exports/backups. Retention depends on the data and backups you keep, OS storage, and any services you explicitly use. Removing the app does not necessarily remove application data, exported files, or remote backups.

For public product questions, use [GitHub Issues](https://github.com/madcodeorg/nota/issues). For a request containing sensitive information, use a private contact method published by a repository maintainer; do not post the private information publicly.
