# Current verified state

## V0.2 Phase 01 — current state (2026-10-13)

Karl approved the Living Companion **UI and avatar preparation only**. The existing Gemma 3 4B chat and narrow Electron main/preload bridge remain working; no backend model setting, IPC channel, permissions or renderer CSP was changed. The repository still has **no commits, no tracked files and all existing work untracked** (`git rev-parse --verify HEAD` failed; `git ls-files` returned 0; `git status --short` listed the project tree). Nothing was reset, staged, committed or discarded.

**Implemented:** `src/renderer/AvatarPanel.tsx` provides a scalable, code-native temporary portrait suggesting purple hair/updo, expressive eyes and a star hoodie, explicitly labelled as a placeholder. `presentationState.ts` defines idle/listening/thinking/speaking/error while mapping only real chat states to idle/thinking/error. `App.tsx` now uses a side-by-side character/conversation layout with a compact stacked form, improved message bubbles, session/model status, disabled microphone/audio controls, and scroll-follow behavior that pauses when the user scrolls up. `MessageContent.tsx` uses `src/shared/messageFormatting.ts` to display multiline text and fenced code as escaped React text without external UI dependencies or HTML injection. No artwork file, rig, animation engine, microphone access, speech, memory or tool behavior was added.

### Phase 01 files and verification

| Item | Verified result |
| --- | --- |
| Created `src/renderer/AvatarPanel.tsx`, `src/renderer/MessageContent.tsx`, `src/renderer/presentationState.ts`, `src/shared/messageFormatting.ts`, `tests/messageFormatting.test.mjs`, `docs/LIVING_COMPANION_PLAN.md` | Separated avatar presentation, typed state and message formatting; plan leaves future stages pending. |
| Modified `src/renderer/App.tsx`, `src/renderer/styles.css`, `scripts/verify-desktop.mjs` | Character-first layout, compact layout, scroll behavior, native resize and screenshot verification. |
| Modified `README.md`, `AGENTS.md`, `docs/MASTER_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/CHECKLIST.md`, `docs/CURRENT_STATE.md`, `docs/HANDOVER.md` | Run instructions, authority, ADR-012, architecture and continuity updated. |
| `npm run lint`; `npm test` | Passed. `npm test` ran strict TypeScript, production Vite/Electron build and **9/9** tests, including pre-existing chat/security checks and two new formatter checks. A standalone `npm run build` also passed during layout iteration. |
| `npm run verify:desktop` | Passed after final UI build: native Windows PID 33124/handle 19794234; live four-turn local Gemma conversation, current-session recall, no-memory-after-close answer, avatar `thinking` during generation, scroll hold/jump, reset, `file:` renderer, restricted bridge/Node globals/CSP, no renderer errors, window exit code 0. |
| Native resize/layout checks | `MoveWindow` resized the actual app window to 700×560 and 640×480. Desktop side-by-side and compact stacked panel positions, no horizontal overflow, visible composer and disabled voice controls, and placeholder label were asserted. |
| Visual inspection | Viewed ignored `test-results/astra-living-desktop.png` and `test-results/astra-living-compact.png` after final run. The desktop portrait is prominent; the compact portrait, conversation and controls remain visible. The screenshots contain only synthetic test prompts. |
| Process and model cleanup | `Get-CimInstance Win32_Process` found no Astra Electron process after close. The test-loaded Gemma runtime was stopped with `ollama stop gemma3:4b`; `ollama ps` then showed zero loaded models. |

**Limitations:** The CSS character is a temporary placeholder, not approved final artwork or a rig. Listening and speaking have type slots but no reachable runtime path; microphone/audio controls are disabled. Formatting supports text, inline code and fenced code, not full Markdown. Compact conversation height is limited at the Windows minimum 640×480 window and scrolls internally. No disconnected-network acceptance, live microphone/audio, installer or packaged-resource test was performed. M1 offline acceptance remains open; V0.2 future phases remain unimplemented. No regression was observed in the verified local conversation or security checks.

**Exact next recommended phase:** Karl reviews the two screenshots and approves or revises the character direction; only after separate approval should Phase 02 create/acquire final local avatar artwork and a layered rig against `docs/LIVING_COMPANION_PLAN.md`. Stop after this UI phase; do not start animation or voice work.

## M1 Phase 3 — historical state (2026-10-13; superseded by V0.2 above)

