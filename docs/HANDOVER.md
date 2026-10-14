# Handover for the next AI agent

## Current Intelligence V1 handover (2026-10-13)

**CA-01 handover, 2026-10-14: COMPLETE.** Karl's Intelligence V1 checkpoint was `b32bdb0`; CA-01 was reviewed for a local checkpoint on `main`. Start with `docs/CA_01.md` and the actual Git diff. Chat proposes validated Qwen patches, accepts approval in chat/Coding, applies approved files, runs approved tests and shows a diff. Disposable native acceptance passed 74/74, including a real two-stage failed-test correction with fresh approval, hostile output rejection and malformed Qwen fail-closed behavior; `npm test` passed 235/235, lint passed, and the final native verifier passed with clean exit. Partly applied work requires manual review, and the scaffold has not been built without dependencies. No push was made. Keep installation blocked and do not start CA-02.

`.gitignore` had hidden `src/main/models/codingBenchmark.ts`, which `b32bdb0` does not contain. The CA-01 checkpoint includes this required TypeScript source; a clean checkout of the earlier Intelligence V1 HEAD lacks that imported file.

**Read `docs/INTELLIGENCE_V1.md` first.** It is the architecture and operating manual: process layout, database schema, SSRF defences, the repository sandbox, the command runner, approvals, the task lifecycle, model routing and the measured benchmark.

**Where things stand.** Astra can learn from approved documentation, remember things including corrections, answer from stored sources with real citations and admit ignorance, discover and inspect repositories under `C:\Users\karlr\repos`, edit an authorised repository through structured patches, run allowlisted commands, and persist coding tasks that never auto-resume after a restart. **176/176 unit tests, 39/39 acceptance checks, native desktop verification passing.** Nothing has been committed or pushed.

**What is verified with real services, not mocks:** a live crawl of `https://react.dev/learn` that produced a cited answer, a real repository created and edited with a real passing test run and a real git diff, and a real restart that recovered a task without resuming it. Evidence is in `test-results/intelligence/`.

**Seams worth knowing before editing anything:**
- Only `src/main/research/reader.ts` touches the internet. Every URL passes `urlGuard.assertFetchAllowed` first, which checks scheme, exact host, path prefix and every resolved IP, then returns an address that is **pinned** for the connection. Do not add a code path that fetches without it.
- Only `src/main/workspace/pathGuard.ts` resolves repository paths. Edits are scoped **per repository**, not merely to the workspace root — `repoScope()` in `fileTools.ts` exists because `../escaped.js` once escaped into a sibling directory. Do not remove it.
- Only `src/main/workspace/commandRunner.ts` spawns processes. It uses no shell and refuses `npm install`, `node -e` and shell metacharacters. Treat that allowlist as security-critical.
- `ApprovalManager.assertApproved` must be called immediately before the privileged operation, never at plan time alone. `FORBIDDEN_ACTIONS` can never be approved at any level.
- Web content is data: `MemoryStore.remember` throws for `origin === 'web'`, and `grounding.referenceBlock` labels passages as untrusted before the payload appears.
- Behaviour belongs in `src/shared/*` and pure main modules; the renderer must stay free of Node, filesystem and network.
- Pure logic is tested directly with `createRequire` on `dist-electron/**`. `npm run build` type-checks, compiles main, bundles preload, builds the renderer, and esbuild-bundles the character controller for tests.

**Known gaps, stated honestly:** FTS5 keyword retrieval only (no embeddings, so paraphrases can miss); no repository scaffolding command because dependency installation is blocked; the Coding workspace exposes create/cancel/resume/approve but does not yet drive the full edit→test→diff loop from the UI (Scenario D proves the loop through the service layer); `node:sqlite` is experimental in Node; the coding benchmark is six short cases and does not certify unattended multi-step development.

**Never do:** treat a model or web string as permission; commit or push without Karl's approval; use a real Karl project for destructive testing; mark a checklist item complete without its stated check succeeding.

## LW-02C handover (2026-10-13; superseded by Intelligence V1 above)

## Current LW-02C handover (2026-10-13)

**Read this first: the authority record is out of date.** `AGENTS.md` still says authority stops after LW-02B-R1 and that LW-02C must not begin automatically. It was begun anyway on Karl's direct instruction to continue past the `806c1cf` approval checkpoint. Karl has not yet resolved this on paper, so do not treat LW-02C as ratified and do not begin LW-02D without asking.

