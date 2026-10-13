# Current verified state

## LW-02A Character design and 3D performance gate — current state (2026-10-13)

Karl approved a character-design and scene-performance milestone. Preflight read the continuity documents and inspected the working tree: `main` at `eb6ebea` is one commit ahead of `origin/main`, and the LW-01 checkpoint plus all LW-02A changes are uncommitted in the working tree. Nothing was reset, staged, committed or pushed, and no unrelated work or runtime data was touched. The preceding agent completed most of the implementation but ran out of usage before verification of its newest code and before any continuity document was updated.

**Implemented (carried from the working tree):** `src/shared/worldCamera.ts` is a pure dimension-based framing function with full-body fit margins and a compact/desktop variant; `src/shared/worldPerformance.ts` summarizes bounded renderer-local frame samples (interval, render CPU wall time, draw calls, triangles). `LivingWorldViewport.tsx` paces rendering with `requestAnimationFrame` under a 30 fps cap, interpolates camera position and look target on resize, and exposes the sample buffer for read-only diagnostics. `scene.ts` builds its initial camera from the same framing helper. `styles.css` gives the compact layout more viewport height. `scripts/measure-world.mjs` measures per-state performance, resize, minimize/restore, manual pause, reduced motion and the WebGL fallback, and `tests/worldCamera.test.mjs` covers camera fit and frame-summary behaviour. `docs/LW02A_CHARACTER_SPEC.md` specifies proportion, palette, the Blender-to-GLB contract, skeleton, facial controls, candidate clips and provisional budgets. `scripts/blender/create_astra_design_prototype.py` builds a non-rigged blockout and renders five review views; ADR-015/016/017 and `ARCHITECTURE.md` record the scheduling, camera/design gate and future intention-validation boundaries. The application still renders the labelled procedural mannequin; no GLB, rig, animation or future service exists.

**Fixed in this session (real defect, not previously executed):** the reduced-motion path did not work. `measure-world.mjs` had been edited after its last successful run, so its reduced-motion and WebGL-fallback assertions had never executed; running it failed with `Emulated reduced motion did not pause the scene`. Investigation showed Chromium reported `document.hidden=true` for the window in some runs and, more importantly, that the cached `MediaQueryList` created at mount kept reporting `matches === false` while a fresh `matchMedia` call correctly reported `reduce`, so the frame loop kept rendering under an emulated reduce preference. `LivingWorldViewport.tsx` now reads the preference fresh inside `reason()` on every check, keeps the `change` listener as a best-effort trigger, and adds a 300 ms watchdog that re-synchronizes state so a stopped scene resumes when the preference is cleared. `measure-world.mjs` now polls for the paused and resumed states instead of sleeping a fixed 250 ms. `verify-desktop.mjs` gained `focusWindow` (AttachThreadInput/SetForegroundWindow) before giving up on visible frames and an opt-in `--allow-occluded` mode that records the visibility method it used instead of silently weakening the assertion.

**Commands and evidence (all executed 2026-10-13 in this session):** `npm run lint` passed with no findings. `npm test` passed **11/11** (nine pre-existing plus two new camera/frame-summary tests) and built main, preload and the production renderer; Vite still warns about the 558 kB lazy Three.js chunk (141 kB gzip). `node scripts/measure-world.mjs` completed a native-visibility run and printed `PASS: reduced-motion media emulation paused/resumed; WebGL-disabled reload showed text fallback with ready chat`; evidence is ignored `test-results/lw02a/candidate-native-performance.json`. `npm run verify:desktop` failed first with the documented foreground limitation (Chromium reported the Win32-visible, non-minimized window as hidden while another window held foreground), then passed a complete run after the focus helper was added: native PID 1596/handle 31524680, capped idle frames, manual and minimized pause, live four-turn Gemma conversation, scroll behavior, reset, desktop/compact layout, restricted bridge, no renderer errors and exit code 0; `test-results/astra-lw01-performance.json` now records the visibility method used. Blender 5.2 was re-run with `scripts/blender/create_astra_design_prototype.py` into a temporary folder and reproduced all five renders and the editable `.blend` within a few bytes of the committed review images, confirming the workflow is repeatable. Screenshots `test-results/lw02a/astra-lw02a-desktop.png` and `astra-lw02a-compact.png` and the five `docs/review/lw02a/*.png` design renders were visually inspected: full body visible in both layouts, and the prototype shows the purple updo, expressive eyes, mischievous smile, purple star hoodie, dark trousers and trainers.

**Measured performance (ignored `test-results/lw02a/*.json`):** the LW-01 baseline cap replays at 10.70–10.79 fps across every sampled state; the 30 fps candidate measures 30.0 fps average with a 33.6–33.8 ms p95 interval in idle, generating, finished, compact, restored and resumed states, with `renderer.render` at roughly 0.27–0.39 ms CPU per frame, 37 draw calls and 4,860 triangles. Electron's four-process tree stayed near 345–362 MiB working set and system CPU peaked near 26% during generation. Minimized and manual-paused samples recorded zero frames. These are brief controlled samples of the procedural mannequin, not a sustained guarantee and not a result for a real character asset. Whole-GPU `nvidia-smi` readings include Ollama and other applications and cannot be attributed to the 3D scene. The previous LW-01 "10.9 fps" reading is explained by LW-01's own 12 fps cap rather than by Gemma contention.

**Limits and blockers:** the character renders are a non-rigged design blockout that the specification itself describes as somewhat toy-like; they are not approved art, a rig, a GLB or a production asset. No OS-level reduced-motion setting was changed — verification used DevTools media emulation. The offscreen path has code but still no independent acceptance run. The strict native foreground verifier run remains environment-dependent on this machine; when it fails, `--allow-occluded` is required and its visibility method is recorded rather than hidden. No disconnected-network test, long chat/3D soak test, packaged build or installer test was run, and M1 offline acceptance remains open. Character asset rights, final proportions, rig, GLB integration and performance acceptance against a real skinned asset all require LW-02B approval.

