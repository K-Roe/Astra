# Handover for the next AI agent

## Current LW-01 handover (2026-10-13)

Karl approved and LW-01 implements a **local procedural 3D proof of concept only**. The prior CSS portrait is replaced inside `AvatarPanel` by a lazy-loaded Three.js viewport, procedural room, fixed camera and temporary full-body articulated mannequin. It is clearly labelled a placeholder. The scene owns its WebGL/timer/observer lifecycle, targets 12 idle frames per second, has a manual pause control, stops when the document is hidden/minimized or viewport offscreen, and respects reduced-motion preference. Chat, Gemma identity, Electron main/preload, CSP and security boundaries remain intact. No final artwork, production rig, room simulation, voice, memory, website access, tools or fine-tuning was added.

**Repository state:** At LW-01 preflight `main...origin/main` was clean at `7720b95a66604288522d1830af48aade40ffd6b1`; historical sections below that describe an untracked repository are stale. LW-01 changes are in the working tree and have not been staged or committed. Before further changes, read `AGENTS.md`, `MASTER_PLAN.md`, `CHECKLIST.md`, `CURRENT_STATE.md`, `DECISIONS.md`, this file, `ARCHITECTURE.md`, `ASTRA_PERSONALITY.md`, `LIVING_COMPANION_PLAN.md` and the benchmark report; inspect actual Git status/code. Preserve all work and runtime data.

**Files/seams:** `src/renderer/world/scene.ts` constructs/animates/disposes procedural objects only. `LivingWorldViewport.tsx` owns WebGL render, canvas, resize, pause and visibility. `AvatarPanel.tsx` lazy loads it while retaining typed presentation status. `scripts/verify-desktop.mjs` checks native window, successive idle frames, pause/minimize/restore, live four-turn Gemma chat, restricted bridge, compact resize, screenshot and clean close; joint-update code was inspected, and the verifier writes ignored `test-results/astra-lw01-performance.json`. `package.json` adds `three`, with `@types/three` development-only. `README.md` documents commands and current UI. ADR-013 explains direct Three.js over React Three Fiber for this one noninteractive viewport; ADR-014 and `ARCHITECTURE.md` document future boundaries without implementing them.

**Verification:** `npm run typecheck`, `npm run lint`, `npm test` (9/9 and production build), `npm run build` and `npm run verify:desktop` passed on 2026-10-13. The native verifier observed Gemma responding while the 3D frame counter advanced, manual/minimized pause with no further frames, resize at 700×560 and 640×480, reset and exit code 0. `test-results/astra-lw01-desktop.png` and `astra-lw01-compact.png` were visually inspected. The ignored performance JSON records approximately 2.2 s first-reply latency, 10.9 sampled scene fps during a window still marked Generating, 361.5 MiB Electron process-tree working set, 27% system CPU and 94% whole-GPU utilization; whole-GPU 4,565 MiB used includes Ollama and cannot be attributed to 3D. See `CURRENT_STATE.md` for methodology and limits. Vite warns about a 557 kB lazy-loaded Three.js chunk. A later rerun could not measure visible frames because Chromium reported the Win32-visible/nonminimized window as hidden while another window held foreground; the strict verifier stopped. The scene was returned to its previously proven behavior. No unrelated process or model was stopped.

**Outstanding:** OS reduced-motion, offscreen and WebGL-unavailable paths have code but no independent acceptance run; no sustained performance, disconnected-network, packaged build or final art/rig tests. M1 offline acceptance remains incomplete. Review the current Git diff and rerun checks if changing the scene. **Exact next recommended task:** Karl reviews LW-01 screenshots and performance evidence, then approves a separate 3D character/rig specification and acceptance plan. Stop at LW-01 until that approval.

## Historical V0.2 Phase 01 handover (2026-10-13; superseded above)

