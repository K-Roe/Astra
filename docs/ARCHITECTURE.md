# Project ASTRA architecture

## LW-03 UI and world correction (2026-10-15)

Chat history still lives only in the running `ChatService`. Its `ChatStatus` now reports `memoryAvailable` and the active count from a successful read of the persistent Personal Memory service; the renderer labels conversation history and personal memory separately. `MemoryCommands` answers questions about Astra's own memory persistence from that service before model generation or research retrieval. The V2 selector stores only the preview asset id in renderer local storage, while V1 remains the fresh-profile default. Changing rigs is disabled during coding or learning work. The chair's side approach and negative-Z seated facing share `HOME_ROOM` with the visible chair and monitor. `homeCamera.ts` provides the closer default companion view plus follow, close, full-home, desk front, desk side and overhead views; the existing capped Three.js viewport remains the sole renderer.

## Personal Memory V1 extension (2026-10-14, complete within verified limits)

`src/main/memory/personalMemory.ts` owns personal memory in the **existing** intelligence database; there is no second store. Migration 3 extends `memory` (`subject`, `status`, `origin`, `sensitivity`, `conversation_ref`, `forgotten_at`, `superseded_reason`) and adds `memory_events` and `settings`. `MemoryStore` remains the Intelligence V1 primitive; the personal service adds lifecycle, provenance, superseding, a bounded context block and a revision counter that invalidates caches on every write.

`src/main/memory/memoryIntents.ts` is a pure parser for Karl's own sentences. `MemoryCommands` validates and executes them and builds replies from real rows; the language model is never asked for a database command. `ChatService` receives a narrow `MemoryChatPort` (handle / contextFor / summary / suggestionsEnabled / conversationRef) — it cannot reach the database, the research store or anything privileged — and runs memory handling **before** the coding tools and before Ollama.

Injection path: `PersonalMemoryService.contextBlock(query)` returns keyword-relevant memories first, then recent ones, truncated to `MEMORY_CONTEXT_BUDGET`. `memoryPromptBlock` renders them as a section labelled *Personal memory: things Karl told Astra directly*, kept separate from *Retrieved source passages (UNTRUSTED DATA)* so research content can never be presented as something Karl said. Startup: `IntelligenceService.loadPersonalMemory()` runs once in main before the window opens and records `memory.loaded` in the audit log. Renderer access is the existing guarded IPC; the Personal Memory panel in the Learning workspace and the chat suggestion chip are the only new surfaces. Full detail and evidence in `docs/PERSONAL_MEMORY_V1.md`.

**LW-03 presentation extension, 2026-10-14 (PARTIAL).** `src/shared/homeLayout.ts` defines one connected, obstacle-checked home graph; `scene.ts` renders matching living, desk, kitchen and bedroom zones with one character anchor. `worldActivity.ts` maps real CA-01 task phases and the Learning fetch promise to a read-only activity enum. `App` passes it to `AvatarPanel`/`LivingWorldViewport`; `CharacterController` schedules one rig's movement and animation. No activity event flows back to approval, tools or learning. The existing sandboxed asset IPC names only bundled V1/V2 GLBs; V1 stays default, V2 remains a review preview. `homeCamera.ts` supplies overview/follow/desk/sofa framing. The renderer's 30 fps cap, hidden/reduced-motion pause, manual pause and fallback remain in place. See `docs/LW_03.md` for state and evidence; native behaviour and performance acceptance ran on 2026-10-14 and passed, while visual acceptance by Karl is still pending.

**CA-01 coding orchestration, 2026-10-14.** `ChatService` routes coding intent through `CodingBridge`; `CodingAgent` in Electron main is the single task engine for chat and Coding. `codingModel.ts` requests bounded JSON from local Qwen and validates listed files and exact patch hunks. Plans bind repository, patch, scaffold, branch and command arrays to explicit approval; a failed check permits one same-scope correction with fresh approval, reusing the task branch. `TaskStore` persists state; unfinished tasks require confirmation and fresh approval. `commandRunner.ts` remains shell-free, launching Windows npm through Node's installed CLI, with installation denied. The renderer gets snapshots and narrow IPC methods, not Node. Detailed flow and PARTIAL limits: `docs/CA_01.md`.