**Where things stand.** Astra is now a real rigged character in the application, not the procedural mannequin. `src/assets/astra-character-v1.glb` is shipped locally, loaded over the existing sandboxed IPC bridge, and animated by 15 clips with 11 facial morph targets. `npm run lint` is clean, `npm test` passes 58/58, and `npm run verify:desktop` passes natively with the character loading as `ready` and demonstrably walking. **Nothing has been committed or pushed.** The tree is dirty and holds all LW-02C work.

**Seams worth knowing before editing anything:**
- `scripts/blender/create_astra_rigged_v1.py` is the only place the rig, weights, morphs and clips are defined. `scripts/blender/astra_character_model.py` holds the shared approved geometry that the LW-02B-R1 review scripts also consume.
- `src/shared/characterStateMachine.ts`, `characterNavigation.ts`, `characterIdle.ts` and `characterClips.ts` are pure, injected-clock, Node-testable logic. Put behaviour there, not in the controller.
- `src/renderer/world/characterController.ts` is the only place that touches Three.js animation, navigation and morphs. `characterAsset.ts` owns loading and disposal. `LivingWorldViewport.tsx` owns the render loop and React lifecycle.
- `App.tsx` is the only source of `CharacterEvent`s. It sends `chat_typing`, `chat_generating`, `chat_reply`, `chat_error` and `chat_interrupted`; do not add a model-driven animation path.
- The GLB is fetched by the main process on `CHARACTER_ASSET_CHANNEL` because the sandboxed renderer cannot `fetch` a `file://` URL. If you add assets, extend `CHARACTER_ASSET_IDS` in `src/shared/contracts.ts`; never pass a path from the renderer.
- `tests/characterController.test.mjs` drives the real controller with a stand-in asset. `npm run build` esbuild-bundles the controller to `dist-electron/test/characterController.mjs` for it. The 60-seed sweep in that file is the fastest way to catch navigation regressions.

**Bugs fixed here that are easy to reintroduce.** Arriving at an intermediate waypoint must not end a walk; only exhausting the path should. A `next` link is followed only for the seat that is actually the destination. `IdleScheduler.reset()` restarts the wait interval rather than firing immediately. The scheduler has its own RNG so blinks cannot perturb the schedule. One-shot completion is driven by the clip, not by `stateHoldsClip`. Disabling idle activities stops her where she stands.

**Not done, and not to be assumed:** retopology, lip sync, cloth or hair simulation, voice, memory, and any performance soak. The recorded 30 fps figures come from the desktop verifier's sampling, not from a separate `measure-world.mjs` run. See `docs/CURRENT_STATE.md` for the full evidence list.

## LW-02B-R1 handover (2026-10-13; superseded by LW-02C above)

## Current LW-02B-R1 handover (2026-10-13)

Karl approved further character refinement only. Preflight found a clean tree at `94521b7` (three local commits ahead of `origin/main`), **nothing pushed and nothing committed this session**. LW-02B-R1 rebuilds the character so it reads as a polished cartoon companion instead of a procedural mannequin. The application is **untouched** and still renders the labelled procedural mannequin. **Karl has not approved the character.** No rig, skin weights, shape keys, clips, GLB, asset loader, voice, memory, website research or autonomous behaviour exists.

**Key result:** the LW-02B face failed because its features were floating primitives pasted onto a smooth skull. R1 replaces that with a **single sculpted head mesh** — real eye sockets, brow ridge, nose, lips, cheekbones and chin displaced into the skull — with spherical eyeballs seated in the sockets, lids that wrap them, and integrated lips. Hair became overlapping soft masses with a proper gathered bun and lofted side-swept fringe bands. 40,232 triangles, 129 objects, 24 materials, 1.7498 m tall, **zero validation problems**. See `docs/LW02B_R1_CHARACTER_SPEC.md`.