Karl authorized **Living Companion UI structure and temporary avatar preparation only**. Phase 01 is implemented and verified. Stop here until Karl approves another phase. The existing Gemma `gemma3:4b` digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291` remains the chat model; `src/main/chatService.ts`, main/preload IPC, CSP and Electron sandbox settings were not changed. M1 disconnected-network acceptance is still pending. No avatar artwork was generated/downloaded, and no rig, animation, microphone, speech, memory or tools were added.

**Repository safety:** `git rev-parse --verify HEAD` failed, `git ls-files` returned 0, and `git status --short` shows the project files untracked. M0 and M1 work must be preserved. Do not reset, clean, stage, commit or overwrite it without explicit authority. Before any changes, read `AGENTS.md`, `MASTER_PLAN.md`, `CHECKLIST.md`, `CURRENT_STATE.md`, `DECISIONS.md`, this handover, `ARCHITECTURE.md`, `ASTRA_PERSONALITY.md`, `LIVING_COMPANION_PLAN.md` and the M1 benchmark report; inspect actual code and Git status.

**Implementation seams:** `src/renderer/AvatarPanel.tsx` owns the labelled code-native portrait and visual state. `src/renderer/presentationState.ts` defines idle/listening/thinking/speaking/error; only idle/thinking/error map from current chat. `src/renderer/App.tsx` retains the existing bridge calls and now composes the character panel and conversation panel. It follows new chat messages unless the user scrolls up; a jump button returns to latest. `src/renderer/MessageContent.tsx` uses `src/shared/messageFormatting.ts` for escaped text and fenced code. `src/renderer/styles.css` handles desktop side-by-side and compact stacked layouts. Microphone/audio buttons are visibly disabled. `docs/LIVING_COMPANION_PLAN.md` sets approval-gated later stages.

**Verified commands/results:** `npm run lint` passed; `npm test` passed 9/9 and includes strict TypeScript and production build; standalone `npm run build` passed during layout iteration. `npm run verify:desktop` passed a native Windows four-turn Gemma conversation, session context and no-persistent-memory answer, avatar thinking/idle states, scroll hold/jump, reset, actual window resize to 700×560 and 640×480, no horizontal overflow/clipped composer/voice controls, bridge/security checks, and exit code 0. Ignored screenshots `test-results/astra-living-desktop.png` and `test-results/astra-living-compact.png` were inspected. A process query found no Astra Electron process after close; the test-loaded model was stopped and `ollama ps` returned zero models. See top of `CURRENT_STATE.md` for exact files and limitations.

**Exact next recommended action:** Karl reviews the desktop and compact screenshots, then explicitly approves or revises the avatar direction. With separate Phase 02 approval, create/acquire final local artwork and a layered rig; do not begin real animation or voice. The older M1/M0 sections below are historical and their authority/next-task statements are superseded here.

## Historical M1 Phase 3 handover (2026-10-13; superseded above)

Karl approved and Phase 3 implemented **basic, session-only Windows chat** with existing `gemma3:4b` digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291`. **M1 remains incomplete; Phase 3 authority stops here.** Read `AGENTS.md`, `docs/MASTER_PLAN.md`, `docs/CHECKLIST.md`, `docs/CURRENT_STATE.md`, `docs/DECISIONS.md`, this handover, `docs/ARCHITECTURE.md`, `docs/ASTRA_PERSONALITY.md`, and the benchmark report before changing code. Inspect actual files and `git status --short`; the repository has no commits and all project files remain untracked.

Runtime path: React `src/renderer/App.tsx` calls four typed methods in `src/preload/index.ts`; `src/main/index.ts` validates sender frame and owns `ChatService` from `src/main/chatService.ts`; the service calls only fixed loopback Ollama. `docs/ASTRA_PERSONALITY.md` is read at startup and prepended with explicit no-memory/no-tools boundaries. Exact model tag/default runner is checked before every send and loaded digest after response. History is main-process memory only; clear aborts active work and resets it, and app exit drops it. The renderer CSP still denies network connections. No user transcript is logged or persisted. No model download or manual model change occurred.

Verification on 2026-10-13: pre-integration warm-up `/api/ps` confirmed approved digest and 4,096 context; `npm run lint`, `npm run build` and UTF-8/document presence checks passed; `npm test` passed 7/7 with strict TypeScript and production build; `npm run verify:desktop` passed live Windows three-turn chat, current-session recall, no-persistent-memory answer, UI/backend reset, restricted bridge and exit code 0. `test-results/astra-desktop.png` was visually inspected after fixing header scroll; it is ignored. `Get-CimInstance` found no Astra Electron process after close. `ollama stop gemma3:4b` returned `ollama ps` to zero loaded models. `README.md`, architecture, decisions, checklist, current state and this handover were updated. See top of `CURRENT_STATE.md` for files and command evidence.