The original LW-01 snapshot below describes the early Electron desktop shell, session-only Ollama conversation and procedural 3D viewport. Intelligence V1 subsequently added persistent memory, repository tools and approved website learning; CA-01 connects its coding tools to chat. Voice remains planned.

## Boundaries and data flow

```text
React renderer (chat UI, no direct Node/network access)
    |-- AvatarPanel -> lazy local LivingWorldViewport -> procedural Three.js scene
    |                  <- typed presentation state from chat phase (no service access)
    |-- Conversation panel <- session messages, safe text/code formatter
    | typed app-info, status, send and clear requests via bundled sandboxed preload
Electron main (window lifecycle, sender-validated IPC and permissions)
    |-- ChatService -> fixed 127.0.0.1:11434 Ollama -> approved Gemma digest outside repo (M1)
    |-- future memory service -> SQLite outside repo -> export/restore (M2)
    |-- future tool permission service -> scoped Windows/workspace adapters (M3)
    `-- future voice service -> offline recognition/synthesis adapters (M4)
```

Electron main owns OS access and process lifecycle. It loads `dist/renderer/index.html` through `file://`, denies permission requests/checks, navigation, new windows and webviews, and quits when the last window closes. The BrowserWindow enables context isolation, sandbox and web security while disabling Node integration. The renderer's CSP denies network connections and permits local scripts/styles. The preload exposes only `getAppInfo()`, `getChatStatus()`, `sendMessage(content)` and `clearConversation()` through `contextBridge`; main checks that every IPC request came from its primary frame. There is no filesystem or command IPC. The M1 Windows run verified the live UI and bridge restrictions; this is not a full security audit.

`ChatService` keeps user and assistant turns in main-process memory. On each send it verifies the installed `gemma3:4b` tag and llama.cpp default, sends the authored personality plus current-session turns to the fixed loopback Ollama endpoint at 4,096 context, then verifies the loaded runtime digest before accepting the reply. It accepts one generation at a time; clear aborts the active request and invalidates stale results. Missing service/model and changed identity return user-visible errors without fallback. There is no cloud API, transcript file or telemetry. A restarted process begins with empty history. Ollama may truncate older turns once they exceed the model's context window; long-session context behavior has not yet been measured.

The Living Companion renderer uses a two-panel layout that stacks at compact window widths. `src/renderer/presentationState.ts` maps connecting/ready to idle, generating to thinking, and chat failures to error. Listening and speaking exist only in the type contract and cannot be reached from today's chat flow. `AvatarPanel` owns visual status and the LW-01 viewport boundary; it does not import `ChatService`, call Ollama or receive conversation text. The conversation panel keeps the existing narrow bridge, formats fenced code as escaped text, and follows new messages only while the user is near the bottom. Disabled microphone and audio buttons reserve layout space without requesting permissions.

`src/renderer/world/scene.ts` constructs a local procedural room and full-body articulated mannequin, then exposes only `updateIdle` and `dispose`. `LivingWorldViewport.tsx` owns the WebGL renderer, canvas, resize/visibility observers and manual pause. LW-02A uses a pure camera-framing function for desktop/compact dimensions and restrained camera interpolation on resize. Visible idle motion is paced by `requestAnimationFrame` with a 30 fps render cap; manual pause, hidden/minimized/offscreen state and reduced-motion preference cancel the frame loop. Resize can still draw one frame to keep the picture sized correctly. A bounded renderer-local diagnostic buffer stores frame interval, render CPU wall time, draw calls and triangles, without conversation content or IPC. The viewport is lazy loaded from the local Vite build and receives no chat text, Ollama reference, Node API, IPC or remote asset URL. A WebGL failure shows a text fallback while chat stays usable. The mannequin is temporary geometry, not the approved final appearance or a reusable rig. No room interaction, world simulation or AI-driven animation exists yet.

