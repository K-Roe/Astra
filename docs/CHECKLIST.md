# Project ASTRA checklist

Status meanings: `[x]` verified by the stated check; `[ ]` pending. A checked design requirement means the requirement is documented, not that runtime behavior exists. Record new evidence beside each item before changing its status.

## M0 repository and documentation

- [x] Separate repository initialized at `C:\Users\karlr\repos\Astra`. Check: `git rev-parse --show-toplevel` returned that path on 2026-10-13.
- [x] Eight required documents exist. Check: file existence and nonempty content validation on 2026-10-13; see `CURRENT_STATE.md`.
- [x] Approved stack and prohibited alternatives recorded. Check: `MASTER_PLAN.md`, `ARCHITECTURE.md`, and `DECISIONS.md` reviewed on 2026-10-13.
- [x] Offline operation and memory portability specified. Check: `MASTER_PLAN.md` and `ARCHITECTURE.md` reviewed on 2026-10-13. Runtime behavior not verified.
- [x] Checklist has objective completion conditions and evidence fields. Check: each pending milestone below has an explicit check; reviewed on 2026-10-13.
- [x] Replacement agent can identify state and next task from repository. Check: `AGENTS.md`, `CURRENT_STATE.md`, `HANDOVER.md` cross-checked on 2026-10-13.
- [x] Runtime data exclusions recorded. Check: `.gitignore` reviewed on 2026-10-13. No runtime data has been created.
- [x] Desktop scaffold implemented after explicit approval. Check: Electron main/preload, React renderer and shared TypeScript contract inspected; `npm run build` passed on 2026-10-13.
- [x] Desktop scaffold tests run. Check: `npm test` passed 2/2; `npm run verify:desktop` opened and closed the Windows window with exit code 0 on 2026-10-13. Screenshot inspected; see `CURRENT_STATE.md`.
- [x] M0 accepted against its documented criteria. Check: all M0 items above complete; Windows handle, rendered screen, local file URL and clean shutdown verified; docs reconciled; Karl explicitly approved Phase 2 on 2026-10-13. No M1 functionality implied.

## M1 local chat

- [x] M1 Phase 1 local discovery. Check: `ollama --version`, `ollama list`, local `/api/version`, `/api/tags`, `/api/ps`, `/api/show`, and `nvidia-smi` inspected on 2026-10-13; see `M1_BENCHMARK_PHASE1.md`.
- [x] Sequential preliminary comparison of existing `gemma3:4b` and `qwen2.5-coder:7b`. Check: five identical prompts/settings per model plus a 512-token reasoning retest; local timing/resource JSON and reviewed outputs recorded on 2026-10-13. Gemma tag changed during testing, so this does not settle model selection.
- [x] Investigate duplicate Gemma identities without manually changing models. Check: `ollama list`, `/api/tags`, `/api/show`, `/api/ps`, local manifest list and Ollama server log establish GGML and llama.cpp migration variants; the default and Phase 2 runtime digest are `c30276f7…`; manifest-list SHA-256 unchanged across Phase 2; see `M1_BENCHMARK_PHASE1.md` Phase 2 section (2026-10-13).
- [x] Controlled Phase 2 comparison of existing models. Check: digest-pinned, sequential six-request runs with identical 4K/512-token settings, TypeScript strict coding gate, three-turn conversation, unknown personal information, exact JSON, timing/CPU/RAM/GPU samples and clean stop; results and failed coding checks recorded in `M1_BENCHMARK_PHASE1.md` (2026-10-13).
- [ ] Benchmark candidate coding and general models on target hardware. Check: reproducible prompts, versions/quantizations, output quality, tokens/second, first-token latency, RAM/VRAM and offline behavior recorded.
- [ ] Verify disconnected-network inference and longer-context/sustained behavior before full M1 acceptance. Check: approved local service run without network connectivity, with 4K and larger context telemetry and reliable shutdown; no model modification. The current Phase 2 comparison does not prove these conditions.
- [x] Select and integrate an initial model after Karl's approval. Check: Karl approved `gemma3:4b` digest `c30276f7…` for Phase 3; runtime `/api/ps` confirmed exact digest and 4,096 context before coding; Windows `npm run verify:desktop` completed live chat on 2026-10-13; unavailable-service and changed-digest service tests passed; renderer CSP still blocks network and main uses fixed loopback only. Disconnected-network acceptance remains separate.
- [x] Ollama integration and model availability/error states. Check: main-process service and narrow IPC inspected; `npm test` passed unavailable-service, changed-digest, invalid-input and session-reset cases; live Windows chat and clean shutdown passed on 2026-10-13. Unavailable-service behavior was tested with an injected failed local request, not by stopping the live Ollama service.
- [x] Session-only personality and basic chat behavior. Check: authored `ASTRA_PERSONALITY.md` loaded into system message; `npm test` passed personality, multi-turn context, reset and fresh-instance-empty checks; live Windows three-turn chat acknowledged no memory after close and reset to zero messages on 2026-10-13. This does not satisfy disconnected-network M1 acceptance.
- [ ] Full M1 offline conversation acceptance. Check: run the actual Windows app while external network connectivity is disabled, confirm local response and no cloud dependency, then restore network and record exact procedure/results. Current tests used loopback with ordinary network connectivity.

## V0.2 Living Companion

