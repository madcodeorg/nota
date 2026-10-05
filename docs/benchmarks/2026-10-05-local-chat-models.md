# Local Chat Model Refresh

Date: October 5, 2026. Source changes and native development-runtime verification;
the installed Nota application has not been rebuilt or updated for this refresh.

## Selection

Fresh configurations default to **Qwen3.5 2B q4f16**: a practical multilingual
choice with Apache 2.0 licensing, a smaller download than the existing Gemma
options, and complete decision/action extraction on our short meeting fixture.
Existing Gemma or hosted selections stay intact. Saved Qwen3 0.6B settings and
chat IDs resolve to Qwen3.5 0.8B; the old option is removed from the catalog.

- **LFM2.5 1.2B Instruct** is the measured lower-memory alternative. It kept the
  decision, both owners and dates, with about 1.26 GiB process peak RSS and a
  1.63-second warm summary on this Mac. Its custom license needs consideration.
- **Qwen3.5 0.8B** is the smaller Apache option. It omitted action owners in our
  meeting test, so it should not be the standard summary model.
- **Qwen3.5 4B** is the optional larger model with stronger published reasoning
  scores. Our non-thinking summary took 8.26 seconds and about 3.78 GiB peak RSS.
- **LFM2.5 230M/350M** are useful candidates for narrow extraction and rewriting,
  but their errors on this fixture make them poor general meeting defaults.
- **LFM2.5 2.6B** is optional for reasoning. It always thinks, even when asked to
  disable thinking. Its final summary was correct, but took 38.77 seconds here.
- Existing **Gemma E2B/E4B and SmolLM3** remain options; they were not freshly
  measured in this comparison. The September baseline is historical evidence.

MiniLM L6 embeddings and the shared local provider route are unchanged. No
onboarding flow or arbitrary Hugging Face URL importer is included. A repository
having ONNX files is insufficient: architecture, tokenizer, export layout,
quantization and native operators must match the runtime.

## Published Quality Benchmarks

Higher is better. These are publisher evaluations of original model weights,
not scores measured for Nota's quantized ONNX packages. A dash means not reported
for that model/mode in the cited card. MMLU-Pro measures knowledge/reasoning;
IFEval measures instruction following. Different publishers use different
evaluation settings, so these columns do not establish a strict cross-vendor
ranking. Liquid's 1.2B card explicitly averages strict/loose prompt/instruction
IFEval accuracy; its score is not directly equivalent to every other publisher's
IFEval protocol.

