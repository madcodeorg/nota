# Building Nota

Run commands from the repository root unless stated otherwise. For desktop packaging, also read [Building the desktop app](building-desktop-client-app.md). For the local AI service, see [Local AI backend](developing-ai-backend.md).

## Prerequisites

- Node.js `22.22.1`, pinned in [`.nvmrc`](../.nvmrc).
- Yarn `4.12.0`, pinned in [`package.json`](../package.json) and [`.yarnrc.yml`](../.yarnrc.yml).
- Rust `1.93.1`, pinned in [`rust-toolchain.toml`](../rust-toolchain.toml). Install [rustup](https://rustup.rs); it selects the pinned toolchain in this directory.
- A C/C++ build toolchain for native modules. Desktop ASR helpers also require CMake and platform development tools. macOS builds use Xcode command-line tools; building the optional Apple SpeechAnalyzer helper needs a compatible full Xcode/macOS SDK as documented in the desktop guide.

On Windows, enable [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development) and Git symbolic-link support before cloning. The workspace uses symbolic links. Native compilation also needs the Visual Studio C++ toolchain.

## Clone and install

```sh
git clone https://github.com/madcodeorg/nota.git
cd nota
# Select Node 22.22.1 with your preferred version manager.
corepack enable
yarn install
```

Do not copy another developer's `.nota`, application-data directories, credentials, or build outputs into a source checkout. Model downloads and user settings are local runtime data.

## Build the native module

```sh
yarn nota @nota/native build
```

This builds the complete `nota_native` NAPI module, including workspace storage and indexing. A media-capture-only addon does not replace it. The build preserves the maintained `packages/frontend/native/index.js` and `index.d.ts`; generated declarations go to ignored `index.generated.d.ts`. When changing a Rust interface, deliberately update the maintained declarations to match.

## Development

For the web UI:

```sh
yarn dev --package @nota/web
```

For the frontend with the local AI service:

```sh
yarn dev:ai
```

For desktop development, see the [Electron development steps](building-desktop-client-app.md#development). `yarn dev` without a package selector opens a package prompt.

Local models are configured through Settings or the AI service's documented local configuration. Hosted providers are optional and use user-owned credentials. A basic source checkout does not include AI model weights.

## Validation

Use the smallest test that covers your change first. Root scripts are declared in [`package.json`](../package.json):

```sh
yarn test
yarn typecheck
yarn lint
```

For the local web end-to-end suite, install the required Playwright browser and run the existing package script:

```sh
yarn exec playwright install chromium
yarn workspace @nota-test/nota-local e2e
```

The end-to-end configuration starts the web development server and can reuse an existing local server. Running a command successfully in development does not validate the contents, signatures, or first-launch behavior of a packaged installer.