LW-02A's Blender script and five reviewed renders specified an initial appearance direction. `LW02A_CHARACTER_SPEC.md` and the superseded `LW02B_CHARACTER_SPEC.md` record that history. **LW-02B-R1 is the current design**: `LW02B_R1_CHARACTER_SPEC.md` documents a 1.70 m figure whose head is a **single sculpted mesh** produced by displacing a shared skull landmark table with eye sockets, brow ridge, nose, integrated lips, cheekbones and chin, with spherical eyeballs seated in those sockets and lids that wrap them. Ten review renders live in `docs/review/lw02b-r1/`. All of this is a **non-rigged visual design awaiting Karl's approval**; the application loads none of it and still draws the procedural mannequin. The character work runs entirely in Blender scripts under `scripts/blender/` and never touches the renderer's runtime boundaries: there is no asset loader, no remote fetch, no armature and no animation state in the application.

## Planned Living World boundaries — no service implementation in LW-02B-R1

LW-02A refines these **unimplemented** boundaries: the local conversation engine could later emit only typed high-level proposals (`walk_to_desk`, `sit`, `wave`, `read_book`) into a controller boundary. The animation controller would map validated intents to approved clips; a room controller would validate reachable target IDs, object state, collision/navigation and cancellation. The idle activity scheduler would propose low-cost actions only under approved user preferences and visibility/resource budgets. None may call OS, network or filesystem APIs directly. Effects beyond the room require a separate main-process permission contract. Model and webpage content are data, never executable authority. A future memory/journal service could record source-labelled experiences and corrections, while a feedback evaluation service measures retrieval and approved rule changes; neither changes model weights. Offline voice input/output and lip-sync would connect through a separately approved service and time-aligned animation events. Website research remains opt-in and restricted by the allowlist, redirect/DNS/local-network and content/budget protections below.

- **Character and animation:** A separately approved local asset pipeline should define versioned 3D rig, bones, facial controls, expressions and animation clips. A controller should consume typed, verified presentation events and own transitions/cancellation. Listening and speaking states only become reachable when corresponding input/output is real. Provide reduced-motion and missing-asset fallback.
- **Virtual room:** A simulation service should own room entities, activity rules and time progression separately from rendering. Any activity that affects files, networks or OS state requires its own explicit permission path. Rendering a room does not imply autonomous behavior.
- **Offline voice:** Main-process adapters should isolate approved local TTS/STT engines and model files outside the repository. Microphone capture needs Karl-visible permission, activation, stop and revocation; audio output needs mute/cancel and truthful speaking state. No microphone or audio API is enabled by LW-01.
- **Memory and experience journal:** A future SQLite service should begin with an empty personal store outside Git, then offer inspect, correct, delete, export and restore. Experiences and source provenance should be explicit records with retention controls, not implicit changes to model weights. A response must not claim cross-session recall before this exists.
- **Approved-website research:** A future optional main-process service requires Karl's explicit approval for each domain/scope and must remain disabled by default. Allowlist canonical HTTPS domains and read-only methods; reject arbitrary URLs, credentials in URLs, nonapproved ports, private/loopback/link-local/metadata addresses and local files. Resolve DNS before connecting and after redirects, revalidate every redirect target and address, and prevent rebinding or proxy bypass. Treat pages as untrusted data: no page text can issue tool instructions, change permissions or become a system prompt. Bound redirects, response bytes, content types, request count, time, rate and total session budget; expose source/consent and local cache/retention controls. These are design requirements, not a web capability today.
- **Learning evaluation:** Define measurable task suites for recall accuracy, correction fidelity, conversation quality and coding reliability before adaptation. Separate persistent knowledge retrieval and approved behavioral rule changes from neural-network fine-tuning. Fine-tuning needs separately approved data rights, compute budget, held-out evaluation and rollback.

