# M1 Phase 1 — existing Ollama model benchmark

> **Later status:** Karl approved the recommended `gemma3:4b` digest for M1 Phase 3 basic desktop chat on 2026-10-13. The integration and its verification are recorded in `CURRENT_STATE.md` and `HANDOVER.md`. Benchmark measurements below remain historical evidence; M1 is not complete.

> **Phase 2 correction and final evaluation (2026-10-13):** The duplicate Gemma entries are two runners created by Ollama 0.40.1's automatic local compatibility migration. The current default is the `llamacpp` digest `c30276f7…`, verified by `/api/show` and the loaded `/api/ps` record. The first Phase 1 run crossed the migration and had two runners resident simultaneously. Its 7,588 MiB system-wide GPU peak is not a single-runner requirement. See the Phase 2 section below. The Phase 1 identity concerns and proposed next action are historical.

Date: 2026-10-13. Scope: read-only discovery and sequential inference using already installed local models. **No model selected and no application integration performed.** Raw JSON results are local, ignored test artifacts under `test-results/ollama-*.json`.

## Method

- Host: Ryzen 5 5500, 16 GB system RAM (Windows reported 16,964,935,680 bytes), NVIDIA GeForce RTX 3050 with 8,192 MiB VRAM. Ollama CLI and local `/api/version` both reported 0.40.1. `/api/tags` confirmed both candidates already installed; `/api/ps` showed no loaded models before testing.
- One model at a time through `POST http://127.0.0.1:11434/api/chat`. Identical system instruction and five prompts are defined verbatim in `scripts/benchmark-ollama.mjs`: natural conversation, honesty/personality, TypeScript coding, queue arithmetic, exact JSON output. Warm-up prompt was `Reply with READY.`
- Standard options for both: `num_ctx=4096`, `num_predict=256`, `temperature=0`, `seed=42`, streaming enabled, `keep_alive=10m`. A separate reasoning retest used `num_predict=512` for both. No other generation defaults were overridden. Each model was stopped after its run and `/api/ps` checked before the next.
- First visible token latency is measured from request start to first nonempty streamed content. Throughput uses Ollama `eval_count / eval_duration`; warm-up wall/load times and per-prompt wall times are retained separately. A sampler ran about every 750 ms using `nvidia-smi` total GPU memory/utilization, Node `os.cpus()` system-wide CPU utilization and `os.freemem()`. These are system-wide observations, not per-process attribution; concurrent desktop activity can affect them.

## Discovery and model identity

| Model | Format/quantization | Model metadata context | Tested context | Tag identity |
| --- | --- | ---: | ---: | --- |
| `gemma3:4b` | GGUF, Q4_K_M, 4.3B parameters | 131,072 | 4,096 | First run tag digest `a2af6cc3…`; later first matching tag entry `aa1cd771…`; current `/api/tags` lists **two** `gemma3:4b` entries (`aa1cd771…`, `c30276f7…`). The runtime weight identity of later name-based requests is unverified. |
| `qwen2.5-coder:7b` | GGUF, Q4_K_M, 7.6B parameters | 32,768 | 4,096 | Stable digest `dae161e2…` throughout observed runs. |

At 12:42:45 Europe/London, `/api/tags` reports both current Gemma entries modified during the first Gemma run (which began around 12:42:33). The first run therefore straddled a tag change. At the time of Phase 1, the cause and whether underlying weights changed were **not verified**; Phase 2 resolved the runner migration cause. No pull, delete or reinstall was performed manually; the benchmark script only queried, inferred and stopped its own loaded model, but Ollama automatically wrote migration metadata while loading. Because two entries share the same tag, the Phase 1 script refuses future runs unless a model name resolves to exactly one digest. Do not merge Gemma's first and later measurements as a clean same-model replication.

## Performance and resources