**Files/seams:** `scripts/blender/create_astra_character_r1.py` is the reproducible source and the only place the model is defined; it prints its own geometry report, dimensions and validation result, saves an editable `.blend`, and renders all nine review images plus the room preview. `scripts/blender/make_astra_design_comparison.py` now takes an optional output name and both captions. `scripts/blender/create_astra_character_r1.py`'s `SKULL`, `FACE`, `EXPRESSIONS`, `facial_displacement` and `face_surface_y` are the single source of truth for the head; change a skull ring and its features move with it. `src/renderer/world/` and all application code are unchanged by this milestone.

**Verification actually run:** the Blender script completed with `ASTRA_R1_COMPLETE` and `problems=0`; `npm run lint` clean; `npm test` 11/11 with production build; `node scripts/verify-desktop.mjs --allow-occluded` passed natively (PID 13024, exit 0); `node scripts/measure-world.mjs --allow-occluded` held 29.9–30.0 fps (p95 33.6–33.7 ms) in every state, matching the previous baseline. Every render was visually inspected and seven rounds of defects were found and fixed.

**Watch out for:** facial features must be placed through `face_surface_y`, never by eye, or they float off the sculpted surface. Iris, pupil and glint spheres must sit **proud** of the eyeball surface — an early build placed them inside and they were invisible. The lip bulges must straddle the seam (`corner_z + 0.0042` and `corner_z - 0.0058`), never both below it. Fringe pieces must be lofted **bands**, not round strands, or they read as bars across the forehead. EEVEE uses a Standard view transform; AgX washes the palette out.

**Outstanding:** Karl's visual approval, then and only then retopology to budget, the vertex groups listed in `LW02B_R1_CHARACTER_SPEC.md` §6, the armature, morph targets, clips, GLB export, integration and a measured performance run against the 30 fps baseline. Also still open: OS reduced-motion and offscreen acceptance runs, disconnected-network, soak and packaged-build tests, M1 offline acceptance.

**Exact next recommended task:** Karl reviews `docs/review/lw02b-r1/`. **Do not begin LW-02C, rig the character, export a GLB or integrate it into the application.**

## Historical LW-02B handover (2026-10-13; superseded above)

Karl approved **visual character refinement only**. The LW-02A work was reviewed and committed locally as `3bf91b8` (branch is two commits ahead of `origin/main`); **nothing has been pushed**. LW-02A added a reviewed design proposal and a non-rigged Blender prototype; LW-02B replaced that prototype with a much better **refined blockout** and a written animation-readiness and GLB-export plan. The application is untouched: it still renders the labelled procedural mannequin. **Karl has not approved the character.** No rig, GLB, armature, skin weights, shape keys, animation clips, voice, memory, website research or autonomous behaviour exists.

**Key result:** the refined design is a 1.70 m, 5.76-heads-tall stylised young-adult woman built from lofted sections — 32,588 triangles across 118 objects — with a fitted violet updo, expressive eyes and brows, a mischievous smile, a purple star hoodie, dark trousers and trainers. It replaces a ~3.5-head chibi blockout. See `docs/LW02B_CHARACTER_SPEC.md` and `docs/review/lw02b/`.

**Files/seams:** `scripts/blender/create_astra_character_refined.py` generates the blockout, its six views, its in-room view and the editable `.blend`; `scripts/blender/make_astra_design_comparison.py` builds the side-by-side sheet; `scripts/blender/create_astra_design_prototype.py` is the preserved LW-02A "before" record and must not be edited. `src/renderer/world/` is unchanged by LW-02B and still owns the working Three.js scene.

**Verification actually run:** `npm run lint` clean; `npm test` 11/11 with production build; `node scripts/verify-desktop.mjs --allow-occluded` passed natively (PID 44432, exit 0); `node scripts/measure-world.mjs --allow-occluded` held 30.0 fps (p95 33.6–33.8 ms) in every state with zero frames while minimized or paused, matching the LW-02A baseline. The strict, non-`--allow-occluded` runs failed only because Chromium reports this session's window as hidden while another window holds foreground — an environment limitation, recorded in the evidence JSON.

**Watch out for:** the head/face landmark table (`HEAD_RINGS`, `FACE`) is the single source of truth for facial placement — features are positioned with `head_surface_y(z, x)` so they sit on the skull; changing a ring without moving its features will sink them. Hands fan fingers across the **X width axis**; an earlier version used Y and the hands rendered as combs. EEVEE uses a Standard view transform, not AgX, because AgX washed the palette out.