**Exact next recommended task:** Karl reviews the five `docs/review/lw02a/astra-design-prototype-*.png` renders, the desktop and compact screenshots and `docs/LW02A_CHARACTER_SPEC.md`, and approves or revises the appearance — especially age/proportions, face and hair silhouette, hoodie star, hands, shoes and palette. Stop at LW-02A until that visual approval.

## LW-01 Living World proof of concept — historical state (2026-10-13; superseded by LW-02A above)

Karl approved a local 3D technical proof of concept. Preflight read the repository continuity documents and inspected code/tests; `git status --short --branch` was clean on `main...origin/main` at commit `7720b95a66604288522d1830af48aade40ffd6b1` before changes. Previous V0.2 text below says the repository had no commits; that was true during that older session but is stale now. No unrelated work was reset, staged or committed in LW-01.

**Implemented:** The existing `AvatarPanel` now lazy loads `src/renderer/world/LivingWorldViewport.tsx`, which owns a local WebGL canvas, camera resize, a manual Pause/Resume control, visibility/offscreen/reduced-motion checks, a roughly 12 fps idle timer and cleanup. `src/renderer/world/scene.ts` builds a small procedural room and a clearly labelled temporary full-body mannequin with head, arms/hands, legs, purple updo and star hoodie; joint positions change during idle. It is not final art or a production rig. The renderer still has no direct Ollama, Node, filesystem or network access. Main/preload/ChatService, approved Gemma digest and CSP are unchanged.

**Files changed:** `package.json` and `package-lock.json` add only runtime `three` and development `@types/three`; created `src/renderer/world/scene.ts` and `LivingWorldViewport.tsx`; modified `AvatarPanel.tsx`, `styles.css`, `scripts/verify-desktop.mjs`, `README.md`, `AGENTS.md`, `docs/MASTER_PLAN.md`, `CHECKLIST.md`, `CURRENT_STATE.md`, `HANDOVER.md`, `ARCHITECTURE.md`, `DECISIONS.md` and `LIVING_COMPANION_PLAN.md`. Removed a malformed UTF-16 trailing header from `README.md`. No model or personal-memory file was touched.

**Commands and evidence:** `npm install three`; `npm install -D @types/three` (both succeeded, zero audited vulnerabilities); `npm run typecheck` passed; `npm run lint` passed after importing Node's `performance`; `npm test` passed 9/9 and built the production renderer/main/preload; `npm run build` passed. `npm run verify:desktop` opened native Windows Electron, checked a drawable 3D canvas and successive idle frames (joint-update code inspected), manual pause and actual minimize with zero new frames, restore, native resize to 700×560 and 640×480, restricted bridge/CSP, no renderer errors, live four-turn local Gemma chat including session recall and no cross-restart-memory claim, reset and clean exit code 0. `Get-CimInstance Win32_Process` found no Astra Electron process after close. Ignored screenshots `test-results/astra-lw01-desktop.png` and `astra-lw01-compact.png` were captured and visually inspected: room, full-body mannequin, placeholder label and chat are visible in both. The test-loaded Gemma model may remain cached by Ollama's normal keep-alive; LW-01 did not stop or modify it.

**Performance sample:** `test-results/astra-lw01-performance.json` is ignored and contains synthetic-chat-only telemetry. In the measured run, the first response took about 2.2 s. The 1.4 s idle sample reported 14 fps during startup/resize, 349.8 MiB for the four-process Electron tree, 7% system CPU, 3% whole-GPU utilization and 4,522 MiB whole-GPU memory used. During the 1.2 s first-chat window the UI still showed **Generating**, the scene frame count advanced, and sampled FPS was 10.9; Electron tree working set was 361.5 MiB, system CPU 27%, whole-GPU utilization 94% and whole-GPU memory used 4,565 MiB. The timer target is 12 fps; extra initial resize draws explain why the startup sample can exceed it. Whole-GPU readings include Ollama and other applications and do **not** measure viewport-specific VRAM. System free RAM and GPU free memory, along with methodology, are in the JSON. These brief samples show responsiveness during one reply, not a sustained performance guarantee.

**Limits and blockers:** The Vite build warns that the local lazy-loaded Three.js chunk is 557 kB minified (about 141 kB gzip); the base UI chunk is 231 kB. WebGL-unavailable fallback, OS reduced-motion setting and offscreen observer behavior are implemented but not independently exercised in a Windows acceptance run. No disconnected-network test, long chat/3D soak test, installer or packaged-resource test was run. M1 offline acceptance remains open. A later verifier rerun, after the successful native run above, could not start visible-frame measurement because Chromium reported `document.hidden=true` for an Electron window that Win32 reported visible and nonminimized; another window held foreground. The strict verifier stopped there; this is an environmental visibility limitation, not a passing rerun. The working code was returned to the prior proven scene behavior, with a more patient visibility check/diagnostic in the verifier. No final character, virtual-room simulation, memory, voice, website research, autonomous actions or fine-tuning exists. Final character and world scope require Karl's separate decision.

**Exact next recommended task:** Karl reviews the two LW-01 screenshots and resource sample, then approves a separately scoped 3D character/rig specification (model format, bones/facial controls, local asset rights/source, expressions, animation clips, compact readability and sustained performance target). Do not build final artwork or future services under LW-01.

## V0.2 Phase 01 — historical state (2026-10-13; superseded by LW-01 above)

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