| Observation | Gemma initial run | Gemma repeat, later tag snapshot | Qwen standard run |
| --- | ---: | ---: | ---: |
| Warm-up wall / reported load | 48.6 / 27.7 s | 5.4 / 5.2 s | 32.6 / 14.7 s |
| Mean generation throughput, five prompts | 64.0 tokens/s | 63.9 tokens/s | 42.9 tokens/s |
| Median first visible token, five prompts | 110 ms | 110 ms | 72 ms |
| Peak total GPU memory | 7,588 MiB | 4,675 MiB | 5,569 MiB |
| Peak GPU utilization | 100% | 96% | 100% |
| Mean / peak system CPU utilization | 23.3% / 66.4% | 22.9% / 50.0% | 18.6% / 36.1% |
| Minimum available system RAM | 937 MiB | 2,794 MiB | 3,123 MiB |
| Ollama `/api/ps` reported model VRAM after warm-up | 2,875,520,450 bytes | 2,875,520,450 bytes | 4,748,056,984 bytes |

At the fixed 4,096-token context, Qwen's observed 5,569 MiB peak leaves about 2,623 MiB of the 8,192 MiB card for other activity and appears to fit comfortably in this run. Gemma's later 4,675 MiB peak leaves about 3,517 MiB, but its first run reached 7,588 MiB and available RAM fell below 1 GiB. That first peak coincided with the tag change, so its cause cannot be attributed to Gemma alone; **comfortable Gemma VRAM fit is not yet established**. Neither model was tested at its metadata maximum context or under sustained multiturn load. The `size_vram` API field is smaller than total GPU memory use and must not be treated as total desktop VRAM consumption.

Cold-start measurements are especially noisy here: the first starts took 48.6 s and 32.6 s, whereas later starts were about 5.1–5.4 s after caching. These numbers should not be presented as stable application startup times.

## Output quality

| Task | Gemma | Qwen |
| --- | --- | --- |
| Natural conversation, three short sentences | Supportive, concrete three-sentence response. | Supportive and useful, but more than three sentences. |
| Personality and honesty, two sentences | Correctly denied prior memory and file access; two sentences. | Correctly denied prior memory and file access; two sentences. |
| TypeScript `dedupeById` code only | Algorithm appears type-correct and preserves first occurrence/order; added a Markdown fence against instruction. Code was inspected, not executed. | Same outcome: sound algorithm by inspection, but unwanted Markdown fence. Code was inspected, not executed. |
| Queue reasoning, 90 jobs / net 12 per minute | Correctly gave 7.5 minutes in 191 tokens within the 256-token cap. | Hit the 256-token cap before a final answer; with a fair 512-token retest, correctly gave 7.5 minutes in 290 tokens. |
| Exactly one-line JSON | Parsed successfully with `status="ready"`, `count=3`, no extra text. | Same. |

The later Gemma repeat produced the same qualitative outcomes. The coding prompt was deliberately small; this benchmark does **not** establish either model's ability on real repository tasks. Gemma was faster per generated token, but Qwen's shorter first-token latency and differing output lengths mean no single wall-time number captures overall responsiveness.

## Reproduce safely

These are the historical Phase 1 commands. Its unique-tag guard now intentionally rejects Gemma's dual-runner tag; use the digest-pinned Phase 2 commands below for a current reproduction. The commands use existing models and loopback API; they do not download anything:

```powershell
ollama --version
ollama list
ollama ps
Invoke-RestMethod http://127.0.0.1:11434/api/version
Invoke-RestMethod http://127.0.0.1:11434/api/tags
nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits
node scripts/benchmark-ollama.mjs gemma3:4b
node scripts/benchmark-ollama.mjs qwen2.5-coder:7b
node scripts/benchmark-ollama.mjs gemma3:4b reasoning-512
node scripts/benchmark-ollama.mjs qwen2.5-coder:7b reasoning-512
```

`repeat` can replace `reasoning-512` for a full second pass. Run commands sequentially. The script aborts if another model is loaded or if the requested tag is duplicated. It writes detailed prompt/output/timing/resource JSON to ignored `test-results/` and calls `ollama stop` for its own model after each run. The initial Gemma run used an API unload request that did not remove it from `/api/ps`; an explicit `ollama stop gemma3:4b` then returned `/api/ps` to empty. The script now uses the CLI stop consistently.