| Model and primary source                                                     | MMLU-Pro | IFEval | Mode / additional published evidence                  |
| ---------------------------------------------------------------------------- | -------: | -----: | ----------------------------------------------------- |
| [LFM2.5 230M](https://huggingface.co/LiquidAI/LFM2.5-230M)                   |    20.25 |  71.71 | Instruct; BFCLv4 21.03                                |
| [LFM2.5 350M](https://huggingface.co/LiquidAI/LFM2.5-350M)                   |    20.01 |  76.96 | Instruct; BFCLv4 21.86                                |
| [Qwen3.5 0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B)                     |     29.7 |   52.1 | Non-thinking                                          |
| [LFM2.5 1.2B Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct) |    44.35 |  86.23 | Instruct; BFCLv3 49.12                                |
| [Qwen3.5 2B](https://huggingface.co/Qwen/Qwen3.5-2B)                         |     55.3 |   61.2 | Non-thinking; thinking scores 66.5 / 78.6             |
| [LFM2.5 2.6B](https://huggingface.co/LiquidAI/LFM2.5-2.6B)                   |        — |      — | Always-thinking; IFBench 59.17, BFCLv4 56.88          |
| [SmolLM3 3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B)                |        — |   76.7 | Non-thinking; GPQA Diamond 35.7                       |
| [Qwen3.5 4B](https://huggingface.co/Qwen/Qwen3.5-4B)                         |     79.1 |   89.8 | Published thinking evaluation; Nota uses non-thinking |
| [Gemma 4 E2B](https://huggingface.co/google/gemma-4-E2B-it)                  |     60.0 |      — | Google evaluation settings; GPQA Diamond 43.4         |
| [Gemma 4 E4B](https://huggingface.co/google/gemma-4-E4B-it)                  |     69.4 |      — | Google evaluation settings; GPQA Diamond 58.6         |

SmolLM3's MMLU-Pro CF/MCF numbers in its card are base-model evaluations and are
intentionally excluded from the instruct comparison. The same Liquid cards
also evaluate competing Qwen models with different results; the table above
uses each model creator's own card rather than mixing evaluation runs.

Liquid's 2.6B card provides this separate shared creator evaluation. It remains
an evaluation of original weights, with the creator's runtime/tool handlers:

| Model       | IFBench | BFCLv4 |
| ----------- | ------: | -----: |
| LFM2.5 2.6B |   59.17 |  56.88 |
| Gemma 4 E2B |   34.08 |  36.98 |
| Gemma 4 E4B |   39.24 |  46.39 |
| Qwen3.5 4B  |   48.40 |  50.56 |

Nota's local adapter now translates complete tool calls into the same AI SDK
execution loop used by hosted chat. All ten models receive the enabled built-in
and MCP tools, with the existing permissions and approvals. Settings guidance
explains suitability without restricting tools by model size. Published BFCL
scores still do not establish Nota agent success rates: see the separate
[native tool smoke report](./2026-10-05-local-chat-tools.md) for observed successes
and failures with the quantized packages.

## Managed Packages

Sorted by download size. Sizes are rounded decimal MB for the selected text
files, not full multimodal repositories or runtime RAM. RAM targets are catalog
device-fit thresholds, not measured model allocations. Full context windows can
require substantially more RAM than these minimum targets.

| Model                      | Text download MB | Catalog RAM target GB | Token context ceiling |
| -------------------------- | ---------------: | --------------------: | --------------------: |
| LFM2.5 230M q4             |              217 |                     2 |                32,768 |
| LFM2.5 350M q4f16          |              259 |                     2 |                32,768 |
| Qwen3.5 0.8B q4f16         |              604 |                     4 |               262,144 |
| LFM2.5 1.2B Instruct q4f16 |              764 |                     4 |                32,768 |
| Qwen3.5 2B q4f16           |            1,405 |                     8 |               262,144 |
| LFM2.5 2.6B q4f16          |            1,553 |                     8 |               128,000 |
| SmolLM3 3B q4f16           |            2,137 |                     8 |                65,536 |
| Qwen3.5 4B q4f16           |            2,823 |                    12 |               262,144 |
| Gemma 4 E2B q4f16          |            3,131 |                     8 |               131,072 |
| Gemma 4 E4B q4f16          |            4,925 |                    16 |               131,072 |

Gemma's E2B/E4B names describe effective active parameters; they are not total
weight parameter counts. Liquid 230M/350M/1.2B use the conservative documented
32K context rather than their larger config values. Liquid 2.6B uses the ONNX
export's 128,000 limit, below the original model's advertised 131,072.

The runtime tokenizes the complete chat template, including system/history and
retrieved passages. Output is bounded by the remaining context. A full prompt
without output room fails with an explanatory error. A requested 12,000-token
summary output stays available when it fits. This is context protection, not
automatic RAM-based chat-model switching.

## Native ONNX Measurements

Apple M5 Pro, 15 logical CPUs, 24 GiB system RAM, macOS arm64, Node 22.22.3,
Transformers.js 4.2.0, ONNX Runtime Node 1.24.3, CPU only, greedy generation.
Each model ran in a fresh process, sequentially, without concurrent lint or
typechecking. Model files were downloaded to a temporary development directory;
the live Nota profile and saved model selections were not modified.

One cold rewrite followed by four warm tasks: the same rewrite, a four-line
meeting, supplied-source QA and missing-information abstention. Non-thinking
models used a 192-token output cap. Always-thinking Liquid 2.6B used 1,024 tokens,
including hidden reasoning, so its total response time is not the same token
workload. First text means first non-whitespace visible streamer callback, not
first decoded token. Cold measurements include startup and can use OS file cache.

| Model                | Cold rewrite total ms | Warm meeting first text ms | Warm meeting total ms | Whole-process peak RSS MiB | Meeting output review                                               |
| -------------------- | --------------------: | -------------------------: | --------------------: | -------------------------: | ------------------------------------------------------------------- |
| LFM2.5 230M          |                   537 |                         62 |                   256 |                        637 | Copied four numbered lines instead of at most three summary bullets |
| LFM2.5 350M          |                   696 |                        124 |                   371 |                        623 | Omitted local-only decision and Sam's recovery action               |
| Qwen3.5 0.8B         |                 1,851 |                        522 |                 1,775 |                      1,485 | Preserved decision/actions/dates; omitted owners                    |
| LFM2.5 1.2B Instruct |                 1,654 |                        413 |                 1,633 |                      1,287 | Preserved decision, both owners/actions/dates                       |
| Qwen3.5 2B           |                 3,082 |                        928 |                 3,331 |                      2,241 | Preserved decision, both owners/actions/dates                       |
| LFM2.5 2.6B          |                55,477 |                     35,474 |                38,772 |                      2,958 | Correct final answer after hidden reasoning                         |
| Qwen3.5 4B           |                 9,005 |                      2,050 |                 8,257 |                      3,869 | Preserved decision, both owners/actions/dates                       |

All seven finished the five requests and returned final answers. This is runtime
compatibility evidence, not a claim that all outputs met the quality rubric.
Liquid 230M also lost the specific recovery-testing reason in its rewrite and
copied the supplied QA source rather than composing the requested answer. All
seven abstained on the missing-budget question. Qwen4B added "additional" to the
rewrite's recovery-testing description, illustrating why tiny fixtures cannot
establish perfect grounding.

RSS is the process-lifetime high-water mark across all five requests, including
Node, tokenizer, runtime and model. It is not isolated model RAM, physical
footprint, or Nota's total footprint with UI, embeddings and live transcription.
No Windows/Linux/Intel Mac, long meeting, multilingual output, concurrent STT,
low-memory device, real retrieval or packaged-app benchmark was run here.
Raw outputs and measurements: [JSON report](./2026-10-05-local-chat-models.json).

To reproduce after provisioning the managed files into a development workspace:

```sh
node node_modules/tsx/dist/cli.mjs packages/backend/ai/src/benchmark-local.ts \
  --model=qwen3.5-2b-onnx-q4f16 \
  --workspace-root=/tmp/nota-chat-validation \
  --max-new-tokens=192
```

Use `--max-new-tokens=1024` for Liquid 2.6B. This command never downloads models
or reads personal workspace documents.

## Integration Findings And Licenses

- Standard Qwen3.5 ONNX exports work in the existing native runtime. The OPT
  exports fail to initialize with
  `com.microsoft:CausalConvWithState(-1) is not a registered function/op`.
  Standard exports were selected rather than upgrading the shared runtime.
- 4-bit `GatherBlockQuantized` works in these exports. The earlier Gemma mobile
  problem concerned q2; it does not justify rejecting all quantized embeddings.
- Liquid 230M's training-mask `{% generation %}` annotations are unsupported by
  the JS Jinja parser. For that model, always-true blocks preserve rendered text
  and whitespace. The native test verifies generation with this adaptation.
- Sessions exposing `num_logits_to_keep` are constrained to final-token logits,
  extending the existing Gemma memory workaround to the new exports.
- Liquid 2.6B reasoning is discarded until `</think>`, then only the final
  answer streams. Generation defaults to 4,096 output tokens when no budget is
  provided; explicit budgets still apply. Exhaustion before the final answer
  raises an error instead of returning reasoning as the answer.
- Qwen, SmolLM3 and Gemma 4 use Apache 2.0 per their model cards. Liquid models
  use the [LFM 1.0 custom license](https://huggingface.co/LiquidAI/LFM2.5-2.6B/blob/main/LICENSE),
  which defines a $10 million annual revenue threshold and limits commercial
  use above that threshold. They should not be described as unrestricted
  Apache-licensed models. Qwen is the simpler default for Nota's open-source
  distribution; Liquid stays optional.

## Source Validation

- 246 focused tests passed across ten backend/settings test files, including
  legacy selection migration with local/hosted defaults, preserved existing
  selections, downloads, context budgets, template handling, reasoning filtering,
  cancellation and AI Settings behavior.
- Backend TypeScript check passed; ESLint passed for the changed source/test
  files using an 8 GB Node heap; `git diff --check` passed.
- All 63 required files across the seven new packages matched the registry's
  SHA-256 values in the temporary development model directory.
- These checks and the native measurements do not constitute packaged-app or
  target-platform QA. No app build, installation, onboarding or custom URL import
  was performed in this change.