Karl approved `gemma3:4b` digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291` for Astra V0.1 basic chat. Before integration, `/api/tags` showed the approved digest with llama.cpp runner and a separate GGML migration entry, `/api/show` selected llama.cpp, and a controlled warm-up loaded the exact approved digest at 4,096 context in `/api/ps`. The model was unloaded afterward. No model was downloaded, retagged or modified manually.

**Implemented:** Electron main owns `ChatService`, which contacts only `http://127.0.0.1:11434`. It checks the installed/default identity before every send and the loaded digest after generation. The authored `docs/ASTRA_PERSONALITY.md` is loaded as a system instruction with explicit current-build limits. User/assistant history stays only in main-process memory, is included in later turns, and is cleared by the UI or app exit. The renderer has a dark/purple chat interface, complete replies, connecting/generating/ready/error states, retry and clear controls. The sandboxed preload exposes only typed app-info/status/send/clear methods. Main validates the primary frame and message length. Renderer CSP remains `connect-src 'none'`; no persistent memory, voice, tools, model switching, cloud API, analytics or conversation logging was added.

### Phase 3 files and verification

| Item | Result |
| --- | --- |
| Created `src/main/chatService.ts`, `tests/chatService.test.mjs` | Fixed loopback adapter, exact digest checks, session history/clear, and deterministic service tests. |
| Modified `src/main/index.ts`, `src/preload/index.ts`, `src/shared/contracts.ts` | Personality loading and narrow, sender-validated IPC. |
| Modified `src/renderer/App.tsx`, `src/renderer/styles.css`, `scripts/verify-desktop.mjs`, `tests/foundation.test.mjs` | Chat UI, live Windows conversation/reset verifier, updated CSP/bridge assertions. |
| Modified `README.md`, `AGENTS.md`, `docs/MASTER_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/ASTRA_PERSONALITY.md`, `docs/DECISIONS.md`, `docs/CHECKLIST.md`, `docs/CURRENT_STATE.md`, `docs/HANDOVER.md` | Run instructions, current authorization, ADRs, architecture and handover reconciled. |
| `npm run lint`, `npm test` | Passed; `npm test` includes strict TypeScript validation, production build and 7/7 automated tests. |
| `npm run build` separately | Passed: strict TypeScript, emitted main/preload and Vite renderer production assets. |
| `npm run verify:desktop` after build | Passed on Windows: native window PID 20296/handle 15010932; renderer loaded via `file:`, bridge present, Node globals absent, CSP checked; three synthetic conversation turns completed, second recalled the current-session test word, third acknowledged no memory after close, reset showed zero UI/backend messages; Electron exited code 0 on window close. |
| Viewed ignored `test-results/astra-desktop.png` | Full ASTRA header, Ready indicator, welcome and composer visible after correcting an outer-page scroll issue. Screenshot was captured after reset; it does not show a populated transcript. |
| `Get-CimInstance Win32_Process` for this repository's Electron executable | No matching process after shutdown. Test-loaded Gemma was then stopped with `ollama stop gemma3:4b`; `ollama ps` showed zero loaded models. |
| `git status --short` | Repository still has no commits and all intended project files remain untracked. No unrelated work was removed, staged or committed. |
| `py -3.12 -c ...` documentation validation | Ten continuity/run documents exist, decode as UTF-8, are nonempty and have no trailing whitespace. |

**Known limits:** The unavailable-Ollama path was tested with an injected failing local request in `npm test`, not with the live service stopped. The exact digest is checked before send and against `/api/ps` after generation; a concurrent external model change between those checks could cause a discarded generation, but would not be shown as an approved reply. Replies are complete rather than streamed and capped at 512 generated tokens. Long sessions may exceed the 4K model context; sustained context behavior was not measured. The authored personality is a system instruction, so behavioral adherence is empirical rather than guaranteed. No installer/packaged-resource test or disconnected-network test has passed. **M1 is not complete.**

**Exact next recommended task:** with Karl's separate approval, perform a real disconnected-network Windows conversation acceptance test and longer-session/context resource check without adding functionality. Record restoration of network connectivity and the results. Do not begin M2 memory, voice, tools, model switching or further M1 features under Phase 3 authority.

## M1 Phase 2 — historical state (2026-10-13; superseded by Phase 3 above)

Karl authorized read-only model identity investigation and controlled follow-up inference. **M1 remains in progress.** No model was downloaded, manually changed, integrated, or selected by Karl. The recommendation is `gemma3:4b` llama.cpp digest `c30276f7…` for V0.1 basic chat, pending his approval. The authoritative detail is the Phase 2 section of `docs/M1_BENCHMARK_PHASE1.md`; the Phase 1 section below is historical.