## Decision status and next step

**Phase 1 conclusion, superseded by Phase 2 below:** No final Astra V0.1 model recommendation was possible then. Gemma's conversational formatting and roughly 64 tokens/s made it promising, while Qwen's stable 4K VRAM result and coding orientation were useful. The one-step coding prompt was too weak to establish a coding advantage.

The subsequent Karl-approved Phase 2 investigation and stronger comparison are documented immediately below. M1 remains in progress; offline-disconnected operation and app integration were not tested.

## Phase 2 — identity investigation and controlled final evaluation (2026-10-13)

### Identity and migration evidence

- `ollama list`, `/api/tags`, and the local `manifests-v2/ollama.com/library/gemma3/4b` manifest list show the same two `gemma3:4b` entries: `aa1cd77181b3d06872a952dfcbe9cef96531ff900afe1be19539b6ecd7b0061c` with runner `ggml`, and `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291` with runner `llamacpp`. `/api/show` and `ollama show gemma3:4b` select the latter as default. `llamacpp:c302…` is also listed as an alias. The manifest-list SHA-256 was `0FDF8167C19C61124C79ADD8B0457203F73367FE64E5105634F1096547D76B2E` before and after the follow-up runs.
- Ollama's local `server.log` records `starting local compat GGUF migration` for `gemma3:4b` at 12:42:33.897 and completion at 12:42:45.942. This began during the first Phase 1 warm-up. The same log records the original combined blob `sha256-aeda25e63e…` loading first, then converted text blob `sha256-e2979d2d…` loading at 12:43:22, followed by `loaded runners count=2`. The first Phase 1 JSON records runtime digest `a2af6cc3…`; the later repeat records `c30276f7…`. Thus those runs did **not** consistently use the same runtime content/runner. The converted layers are derived from the local source model; byte-for-byte equivalence of numerical behavior was not established.
- Ollama's maintainer describes this lazy local compatibility conversion and retained old runner in [Ollama issue #18870](https://github.com/ollama/ollama/issues/18870). No symlink issue was found on this machine. No manual model pull, delete, retag, overwrite, or download occurred. Ollama itself wrote migration metadata during Phase 1 model loading; the earlier statement that no model-file modification occurred was therefore too broad.
- The first Phase 1 peak of 7,588 MiB was a **whole-GPU** reading when two Gemma runners were co-resident. This is a supported explanation from log timing, not proof of exact per-runner allocation. The later single-runner 4,675 MiB and Phase 2 4,692 MiB peaks are more relevant for 4K-context fit. Other desktop processes can still affect the total. Qwen's tag and loaded digest remained `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`.

### Phase 2 method and results

`scripts/evaluate-ollama.mjs` pins the expected digest, checks Gemma's default runner, confirms the loaded digest after warm-up, and refuses to run while any other model is loaded. It uses the same system instruction and prompts for both models: one TypeScript `mergeIntervals` task requiring immutable input and fresh tuples, three linked conversation turns, unknown personal facts, and exact one-line JSON. Both used `/api/chat`, `num_ctx=4096`, `num_predict=512`, `temperature=0`, `seed=42`, streaming and `keep_alive=10m`. Runs were sequential and each ended with `ollama stop` and zero entries in `/api/ps`. The first two passes exposed a deprecated option in the local TypeScript checker; the option was corrected and the **final saved passes** below reran both models with identical settings. Local raw output is in ignored `test-results/ollama-final-*.json`; the generated candidate files are also ignored.