- [x] Phase 01 character-first desktop and compact layouts. Check: `npm run verify:desktop` opened native Windows app, inspected side-by-side and stacked layouts after actual native resize to 700×560 and 640×480, checked no horizontal overflow or clipped composer/disabled voice controls, and captured/visually inspected `test-results/astra-living-desktop.png` and `test-results/astra-living-compact.png` on 2026-10-13.
- [x] Temporary avatar boundary and honest presentation state. Check: `AvatarPanel` is renderer-only, placeholder visibly labelled; live verifier observed `thinking` during Ollama generation and `idle` when ready; listening/speaking remain unreachable and microphone/audio buttons disabled. Source review confirmed no artwork download or animation engine (2026-10-13).
- [x] Preserve local chat, scroll behavior and safe formatting. Check: `npm test` passed 9/9 including local model, context, reset, digest/security and code-block parser checks; native verifier passed four-turn Gemma conversation, held scroll position while user scrolled up, jumped to latest, cleared session and exited cleanly (2026-10-13).
- [x] Living Companion implementation plan. Check: `LIVING_COMPANION_PLAN.md` records distinct approval-gated stages and acceptance conditions for artwork/rig, animation controller, offline speech output, offline recognition, and lip-sync/expressions; none is marked implemented beyond Phase 01 (2026-10-13).
- [ ] Phase 02 final avatar artwork and rig. Check: Karl approves artwork and asset rights/source, layered rig exports render correctly at desktop and compact sizes, and local fallback works. No generation/download authorized in Phase 01.
- [ ] Phase 03 animation state controller. Check: approved rig transitions, cancellation, reduced-motion path and target-hardware performance verified; listening/speaking only after corresponding voice capabilities exist.
- [ ] Phase 04 offline speech output. Check: approved local TTS works disconnected with stop/mute/error behavior and measured latency.
- [ ] Phase 05 offline speech recognition. Check: approved local STT works disconnected with explicit microphone permission, denial/revocation and correction flow.
- [ ] Phase 06 lip-sync and expressions. Check: inspected synchronization to actual audio timing, neutral fallback, cancellation and performance evidence.

## LW-01 Living World proof of concept

- [x] Compare React Three Fiber with direct Three.js and record a scoped choice. Check: ADR-013 reviews both against this single noninteractive viewport and selects direct Three.js; official library documentation reviewed 2026-10-13.
- [x] Local 3D room, camera and labelled full-body mannequin in the existing avatar area. Check: native Windows screenshots `test-results/astra-lw01-desktop.png` and `astra-lw01-compact.png` captured and visually inspected on 2026-10-13; scene is procedural in `src/renderer/world/scene.ts` with no remote assets.
- [x] Idle movement, capped rendering, manual/visibility pause and resize. Check: joint-update code inspected; `npm run verify:desktop` observed successive rendered frames, an idle FPS cap, zero new frames after manual pause and actual Windows minimize, resumption after restore, drawable canvas and compact native resize at 700×560 and 640×480 (2026-10-13). Reduced-motion logic is implemented but no OS-setting acceptance test was run. A later rerun could not start visible-frame measurement because Chromium reported the Win32-visible window as hidden while another window held foreground; see `CURRENT_STATE.md`.
- [x] Preserve local Gemma conversation and desktop security. Check: `npm test` passed 9/9 and native verifier passed four-turn local chat, session context, reset, restricted bridge/CSP, no renderer errors and exit code 0 (2026-10-13). No main/preload/ChatService change.
- [x] Measure target-machine responsiveness with Gemma. Check: ignored `test-results/astra-lw01-performance.json` records 12 fps target, observed frame counts/FPS, whole-GPU `nvidia-smi`, system CPU/free RAM and Electron process-tree working set during idle and first chat; frame count advanced during the response. Samples are brief and cannot attribute GPU memory to the viewport.
- [x] Document future service boundaries without implementing them. Check: `ARCHITECTURE.md` and ADR-014 cover character/animation, room simulation, offline voice, empty SQLite memory/journal, approved-site research protections and measurable learning; fine-tuning is separate and unapproved.
- [ ] Full Living World character/world acceptance. Check: Karl approves final 3D design and rig, interaction/animation requirements and sustained performance tests in separately scoped milestones. LW-01 proves only a temporary procedural scene.

## M2 memory

- [ ] SQLite profile created empty outside source tree. Check: fresh-profile query returns zero personal records.
- [ ] Recall, correction and deletion. Check: each operation tested across restart, including ambiguous correction and missing-record cases.
- [ ] Portable backup and restore. Check: export and restore into another clean profile; integrity and schema/version checks; original profile unchanged.

## M3 coding and permissions

- [ ] Scoped workspace reading and coding assistance. Check: authorized in-scope access works; out-of-scope access denied.
- [ ] Permission-controlled actions and audit. Check: deny by default, explicit target and action, approval/revocation, prompt-injection resistance, and recorded outcome.

## M4 voice

- [ ] Offline recognition and synthesis. Check: disconnected microphone-to-reply flow, visible mute/permission state, target-hardware latency review.

## M5 learning

- [ ] Local journal and feedback controls. Check: inspect, correct, export and delete journal entries with persistence tests.
- [ ] Fine-tuning feasibility research. Check: measured costs, risks, dataset consent and rollback plan; no training without separate approval.
