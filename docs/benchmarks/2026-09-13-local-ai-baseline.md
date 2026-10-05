# Local AI Baseline And Candidate Evaluation

Date: 2026-09-13. This report separates measurements from candidate recommendations.
It is not a release certification or a promise of Notion-quality output.

## Measured Baseline

Command, run in a fresh process against already installed model files:

```sh
yarn workspace @nota/ai-backend benchmark:local \
  --model gemma-4-e2b-it-onnx-q4f16 \
  --workspace-root /Users/kunjkariya/Prjs/Kunj/nota \
  --max-new-tokens 192
```

Hardware: Apple M5 Pro, 15 logical CPUs, 24 GiB RAM, macOS arm64, Node 22.22.3.
Runtime: Transformers.js 4.2.0, ONNX Runtime Node 1.24.3, CPU, q4f16,
non-thinking template, greedy generation. No hosted inference, downloads, or
personal workspace content. One run, not a statistical latency study.

| Task                         | State | First Text |    Total | Process Peak RSS |
| ---------------------------- | ----- | ---------: | -------: | ---------------: |
| Rewrite                      | Cold  |   2,830 ms | 3,886 ms |        2,642 MiB |
| Same rewrite                 | Warm  |     478 ms | 1,543 ms |        2,677 MiB |
| Short meeting summary        | Warm  |     798 ms | 4,903 ms |        2,762 MiB |
| Answer with supplied sources | Warm  |     639 ms | 1,148 ms |        2,762 MiB |
| Missing-information answer   | Warm  |     533 ms |   851 ms |        2,762 MiB |

First text means the first non-whitespace streamer callback, not first-token
latency. Cold includes runtime and pipeline loading but may use the OS file cache.
Peak RSS is the high-water mark for the entire process. There was no concurrent
meeting or desktop UI workload, and model revisions/files were not reverified by
this command.

### Output Review

- Rewrite: "The offline notes demo has been rescheduled to September 18th to
  allow for necessary recovery testing." Preserved the date and reason.
- Meeting: three bullets preserved the local-only decision, Sam's recovery test
  due September 18, and Avery's onboarding checklist due September 19. No budget
  or release date was invented.
- Source answer: "The pilot supports English and Spanish [1]." Correct on the
  two supplied sources; this bypasses the actual retrieval pipeline.
- Missing information: "Not specified in the source." Correct on this fixture.

These are four short synthetic tasks with manual review, not a quality score.
Still required: long transcripts, noisy audio, multilingual output, ambiguous
owners/dates, unsupported questions, permission boundaries, structured action
proposals, cancellation, and lower-end-device measurements.

## Qwen3 0.6B Comparison

The same command and token limit were then run in a fresh process with
`--model qwen3-0.6b-onnx-q4f16`. The existing seed preparation command downloaded
583,371,748 bytes into the development `.nota/models` directory and verified all
ten files against the pinned revision and SHA-256 manifest. No AI settings or
default selections were changed.

| Task                         | State | First Text |    Total | Process Peak RSS |
| ---------------------------- | ----- | ---------: | -------: | ---------------: |
| Rewrite                      | Cold  |   1,576 ms | 1,984 ms |        2,572 MiB |
| Same rewrite                 | Warm  |     143 ms |   593 ms |        2,572 MiB |
| Short meeting summary        | Warm  |     255 ms | 1,311 ms |        2,572 MiB |
| Answer with supplied sources | Warm  |     188 ms |   444 ms |        2,572 MiB |
| Missing-information answer   | Warm  |     152 ms |   254 ms |        2,572 MiB |

Manual output review:

- Rewrite retained September 18 and recovery testing in one sentence.
- Meeting produced three bullets with the local-only decision and both correct
  owners/actions/dates.
- Source answer: "The pilot supports English and Spanish, as stated in [1]."
- Missing information: "Not specified in the source."

On this run, the short meeting summary completed about 3.7 times faster than
Gemma. The package is about 81% smaller, but measured peak process RSS was only
about 7% lower. Do not infer a proportionate RAM reduction from weight size.
Both models met the four short manual rubrics; neither has been evaluated here
for long-meeting quality, retrieval, tool actions, or lower-RAM devices.

## Text Candidates

Download estimates below sum the exact matching ONNX file subset from upstream
metadata inspected on September 13. They use decimal MB/GB and may differ from
older approximate registry values. They are not RAM requirements.

| Model                                                                                                                  | Download | Role To Evaluate           | Current Evidence                                    |
| ---------------------------------------------------------------------------------------------------------------------- | -------: | -------------------------- | --------------------------------------------------- |
| [Gemma 4 E2B](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/tree/9f4bef82ea6e296bc69f8a2f5939f73af81b07a6) |  3.13 GB | Current standard           | Measured above; retain default                      |
| [Qwen3 0.6B](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/da1453100cf3ff33ef56d17983fc7a8648706db6)      |   583 MB | Compact short-task option  | Installed and measured above; promising fast option |
| [SmolLM3 3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B-ONNX/tree/af50613703fb6f10ffcb21b27ad48edcb8334232)       |  2.14 GB | Smaller standard candidate | Registered; not benchmarked here                    |
| [Qwen3 1.7B](https://huggingface.co/onnx-community/Qwen3-1.7B-ONNX/tree/cc6a06a21d614e9b8e92a6adfab1074d4e7d2438)      |  1.44 GB | Middle-size candidate      | Not registered or runtime-validated in Nota         |
| [Gemma 4 E4B](https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX/tree/843f250f23bc91754def1e0f0db390dacd1e6b05) |  4.92 GB | Optional larger tier       | Not benchmarked here                                |

Do not claim that a smaller download is faster or equally accurate without
running the comparison. Gemma E2B's name describes effective parameters, not
total weight size. Qwen and SmolLM support a non-thinking template switch;
SmolLM's explicit `/think` system marker can override it. The switch avoids
default thinking overhead but is not a security boundary.

## Meeting Package Roles

Keep the existing selector and shared capture pipeline. These are candidate roles,
not freshly measured speech accuracy or latency results:

- [Whisper Tiny INT8](https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/tree/65176e2deb88badc814a94058666cadccc29b61c):
  about 104 MB, multilingual bundled fallback. Its small size trades away accuracy.
- [Moonshine Base English v2](https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27/tree/8f4d6c58c03d40bcea40043bb7120a878f2bbef6):
  about 141 MB, compact English utterance-final candidate, not native live partials.
- [Parakeet TDT v3 INT8](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tree/2bda32ec70b097a55adaa07d9a7173915b43cc78):
  about 670 MB, 25-language utterance-final candidate.
- [Nemotron 3.5 streaming INT8](https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11/tree/ab43d895f5985b1bbab8b6eac8607fcdc05343f3):
  about 682 MB, live partials, 32 out-of-box locales. The 560 ms model chunk
  setting is not a measured end-to-end caption latency.

Bundling and redistribution must preserve the respective license and attribution
requirements. Local inference avoids hosted usage charges; it does not remove
download, storage, RAM, energy, or distribution obligations.
