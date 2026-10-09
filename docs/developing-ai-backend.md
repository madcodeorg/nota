# Local AI Backend

Nota's local AI backend lives in `packages/backend/ai` and uses AI SDK 7 for chat streaming, provider-agnostic reasoning controls, tools, and image generation. It is the only backend used by the local copilot channel; do not add a second agent runtime for that path.

## Start frontend with AI

```sh
yarn dev:ai
```

This starts the AI backend on `http://localhost:3010` and the normal frontend dev server with `/graphql` and `/api` proxied to that backend.

## Start only the backend

```sh
yarn dev:ai-backend
```

## Provider routing

The default provider is local and uses Nota's managed ONNX catalog. An OpenAI-compatible local server remains supported by selecting one of its discovered models:

```sh
NOTA_AI_PROVIDER=local
NOTA_AI_LOCAL_MODEL=gemma-4-e2b-it-onnx-q4f16
NOTA_AI_LOCAL_BASE_URL=http://localhost:11434/v1
NOTA_AI_LOCAL_API_KEY=ollama
```

Hosted providers are selected by `NOTA_AI_PROVIDER=openai`, `anthropic`, or `google`, or by choosing a model id from the UI. Configure the matching key:

```sh
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
```

Automatic text-model fallback stays within the selected provider. A saved hosted
key does not cause missing or failed local models to send prompts to that provider.
When no model in the selected provider is usable, the backend returns an AI Settings
setup error. Explicitly selecting a configured hosted model still works.

## Offline Model Benchmark

Chat now runs on llama.cpp with GPU first; see [Local AI Runtimes](local-runtimes.md).
The benchmark below measures the ONNX text models only.

Use the actual shared CPU ONNX runtime, with an already installed model:

```sh
yarn workspace @nota/ai-backend benchmark:local \
  --model gemma-4-e2b-it-onnx-q4f16 \
  --workspace-root /absolute/path/to/nota \
  --max-new-tokens 192
```

`--workspace-root` must contain `.nota/models/<model-id>`. For desktop-installed
models on macOS, this is normally `~/Library/Application Support/nota` (pass the
expanded path in quotes). The command does not download models or read workspace
documents. It uses fixed synthetic rewrite, meeting-summary, cited-answer, and
missing-information prompts.

Run each model in a fresh process. JSON output includes the cold rewrite, the same
rewrite warm, the remaining warm tasks, first non-whitespace text latency, total
latency, process-lifetime peak RSS in MiB, hardware, and full generated answers
with a manual review rubric. First text is not token-level timing; RSS includes
the runtime; cold does not mean an empty operating-system file cache. This short
CPU test does not measure retrieval, recording, long-context accuracy, or desktop
responsiveness under concurrent workloads.

Local text requests pass `enable_thinking: false` through Transformers.js chat
template options because local ONNX currently advertises no reasoning control.
Model-specific template overrides still apply, including SmolLM3 system-message
`/think`. See [the baseline and candidate evaluation](benchmarks/2026-09-13-local-ai-baseline.md)
before changing a default.

## Image Providers

Image generation uses `NOTA_AI_IMAGE_PROVIDER=openai`, `google`, or `local`. OpenAI and Google require their matching keys; `local` expects an OpenAI-compatible local image endpoint.

```sh
NOTA_AI_IMAGE_PROVIDER=local
NOTA_AI_LOCAL_IMAGE_MODEL=llama3.2
NOTA_AI_OPENAI_IMAGE_MODEL=gpt-image-1-mini
NOTA_AI_GOOGLE_IMAGE_MODEL=imagen-4.0-fast-generate-001
```

## Tools

The AI backend exposes built-in AI SDK tools through the same `/api/copilot/chat/:sessionId/stream` path. These are Nota-scoped helpers, not a separate agent runtime.

```sh
NOTA_AI_TOOLS_ENABLED=true
NOTA_AI_WORKSPACE_SEARCH_TOOL_ENABLED=true
NOTA_AI_WEB_CRAWL_TOOL_ENABLED=true
NOTA_AI_SHELL_TOOL_ENABLED=false
NOTA_AI_TOOL_MAX_STEPS=50
```

The tool loop allows 1–50 rounds and defaults to 50. It ends early when the model finishes. If it reaches the tool-round budget, one final generation runs with tools disabled to answer from the collected results. Saved lower limits still apply and can be raised in AI Settings → Advanced.

- `search_nota_workspace` searches only access-verified Nota documents, meeting transcripts, and explicit attachments mirrored by the renderer. It never scans arbitrary files under Electron app data or the backend root.
- `web_crawl` fetches one public `http` or `https` page and returns stripped text for note research.
- `nota_shell` is disabled by default. When enabled, it runs only read-only inspection commands inside the Nota workspace root.

MCP settings are stored as local backend config metadata:

```sh
NOTA_AI_MCP_ENABLED=false
NOTA_AI_MCP_CONFIG={}
```

Copilot sessions persist locally beside AI settings in `copilot-sessions.json`. Workspace documents remain the canonical editable source; search indexes, meeting runtime records, and model status files are rebuildable local support state.