## Intelligence V1 architecture (implemented, 2026-10-13)

`docs/INTELLIGENCE_V1.md` is the full manual. In summary, the renderer gained **no** new privileges: it remains sandboxed, keeps `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` and a CSP with `connect-src 'none'`, so it cannot reach the network. It gained a second typed bridge, `astraIntelligence`, with 26 channels, all validated against the primary frame.

```
renderer workspaces ─▶ preload ─▶ IntelligenceService ─▶ KnowledgeStore / MemoryStore
                                             ├──────────▶ ApprovalManager / TaskStore
                                             ├──────────▶ reader.ts   (only internet access)
                                             ├──────────▶ pathGuard   (only repo path resolution)
                                             └──────────▶ commandRunner (only process spawn)
```

`Intelli`IntelligenceService` composes them. The database is `astra-intelligence.db` in Electron's user-data directory, outside Git. The renderer sends **names** (source id, project root, task id), never a path it wants acted upon and never a shell string. Privileged entry points re-validate at the moment of use: `ApprovalManager.assertApproved(action, scope)` runs immediately before each operation, with scope treated as a ceiling so one approval cannot authorise a different file or repository.

Three modules are the only places with a given power, and each is independently testable: `research/reader.ts` is the only code that opens a network connection, `workspace/pathGuard.ts` the only code that resolves a repository path, and `workspace/commandRunner.ts` the only code that spawns a process. The command runner uses no shell, allowlists both executables and package scripts, always refuses `npm install`, and kills the process tree on timeout. Retrieved web content is data: `MemoryStore.remember` throws for web-origin statements and passages are fenced and labelled as untrusted before the payload reaches the model.

On startup every unfinished coding task is marked as needing confirmation, so a restart restores context but never resumes executable work. Model routing refuses to delegate coding work until a benchmark measures reliability at or above 0.6; conversation always stays on Gemma `gemma3:4b`.

## Memory and portability

The initial personal-memory store is empty. Personality text is versioned application configuration; it is not seeded biography or conversation history. Conversation persistence and personal memory must be explicit, inspectable concepts, with correction and deletion paths in M2. Use SQLite schema versioning and integrity checks. Store the live database, backups, and any user-content logs outside Git; proposed per-user location is `%LOCALAPPDATA%\Astra`, subject to M2 validation. An export must be restorable into a separate profile without replacing the source. Define conflict handling, encryption and user-visible backup location before M2 implementation. Never delete or overwrite a profile as a repair shortcut.

## Trust and privacy

User input, retrieved files, model responses and future tool output are untrusted data. Only the user-facing permission flow can authorize actions; prompt content cannot. A tool request must specify operation, target, scope and lifetime. The backend validates scope before execution and records outcome without exposing secrets. Network access is not required for normal operation after prerequisites are installed. Any later optional network feature must be separately reviewed, disclosed and disabled by default unless Karl approves otherwise.

## Source layout

```text
src/main/       Electron main, window options, IPC handler and ChatService
src/preload/    sandbox-compatible bundled context bridge
src/renderer/   React chat UI, AvatarPanel, local world viewport/scene, presentation state and CSP
src/shared/     typed IPC contracts and safe message-block parser
tests/          foundation, chat-service and formatting checks
scripts/        benchmark and Windows live-chat/resize/shutdown verification
docs/           decisions, state and continuity
```

Vite builds the renderer; TypeScript emits main/shared code; esbuild bundles preload because Electron's sandboxed preload cannot require arbitrary sibling modules. `npm run dev` builds and launches local files without a development server. M1 Phase 3 verified live Windows chat, reset and clean shutdown. There is no installer yet; disconnected-network operation, packaging, sustained context behavior and SQLite concurrency remain later design/testing work.