Known limits: service-unavailable behavior was verified with an injected failed request, not a live service shutdown; no disconnected-network test, installer test, large-context/sustained chat test, persistent memory or M3 coding tools. Model compliance with personality is measured only by the synthetic conversation. M1 acceptance requires offline conversation evidence and remaining checklist checks.

**Exact next task requiring Karl's separate approval:** run a controlled Windows chat acceptance with external network disconnected, restore connectivity afterward, and measure longer-session/context behavior on target hardware. Record commands and limits. Do not silently expand to memory, voice, tools, model switching or model downloads. The older Phase 2/M0 sections below are historical and their authority/next-task statements are superseded here.

## Historical M1 Phase 2 handover (2026-10-13; superseded above)

Karl authorized only Gemma identity investigation and controlled follow-up benchmarking. That work is complete. **Do not begin desktop AI integration without Karl's next approval. M1 is incomplete.** Recommended first V0.1 conversational model: existing `gemma3:4b` llama.cpp digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291`. This is a recommendation, not Karl's selection. See `docs/M1_BENCHMARK_PHASE1.md` Phase 2 section for evidence and commands; read the top of `docs/CURRENT_STATE.md` and `docs/CHECKLIST.md` before any work.

The two `gemma3:4b` entries are Ollama 0.40.1's GGML (`aa1cd771…`) and llama.cpp (`c30276f7…`) migration runners. The default and final benchmark loaded digest are `c302…`. Local logs show the first Phase 1 run crossed Ollama's migration and held two runners, so its 7,588 MiB whole-GPU peak should not be used as a single-runner requirement. No model was manually changed. `scripts/evaluate-ollama.mjs` pins identities and contains the exact Phase 2 prompts/settings. The final saved JSON is ignored in `test-results/ollama-final-*.json`. Both candidates failed the strict TypeScript coding gate; the six runtime cases were skipped. Gemma was faster and used less whole-GPU memory in the clean 4K comparison. No candidate has proven coding accuracy on the stronger task.

Commands completed this phase: identity queries (`ollama list`, `ollama show`, loopback `/api/tags`, `/api/show`, `/api/ps`), local server-log/manifest inspection and `Get-FileHash`; `node --check scripts/evaluate-ollama.mjs`, `npm run lint`, `npm run typecheck`; sequential `node scripts/evaluate-ollama.mjs gemma3:4b` and `node scripts/evaluate-ollama.mjs qwen2.5-coder:7b`; final `ollama ps` and `git status --short`. The first evaluation passes found a deprecated TypeScript checker option, which was corrected before the final saved passes. No models remain loaded. The repository has no commits and all intended project files remain untracked; preserve them.

**Exact next recommended action:** Karl reviews the Phase 2 comparison and explicitly approves or declines the `c302…` Gemma digest for a separately scoped M1 basic-chat integration. If V0.1 must already deliver reliable coding, request a separate coding repair evaluation before selection because neither model passed this task. Once a scope is approved, implement only that scope using the existing Electron main/preload/renderer boundaries, and separately verify disconnected-network operation and longer-context resource behavior before claiming full M1 acceptance. Do not download, delete, retag, overwrite or switch models silently; do not implement memory, voice or autonomous tools under this phase's authority.

The older Phase 1 and M0 sections below are historical and contain earlier next actions/authority statements that this current handover supersedes.

## Historical M1 Phase 1 handover (2026-10-13; superseded above)

Karl authorized discovery and benchmarking of existing Ollama models, with no downloads or desktop integration. This phase ran the existing `gemma3:4b` and `qwen2.5-coder:7b` tags separately. **M1 is not complete and no model is selected.** Read `docs/M1_BENCHMARK_PHASE1.md` and the top of `docs/CURRENT_STATE.md` before further work.

