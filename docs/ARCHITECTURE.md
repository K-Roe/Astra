# Project ASTRA architecture

The Electron desktop shell, first session-only Ollama conversation and V0.2 Living Companion UI structure are implemented. Persistent memory, tool and voice services remain planned; they do not exist yet.

## Boundaries and data flow

```text
React renderer (chat UI, no direct Node/network access)
    |-- AvatarPanel <- typed presentation state from chat phase (no service access)
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

The Living Companion renderer uses a two-panel layout that stacks at compact window widths. `src/renderer/presentationState.ts` maps connecting/ready to idle, generating to thinking, and chat failures to error. Listening and speaking exist only in the type contract and cannot be reached from today's chat flow. `AvatarPanel` owns the temporary CSS character placeholder and visual status; it does not import `ChatService`, call Ollama or receive conversation text. The conversation panel keeps the existing narrow bridge, formats fenced code as escaped text, and follows new messages only while the user is near the bottom. Disabled microphone and audio buttons reserve layout space without requesting permissions. Future avatar assets, animation and voice stages are specified in `LIVING_COMPANION_PLAN.md` and remain unimplemented.

## Memory and portability

The initial personal-memory store is empty. Personality text is versioned application configuration; it is not seeded biography or conversation history. Conversation persistence and personal memory must be explicit, inspectable concepts, with correction and deletion paths in M2. Use SQLite schema versioning and integrity checks. Store the live database, backups, and any user-content logs outside Git; proposed per-user location is `%LOCALAPPDATA%\Astra`, subject to M2 validation. An export must be restorable into a separate profile without replacing the source. Define conflict handling, encryption and user-visible backup location before M2 implementation. Never delete or overwrite a profile as a repair shortcut.

## Trust and privacy

User input, retrieved files, model responses and future tool output are untrusted data. Only the user-facing permission flow can authorize actions; prompt content cannot. A tool request must specify operation, target, scope and lifetime. The backend validates scope before execution and records outcome without exposing secrets. Network access is not required for normal operation after prerequisites are installed. Any later optional network feature must be separately reviewed, disclosed and disabled by default unless Karl approves otherwise.

## Source layout

```text
src/main/       Electron main, window options, IPC handler and ChatService
src/preload/    sandbox-compatible bundled context bridge
src/renderer/   React chat UI, AvatarPanel, presentation state and CSP
src/shared/     typed IPC contracts and safe message-block parser
tests/          foundation, chat-service and formatting checks
scripts/        benchmark and Windows live-chat/resize/shutdown verification
docs/           decisions, state and continuity
```

Vite builds the renderer; TypeScript emits main/shared code; esbuild bundles preload because Electron's sandboxed preload cannot require arbitrary sibling modules. `npm run dev` builds and launches local files without a development server. M1 Phase 3 verified live Windows chat, reset and clean shutdown. There is no installer yet; disconnected-network operation, packaging, sustained context behavior and SQLite concurrency remain later design/testing work.