**Outstanding:** Karl's visual decision (proportions, updo, hood, hair framing, hands, shoes, palette saturation); then and only then retopology, the rig, morph targets, clips, GLB export, application integration and a performance measurement against the 32,588-triangle blockout. Also still open: OS reduced-motion and offscreen acceptance runs, disconnected-network, soak and packaged-build tests, M1 offline acceptance.

**Exact next recommended task:** Karl reviews `docs/review/lw02b/` (start with `astra-lw02b-comparison-lw02a-vs-lw02b.png`). **Stop at LW-02B and request his approval before any rigging or integration work. Do not begin LW-02C.**

## Historical LW-02A handover (2026-10-13; superseded above)

Karl approved a **character design and 3D performance gate**. The app still renders the labelled procedural mannequin; the Blender work is a design proposal awaiting Karl's visual approval, not a production asset. Chat, the approved Gemma digest, Electron main/preload, CSP and the sandbox are unchanged. No rig, GLB integration, animation controller, room simulation, voice, memory, website research, autonomous tools or fine-tuning was added.

**Repository state:** `main` is one commit ahead of `origin/main` at `eb6ebea` (LW-01 checkpoint). All LW-02A work is uncommitted in the working tree; nothing has been staged, committed or pushed. Preserve it. Read `AGENTS.md`, `MASTER_PLAN.md`, `CHECKLIST.md`, `CURRENT_STATE.md`, `DECISIONS.md`, this file, `ARCHITECTURE.md`, `LIVING_COMPANION_PLAN.md` and `LW02A_CHARACTER_SPEC.md` before changing anything, and inspect actual Git status and code.

**Key result:** the LW-01 "10.9 fps during Gemma generation" was LW-01's own 12 fps cap, not a stall. A replay of that cap measures 10.70–10.79 fps; the 30 fps rAF candidate measures 30.0 fps average (33.6–33.8 ms p95) in idle, generating, finished, compact, restored and resumed states with about 0.3–0.4 ms render CPU per frame, 37 draw calls and 4,860 triangles. Minimize and manual pause render nothing.

**Files/seams:** `src/shared/worldCamera.ts` (pure camera framing) and `src/shared/worldPerformance.ts` (frame-sample summary) are renderer-safe pure modules; `src/renderer/world/LivingWorldViewport.tsx` owns WebGL, the rAF loop, pause, resize, the reduced-motion check and the bounded diagnostic buffer; `src/renderer/world/scene.ts` builds procedural geometry only. `scripts/measure-world.mjs` records per-state performance and fallback behaviour; `scripts/verify-desktop.mjs` runs the native chat/security/layout acceptance and now supports `--allow-occluded`. `scripts/blender/create_astra_design_prototype.py` renders the design prototype. `tests/worldCamera.test.mjs` covers camera fit and frame summaries.

**Verification:** `npm run lint` clean; `npm test` 11/11 with a production build; `node scripts/measure-world.mjs` passed natively including reduced-motion emulation pause/resume and the WebGL-disabled text fallback with chat still ready; `npm run verify:desktop` passed a full native run (PID 1596) with exit code 0 after the foreground focus helper was added; Blender re-ran reproducibly into a temporary folder. Full details and limits are in `CURRENT_STATE.md`.

**Watch out for:** the reduced-motion check must read `matchMedia` fresh. A cached `MediaQueryList` silently stayed stale under media emulation and the scene kept rendering; a 300 ms watchdog now re-synchronizes state. On this machine the strict verifier can fail because Chromium reports the app hidden while another window holds foreground; `focusWindow` was added to help, and `--allow-occluded` records the visibility method it used rather than weakening the assertion.

**Outstanding:** Karl's visual approval of the character direction; OS-level reduced-motion and offscreen acceptance runs; a real skinned/animated GLB for any meaningful performance or budget claim; disconnected-network, soak and packaged-build tests; M1 offline acceptance.

**Exact next recommended task:** Karl reviews the five renders in `docs/review/lw02a/`, the desktop/compact screenshots and `docs/LW02A_CHARACTER_SPEC.md`, then approves or revises the appearance. **Stop at LW-02A and request that approval before starting LW-02B.**

## Historical LW-01 handover (2026-10-13; superseded above)

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
