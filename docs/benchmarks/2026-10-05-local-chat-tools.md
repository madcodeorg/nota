# Local Chat Tool Connection — October 5, 2026

All ten curated local text models now receive the enabled built-in and MCP
function tools through the same AI SDK chat loop as hosted providers. Model
size does not disable tools. Tool settings, workspace access and approval
requirements still apply. AI Settings shows model suitability guidance.
Shared chat allows up to 12,000 output tokens per generation, bounded by the
local model's remaining context, so longer proposals can finish.

The local provider translates complete JSON objects/arrays, standard tool-call
tags and Liquid function-call notation into SDK events. It never evaluates
expressions or repairs truncated calls. The SDK validates arguments and runs
the existing executor. Results, errors and denials return to the model; raw
tool syntax stays out of ordinary chat text. Cancellation cannot execute a
partially generated call.

Both local and hosted chat retain completed proposal events when final
generation fails. Tool errors are streamed and saved as error results.
Exactly one fenced Markdown payload remains a proposal fallback when the
model does not call the proposal tool; existing proposals are not duplicated.

## Native Functional Smoke

Apple M5 Pro, 15 logical CPUs, 24 GiB system RAM, macOS arm64, Node 22.22.3,
Transformers.js 4.2.0, ONNX Runtime Node 1.24.3, CPU only, greedy generation.
Each model ran in a fresh process with already installed weights. No downloads,
personal content or real external tools were involved.

The synthetic question asks who owns the Amber demo and when its review is due.
Only the tool knows the answer: Nora, October 9. Passing requires exactly one
successful tool execution, no errors and a final answer containing both facts.
The harness permits four SDK steps, with tools disabled on the last step.
This fixture budget does not change Nota's configurable 1–50 tool-round budget.

| Model                      | Result | Total seconds | Peak process RSS MiB | Observation                                                                                         |
| -------------------------- | ------ | ------------: | -------------------: | --------------------------------------------------------------------------------------------------- |
| LFM2.5 230M q4             | Failed |          0.99 |                1,204 | Omitted required tool arguments; validation prevented execution, then the model invented an answer. |
| LFM2.5 350M q4f16          | Failed |          1.19 |                  695 | Requested an unavailable tool or omitted its arguments; no execution.                               |
| Qwen3.5 0.8B q4f16         | Failed |         13.71 |                3,257 | Correct lookup executed three times; ignored the final no-tool instruction and did not finish.      |
| LFM2.5 1.2B Instruct q4f16 | Passed |          5.14 |                1,849 | One lookup followed by the correct answer.                                                          |
| Qwen3.5 2B q4f16           | Passed |          9.87 |                2,867 | One lookup followed by the correct answer.                                                          |
| LFM2.5 2.6B q4f16          | Passed |         14.67 |                2,588 | Native Liquid call translated correctly; one lookup and correct final answer.                       |
| Qwen3.5 4B q4f16           | Passed |         20.96 |                4,528 | One lookup followed by the correct answer.                                                          |

Time includes model/runtime loading and tool continuation. Peak RSS is the
whole process lifetime high-water mark, including repeated generations in
the failed 0.8B case. It is not model-only RAM, macOS physical footprint,
compression or swap. One short task per model is functional evidence, not a
statistical accuracy, latency or memory benchmark.

Gemma E2B/E4B and SmolLM3 were not native-tool-tested in this run. All ten
catalog models pass pipeline integration tests using mocked generation with
real AI SDK tool execution and continuation.

An additional native Qwen3.5 2B smoke used Nota's actual model router, stream
handler, four built-in workspace/proposal tools and an isolated action store.
It created exactly one pending approval proposal titled Amber Demo, retained
Nora and October 9, and returned the approval message with no errors. Total
cold time was 47.86 seconds with the full tool schema and final continuation.
This validates the backend proposal path; frontend approval/application and
packaged-app UI are separate checks. No real notes were applied or changed.

## Selection Guidance

- Qwen3.5 2B remains the balanced default for chat, summaries and agent work.
- Liquid 1.2B is a promising compact option; its license and broader task
  reliability still matter when choosing it.
- Qwen3.5 4B and Liquid 2.6B are optional larger choices. Liquid reasons before
  its final answer and can take longer.
- 230M/350M and Qwen 0.8B remain available with all enabled tools. Their guidance
  recommends a larger model for agent work because these native tests failed.

## Validation And Reproduction

The focused model/settings/agent suite passed 330 tests across 15 files.
Backend typecheck and targeted ESLint passed. Coverage includes real SDK schema validation,
ten-model pipeline continuation, fragmented calls, cancellation, denied
execution data, final steps with tools disabled, shared proposal events and
preservation after final-generation failure.

Raw outputs, errors and measurements:
[JSON report](./2026-10-05-local-chat-tools.json).
Portable fixture:
[native tool smoke](./2026-10-05-local-chat-tool-smoke.ts).
Run from the repository root, pointing at an existing isolated model cache:

```sh
NOTA_AI_WORKSPACE_ROOT=/tmp/nota-chat-validation \
NOTA_AI_SETTINGS_PATH=/tmp/nota-chat-validation/settings.json \
node node_modules/tsx/dist/cli.mjs \
  docs/benchmarks/2026-10-05-local-chat-tool-smoke.ts \
  qwen3.5-2b-onnx-q4f16 /tmp/qwen-2b-tools.json
```

Packaged-app UI acceptance, long multi-tool tasks, lower-RAM devices and other
architectures remain unverified. This work covers source validation; no new app
build or installation was performed.