| Final saved pass | Gemma 4B (`c30276f7…`, `llamacpp`) | Qwen2.5-Coder 7B (`dae161e2…`, `ggml`) |
| --- | ---: | ---: |
| Warm-up wall time | 5,690 ms | 5,662 ms |
| Coding answer wall time / generation speed | 3,763 ms / 61.7 tokens/s | 4,869 ms / 41.5 tokens/s |
| Mean generation speed across six scored requests | 62.6 tokens/s | 42.7 tokens/s |
| Median first visible token across six requests | 115.5 ms | 72 ms |
| Exact one-line JSON | Pass | Pass |
| `mergeIntervals` strict TypeScript check | Fail | Fail |
| Code-only format | Fail: Markdown fence | Fail: Markdown fence |
| Ollama `/api/ps` model-specific `size_vram` | 2,875,520,450 bytes (2,742 MiB) | 4,748,056,984 bytes (4,528 MiB) |
| Peak **system-wide** GPU memory | 4,692 MiB | 5,588 MiB |
| Minimum available system RAM | 2,511 MiB | 2,924 MiB |
| Peak sampled GPU / system CPU utilization | 95% / 43.3% | 98% / 61.8% |
| Configured and observed context | 4,096 tokens | 4,096 tokens |

The TypeScript checker is a meaningful correctness gate. Gemma declared a `readonly` result array and then called `.push()`, and returned that readonly array where the required return is mutable. Qwen inserted readonly input tuples into a mutable tuple result. Both failed `tsc --strict`; consequently the harness did not execute the six runtime cases, and **0/6 is not evidence that all six runtime cases failed**. By inspection, both also reuse an input tuple on the single-interval path, violating the fresh-tuple requirement. Neither model passed the demanding coding task. No generated code was integrated into Astra.

Both models admitted they did not know Karl's favorite programming language or dog's name; neither invented personal memory. Both declined to claim memory or email capability in the third conversation turn. Gemma's first two turns offered a useful log-first investigation and a focused follow-up; Qwen's first answer suggested a clean-environment run, then focused on dependencies. Neither perfectly met the final two-sentence limit; Qwen was more verbose and introduced an unnecessary generic offer. Both satisfied exact JSON. In the Phase 1 simpler coding task, both algorithms appeared plausible by inspection but were not executed. The stronger Phase 2 failure prevents claiming a coding winner.

At 4,096 context, Gemma's 4,692 MiB system peak leaves about 3,500 MiB of the 8,192 MiB card; Qwen's 5,588 MiB leaves about 2,604 MiB. Both fit during these short, sequential runs. `size_vram` is Ollama's model-specific loaded allocation estimate; `nvidia-smi` is total device use and includes the desktop and other processes. The single-run 750 ms samples can miss short peaks. No sustained load, larger context, disconnected-network run, independent weight comparison, or app integration was tested.

### Recommendation and reproducibility

**Recommend the current `gemma3:4b` llama.cpp digest `c30276f7…` for Astra V0.1's first conversational brain**, subject to Karl's approval before integration. It was clearer in the linked conversation, honest about unavailable memory/email, about 47% faster per generated token in this run, and used about 896 MiB less whole-GPU memory at 4K context. Qwen had lower median first-token latency, but neither candidate passed strict coding correctness, so this result does not establish Gemma as a coding model. A separate M3 coding evaluation should use real repository tasks and a repair loop before coding capability is promised. The recommendation is for initial basic chat, not completion of M1.

Reproduce without downloads, one command at a time after checking no other Ollama workload is active:

```powershell
ollama --version
ollama list
ollama ps
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Invoke-RestMethod http://127.0.0.1:11434/api/show -Method Post -ContentType application/json -Body '{"model":"gemma3:4b"}'
Get-FileHash "$env:USERPROFILE\.ollama\models\manifests-v2\ollama.com\library\gemma3\4b" -Algorithm SHA256
node --check scripts/evaluate-ollama.mjs
npm run lint
node scripts/evaluate-ollama.mjs gemma3:4b
node scripts/evaluate-ollama.mjs qwen2.5-coder:7b
ollama ps
```

The evaluator records exact prompts, responses, timing and telemetry in each local JSON file. It stops only its own benchmarked model. It will abort before inference if the pinned digest/default runner has changed or another model is loaded. It uses locally installed TypeScript for the coding gate, not a cloud service. The six runtime cases are defined in the script and run only after strict typechecking succeeds. Treat the Phase 1 script's duplicate-name refusal as historical; use the digest-pinned Phase 2 evaluator while both migration entries exist. M1 remains **in progress**, and no desktop AI integration is authorized by this benchmark.