`scripts/benchmark-ollama.mjs` contains the exact prompts/settings and writes detailed JSON to ignored `test-results/`. It now refuses a duplicated model tag and stops its own loaded model after each run. The Gemma tag changed during the first run, and `/api/tags` currently lists two `gemma3:4b` entries with different digests. Qwen's digest stayed stable. The first Gemma resource peak and model identity cannot be cleanly attributed. Do not remove, retag, reinstall or download any model automatically. At handover, `/api/ps` showed no loaded models.

**Exact next action:** Karl decides how to investigate or resolve the duplicate Gemma tag if modification is required. Once `gemma3:4b` resolves to one stable digest, rerun a controlled sequential benchmark with a stronger coding task, a short multiturn conversation, 4K-context VRAM sampling and an explicit offline test. Then recommend a model and wait for Karl's approval before app integration. Do not implement chat, memory, voice, autonomous tools or model switching under this Phase 1 authority.

Before changes, follow `AGENTS.md`: read mandatory documents, inspect Git status and actual files, and preserve all current untracked work. Close each session by recording actual commands/results in `CURRENT_STATE.md`, checked evidence in `CHECKLIST.md` and a fresh handover.

## Archived M0 Phase 2 handover (historical; superseded above)

M0 documentation and desktop foundation are complete and verified on Windows as recorded in `CURRENT_STATE.md`. Karl approved M0 Phase 2 on 2026-10-13; no M1 work is authorized. The Git repository has no commits, and its intended project files are untracked. Do not stage or commit them without separate instruction.

The desktop runs from local built files with `npm run dev`. Electron main/preload, React renderer and shared app-info contract are in `src/`. `npm test` builds and runs two tests. `npm run verify:desktop` launches a real Windows window, checks rendered content and restrictions, saves an ignored screenshot, closes the window and checks exit. The verifier uses a loopback DevTools port only during that run. The normal application has no chat, memory, voice, models or computer tools.

**Exact next task, only if Karl authorizes M1:** Define a reproducible benchmark plan for quantized Qwen2.5-Coder 7B and a smaller general model on the Ryzen 5 5500 / RTX 3050 8 GB / 16 GB RAM machine. Specify representative coding and conversation prompts, latency/throughput/quality measures, RAM/VRAM capture and offline procedure. Obtain any needed model-download authorization before acquiring models. Implement Ollama integration and basic chat only within approved M1 scope, preserving the narrow IPC boundary.

Before ending any future work session, reconcile `CURRENT_STATE.md` and this handover with actual files and test output. Update `CHECKLIST.md` only for verified tasks. Record commands, results, blockers and the next concrete action so another agent can resume from repository files alone.

## Archived M0 Phase 1 handover (historical; superseded above)

Statements below describe the earlier documentation-only session and no longer define current authority or next work.

## Resume safely

1. Read `AGENTS.md`, `docs/CURRENT_STATE.md`, `docs/CHECKLIST.md`, and `docs/DECISIONS.md` before editing. Read the other four documents for scope, architecture and personality.
2. Inspect `git status --short`, `git rev-parse --show-toplevel`, the actual file tree and relevant source. Do not assume this handover is current.
3. Confirm you are in `C:\Users\karlr\repos\Astra`, not the existing AstraNova project. Do not copy its data or another assistant's history into Astra.
4. Preserve unrelated and user-owned work. Keep memory data, models and secrets outside the repository.

## Current work boundary

The repository and required M0 documentation were created on 2026-10-13. No application functionality exists or has been tested. The current authorization permits documentation and repository initialization only. Desktop scaffold and tests are still M0 work, but require Karl's explicit approval. M1, model downloads and paid services are not authorized.

## Exact next task when authorized

Build a minimal Windows Electron + React + TypeScript desktop scaffold with Electron main/preload, a typed narrow IPC bridge, React renderer, package scripts, and meaningful build/startup tests. Use `ARCHITECTURE.md` as a proposal and validate security settings in implementation. Keep it independent of Ollama and memory for this M0 step. Run tests and a Windows launch check; record exact commands/results in `CURRENT_STATE.md`, then update `CHECKLIST.md` only for checks that pass.

## Session closeout

Before ending any work session, reconcile `CURRENT_STATE.md` and this handover with actual files and test output. Record blockers and the next concrete task. A replacement agent must be able to resume using only this repository.