- `gemma3:4b` has two listed digests because Ollama 0.40.1 automatically migrated the local GGUF to a llama.cpp runner while retaining the GGML variant. `/api/show` chooses `c30276f7…`; Phase 2 `/api/ps` confirmed this exact runtime digest. Server log timing shows the first Phase 1 benchmark crossed migration and had two runners resident, which explains the anomalous whole-GPU reading more strongly than the earlier unknown-cause claim. The v2 manifest-list SHA-256 stayed `0FDF8167C19C61124C79ADD8B0457203F73367FE64E5105634F1096547D76B2E` across this session's follow-up benchmark. No model files were manually edited.
- Created `scripts/evaluate-ollama.mjs` to pin digests and compare models alone with identical prompts/settings. Final saved runs: Gemma 62.6 average generated tokens/s and 4,692 MiB peak whole-GPU use; Qwen 42.7 tokens/s and 5,588 MiB. Both passed unknown-personal-information and exact-JSON checks. Both failed the stronger TypeScript task under `tsc --strict` and both added a Markdown fence despite a code-only request. The six runtime cases were not executed because typechecking failed. Raw JSON and candidate code are ignored under `test-results/`.
- An initial checker option (`--module none`) was rejected as deprecated by the installed TypeScript before checking either answer. It was changed to `--module commonjs`, and both model runs were repeated with the corrected checker. The final saved results contain actual model TypeScript errors, not that harness error.
- `ollama stop` unloaded each benchmarked model; final `ollama ps` listed zero models. No chat integration, memory, voice, model switching, autonomous tools or cloud dependency was added.

### Phase 2 commands and results

| Command/check | Result and limit |
| --- | --- |
| `ollama list`, `ollama show gemma3:4b`, loopback `/api/tags`, `/api/show`, `/api/ps`; local manifest and server-log inspection | Established two migration runners and current default/runtime digest. Ollama itself migrated the model in Phase 1; no manual model modification in Phase 2. |
| `Get-FileHash` on local Gemma v2 manifest list before/after inference | Same SHA-256 `0FDF8167C19C61124C79ADD8B0457203F73367FE64E5105634F1096547D76B2E`. Hash stability applies to this manifest list, not every model blob. |
| `node --check scripts/evaluate-ollama.mjs`; `npm run lint`; `npm run typecheck` | Passed. |
| `node scripts/evaluate-ollama.mjs gemma3:4b` then `node scripts/evaluate-ollama.mjs qwen2.5-coder:7b` | Both completed separately, confirmed expected loaded digest, recorded timings/telemetry, and stopped cleanly. The corrected-checker reruns are the final saved evidence. |
| Local `tsc --strict` on generated TypeScript | Both failed for real readonly/mutable tuple errors. Six runtime checks were consequently skipped. |
| `ollama ps`; `git status --short` | No models loaded; repository still has no commits and all intended source/docs remain untracked. No unrelated work removed. |

**Limits:** only one final short pass per model at 4K context, no disconnected-network or longer-context test, no runtime execution of code that failed typechecking, and system-wide GPU samples are not per-process attribution. `size_vram` from `/api/ps` is the model-specific loaded estimate. An inferred cause of the Phase 1 peak cannot provide exact per-runner GPU allocation. The exact next action is for Karl to approve or decline the recommended Gemma digest for a separately scoped M1 desktop integration; if coding correctness is essential to V0.1, run a separately approved coding repair benchmark before selection.

## M1 Phase 1 — historical state (2026-10-13; superseded by Phase 2 above)

Karl authorized discovery and benchmarking of **existing** Ollama models only. M1 is **in progress**; no model has been selected or integrated. See `docs/M1_BENCHMARK_PHASE1.md` for prompts, settings, full comparison, resource evidence and reproducible commands.

- Verified Ollama 0.40.1 on the CLI and loopback API. Both requested candidates were installed; no model was loaded before testing. The Ryzen 5 5500 / 16 GB RAM / RTX 3050 8 GB host was measured with `nvidia-smi` and Windows hardware queries. No Ollama installation, download, model deletion or model-file edit was performed.
- Created `scripts/benchmark-ollama.mjs` (Node built-ins only). It sends five identical prompts per model to `/api/chat` at 4,096 context, 256 output tokens, temperature 0 and seed 42; measures first visible token, throughput and wall/load time; samples system CPU, free RAM and GPU memory/utilization; stops its own model. A 512-token reasoning retest was run for both. Raw JSON is ignored under `test-results/`.
- Gemma's first tag digest was `a2af6cc3…`. `/api/tags` now reports **two** entries named `gemma3:4b`, with digests `aa1cd771…` and `c30276f7…`, modified during the first benchmark run. The cause is unknown. The script now refuses ambiguous names. Gemma's initial 7,588 MiB GPU peak and 937 MiB minimum free RAM are confounded by this concurrent tag change; later Gemma runs peaked at 4,675 MiB. Qwen's tag remained `dae161e2…` and peaked at 5,569 MiB GPU memory at 4K context.
- Both models answered the honesty and JSON prompts correctly. Both produced plausible `dedupeById` TypeScript by inspection but ignored the code-only formatting instruction by adding Markdown fences. Gemma met the three-sentence conversation request; Qwen exceeded it. Gemma solved the queue calculation within 256 tokens; Qwen was cut off at 256 but solved it at 512.

