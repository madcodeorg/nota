# Getting started with Nota

## Choose a release

Open [GitHub Releases](https://github.com/madcodeorg/nota/releases). Each published release lists its installers, supported operating systems and architectures, checksums, and known limitations. If your platform has no asset, there is no public installer for that platform in that release.

The source code includes web, desktop, and mobile packages. Platform source or CI configuration does not establish public download availability. Use the [build guide](../BUILDING.md) if you want to work from source.

## Install and start

Follow the installation instructions attached to the release you choose. On macOS, open the DMG and move Nota to Applications. For other platforms, use the steps supplied with the specific installer.

Open Nota and create or open a local workspace. Keep a separate backup of important workspaces, especially while evaluating a beta. Preserve your existing installation and data until you have checked the new version.

Documents are local workspace content. AI and recording setup should not be prerequisites for writing.

## Set up local AI and meetings

Use AI Settings to download and select a local text model that fits your device. Initial downloads need network access and disk space; local inference needs enough RAM. The model catalog reports device-fit guidance, but very long context windows can need more memory than the listed minimum.

Use Meeting Settings to select an available speech model and configure recording. Current desktop packaging is configured to include Cactus Whistle and Whisper Tiny Q5, about 47 MiB of speech weights, which are installed into local application data on first use. Read the specific release notes for its actual bundled contents. Text AI models require a separate download unless that release explicitly includes them. Microphone and system-audio recording require separate operating-system permissions. Platform-specific capture availability and Apple Speech support are described per release.

After required models are installed, local AI can run without a hosted provider key. Hosted providers are optional, use your own API keys, and require an explicit provider/model selection. Model downloads have separate licenses; see [Third-party notices](../../THIRD_PARTY_NOTICES.md).

## Troubleshooting

- If AI is unavailable, check the selected model's download and runtime status in Settings.
- If recording is unavailable, check microphone/system-audio permissions and the selected speech model.
- If an update behaves unexpectedly, stop and preserve a copy of your workspace before trying recovery steps.
- Report reproducible problems at [GitHub Issues](https://github.com/madcodeorg/nota/issues), with the version, operating system, architecture, and steps to reproduce.

Do not publish personal documents, recordings, API keys, or authorization tokens in issue reports. Remove private content from screenshots and logs.
