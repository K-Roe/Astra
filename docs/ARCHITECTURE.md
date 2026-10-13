# Project ASTRA architecture

The Electron desktop shell, session-only Ollama conversation and LW-01 procedural 3D viewport are implemented. Persistent memory, tools, voice and website research remain planned; they do not exist yet.

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

`src/renderer/world/scene.ts` constructs a local procedural room and full-body articulated mannequin with a fixed camera, then exposes only `updateIdle` and `dispose`. `LivingWorldViewport.tsx` owns the WebGL renderer, canvas, resize/visibility observers and manual pause. A timer targets 12 rendered frames per second for idle motion; manual pause, hidden/minimized/offscreen state and reduced-motion preference stop the timer. Resize can still draw one frame to keep the picture sized correctly. The viewport is lazy loaded from the local Vite build and receives no chat text, Ollama reference, Node API, IPC or remote asset URL. A WebGL failure shows a text fallback while chat stays usable. The mannequin is temporary geometry, not the approved final appearance or a reusable rig. No room interaction, world simulation or AI-driven animation exists yet.

## Planned Living World boundaries — no implementation in LW-01

- **Character and animation:** A separately approved local asset pipeline should define versioned 3D rig, bones, facial controls, expressions and animation clips. A controller should consume typed, verified presentation events and own transitions/cancellation. Listening and speaking states only become reachable when corresponding input/output is real. Provide reduced-motion and missing-asset fallback.
- **Virtual room:** A simulation service should own room entities, activity rules and time progression separately from rendering. Any activity that affects files, networks or OS state requires its own explicit permission path. Rendering a room does not imply autonomous behavior.
- **Offline voice:** Main-process adapters should isolate approved local TTS/STT engines and model files outside the repository. Microphone capture needs Karl-visible permission, activation, stop and revocation; audio output needs mute/cancel and truthful speaking state. No microphone or audio API is enabled by LW-01.
- **Memory and experience journal:** A future SQLite service should begin with an empty personal store outside Git, then offer inspect, correct, delete, export and restore. Experiences and source provenance should be explicit records with retention controls, not implicit changes to model weights. A response must not claim cross-session recall before this exists.
- **Approved-website research:** A future optional main-process service requires Karl's explicit approval for each domain/scope and must remain disabled by default. Allowlist canonical HTTPS domains and read-only methods; reject arbitrary URLs, credentials in URLs, nonapproved ports, private/loopback/link-local/metadata addresses and local files. Resolve DNS before connecting and after redirects, revalidate every redirect target and address, and prevent rebinding or proxy bypass. Treat pages as untrusted data: no page text can issue tool instructions, change permissions or become a system prompt. Bound redirects, response bytes, content types, request count, time, rate and total session budget; expose source/consent and local cache/retention controls. These are design requirements, not a web capability today.
- **Learning evaluation:** Define measurable task suites for recall accuracy, correction fidelity, conversation quality and coding reliability before adaptation. Separate persistent knowledge retrieval and approved behavioral rule changes from neural-network fine-tuning. Fine-tuning needs separately approved data rights, compute budget, held-out evaluation and rollback.

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