### Commands and results

| Command/check | Result |
| --- | --- |
| `ollama --version`, `ollama list`, `ollama ps`; local `/api/version`, `/api/tags`, `/api/show`, `/api/ps` | Ollama 0.40.1 responsive; models discovered; metadata and tag instability recorded. |
| `nvidia-smi --query-gpu=...`, Windows system queries | RTX 3050 8,192 MiB; hardware/baseline and sampled utilization recorded. |
| `node scripts/benchmark-ollama.mjs gemma3:4b` and `... qwen2.5-coder:7b` | Five prompts each completed; Qwen reasoning ended at output cap. |
| `node scripts/benchmark-ollama.mjs gemma3:4b reasoning-512` and `... qwen2.5-coder:7b reasoning-512` | Both solved reasoning; no model left loaded after the runs. |
| `node scripts/benchmark-ollama.mjs gemma3:4b repeat` | Second five-prompt pass completed, but Gemma tag identity was changing/ambiguous; evidence kept separate. |
| `node --check scripts/benchmark-ollama.mjs`; `npm run lint` | Passed. |
| Output inspection and JSON parsing | Exact JSON values verified; code fences and reasoning truncation recorded. |
| Final `/api/ps` / `ollama ps` | Zero loaded models. |

The initial API unload request for Gemma did not immediately remove it from `/api/ps`; `ollama stop gemma3:4b` did. The benchmark script now uses the CLI stop and checks for zero loaded copies. A repeat-mode filename bug briefly overwrote our own ignored reasoning artifact; it was moved to the repeat filename and the reasoning artifact was regenerated. No user-owned files were touched.

### Limitations and next action

- No disconnected-network test, sustained multiturn/large-context test, complex coding evaluation or per-process GPU attribution. System-wide telemetry can include other applications.
- A final V0.1 model recommendation is **deferred** until Gemma resolves to one stable digest and is retested in a quiet window. Do not automatically retag/delete models. Ask Karl how to handle the duplicate Gemma entries if a model modification is needed.
- **Next recommended task:** after Karl directs the tag investigation/resolution, confirm one stable `gemma3:4b` digest, rerun the sequential comparison with stronger coding and multiturn tasks, then seek approval before integrating a chosen model. No chat, memory, voice, autonomous tools or model switching has been implemented.

## M0 Phase 2 — historical state (2026-10-13)

**M0 complete against the documented acceptance criteria.** Karl authorized Phase 2 desktop implementation and verification. M1 is not authorized.

### Implemented and verified

- Standalone Git repository at `C:\Users\karlr\repos\Astra`; no commit has been made. All current project files are untracked. This repository remains separate from AstraNova.
- Electron main loads only the local Vite-built renderer; React + TypeScript displays ASTRA, a welcome screen and an explicit disconnected-brain status. Dark/purple screenshot visually inspected at `test-results/astra-desktop.png` (ignored by Git).
- Electron preload is bundled for sandbox compatibility. The only renderer bridge method is `getAppInfo()`. BrowserWindow uses context isolation and sandbox, disables Node integration/webviews, and denies permission requests, navigation and new windows. CSP denies connections. Windows runtime check confirmed `window.require` and `window.process` are undefined in the renderer.
- No chat, Ollama connection, model, personal memory database, voice, computer control or cloud API exists.

### Validation record

| Date | Command / check | Result | Limit |
| --- | --- | --- | --- |
| 2026-10-13 | `npm install react react-dom`; `npm install --save-dev electron vite typescript eslint @eslint/js typescript-eslint @types/react @types/react-dom @types/node`; `npm install --save-dev esbuild` | Dependency installation succeeded; lockfile written; npm reported 0 vulnerabilities | Initial install requires package registry access. |
| 2026-10-13 | `npm run typecheck` | Passed for main/preload/shared and renderer with strict TypeScript | Static check only. |
| 2026-10-13 | `npm run lint` | Passed | Static check only. |
| 2026-10-13 | `npm test` | Build passed; 2/2 tests passed for window security settings and built renderer/CSP | Tests do not replace runtime launch. |
| 2026-10-13 | `npm run verify:desktop` | Passed: native Windows handle 47254356 for Electron PID 8516, local `file:` page, ASTRA/welcome/disconnected text, bridge reply, no renderer Node globals, no renderer errors, screenshot, window close and process exit code 0 | Point-in-time launch on this Windows session; no installer test. |
| 2026-10-13 | Viewed `test-results/astra-desktop.png` | Dark screen, purple accents, ASTRA and status visually present | Screenshot is local test evidence, not a full accessibility review. |
| 2026-10-13 | `Get-CimInstance Win32_Process` filtered to this repository's Electron executable | No matching Electron processes after shutdown | Point-in-time orphan check. |
| 2026-10-13 | `git status --short`, `rg --files`, `npm ls --depth=0` | Only intended M0 source/docs/tooling files; installed dependency tree listed without errors | No commit or installer created. |
| 2026-10-13 | `py -3.12 -` document/reference/status validation; `git check-ignore --no-index` for screenshot/model/database samples | Passed: required docs, links, whitespace and M0/M1 status consistent; sample runtime files ignored | Does not prove future runtime storage behavior. |

The first launch checks failed because the page target and React rendering were observed too early; the verifier now waits for both. Live renderer logs then revealed that sandboxed preload could not require the emitted shared module. Bundling preload fixed that failure while retaining the sandbox. TypeScript's deprecated Node resolution setting and ESLint's missing Node globals were also corrected before the final passing checks.

### Known limitations and next boundary

- No packaged Windows installer or distribution artifact. `npm run dev` launches the Electron dependency after a local build; it has no hot reload.
- Offline operation is a design requirement and the M0 app loads local files with `connect-src 'none'`; an explicit disconnected-network acceptance test has not been run. Memory portability cannot be runtime-tested until M2.
- No model benchmark has been run. Candidate models remain undecided.
- **Next action:** stop after M0. If Karl approves M1, first define a reproducible target-hardware benchmark and model-selection criteria before downloading models or implementing Ollama chat.

## Archived M0 Phase 1 state (superseded by the current state above)

Statements below describe the earlier documentation-only session and no longer define current implementation or authority.

Updated: 2026-10-13. Scope of this work session: repository initialization and M0 documentation only.

## Verified

- A new Git repository exists at `C:\Users\karlr\repos\Astra`. It is separate from `C:\Users\karlr\repos\AstraNova`.
- The eight required M0 documents and a `.gitignore` exist. Documentation describes the approved stack, offline operation, empty starting memory, memory portability, milestone gates, and replacement-agent procedure.
- No application source, dependency manifest, desktop scaffold, model, memory database, or test suite was created in this session.

## Validation record

| Date | Check | Result | Limit |
| --- | --- | --- | --- |
| 2026-10-13 | `git rev-parse --show-toplevel` | `C:/Users/karlr/repos/Astra` | Confirms repository root only. |
| 2026-10-13 | `py -3.12 -` inline validation of eight required paths, nonempty UTF-8 content, trailing whitespace and Markdown references | Passed after correcting the validator to resolve references relative to their document; first run falsely flagged `CHECKLIST.md` | Document validation only, not application tests. |
| 2026-10-13 | `rg -n "Vue|M0|NOT VERIFIED|memory|offline|approval|AstraNova" AGENTS.md docs .gitignore` and manual cross-check | Passed: approved stack, boundaries and milestone statuses align | Editorial review, not application test. |
| 2026-10-13 | `git check-ignore --no-index` with sample model, memory, backup, secret and dependency paths | Passed: all five sample paths ignored | Ignore rules do not prevent deliberate force-adds or files stored elsewhere. |
| 2026-10-13 | `git status --short` and `rg --files -g '!\.git'` | New documentation and `.gitignore` only; no application files | Repository is uncommitted. |

## Not verified / blockers

- Electron launch, React rendering, TypeScript build, tests, offline operation, Ollama performance, and SQLite portability are **NOT VERIFIED**. Their implementations do not exist.
- M0 is **in progress**. Desktop scaffold and tests are pending explicit approval under the current execution authority.
- No model benchmark has been run. Candidate models remain undecided.

## Next recommended task

After Karl explicitly approves the next M0 scope, create the minimal Electron main/preload + React/TypeScript scaffold and meaningful build/startup tests, then run and record Windows results. Do not start M1 or download models as part of that task.
