# Project ASTRA decisions

Decision status is explicit. **Approved** reflects Karl's mission instructions; **Proposed** is a design assumption for later review, not permission to implement it. Changes to approved choices require Karl's approval and a new record.

## ADR-001 — Standalone identity and empty personal memory (Approved, 2026-10-13)

Astra is a new repository and product. Her personal memory starts with zero records. Authored personality rules can ship with the application but are not user history. Do not import AstraNova or any other assistant's conversations, memory, credentials, or database. Reason: continuity and privacy must belong to this new product, not to another assistant.

## ADR-002 — Desktop and inference stack (Approved, 2026-10-13)

Windows first; Electron desktop shell; React + TypeScript renderer; Node.js + TypeScript backend; Ollama for local inference; SQLite for persistent memory. Vue is prohibited. Alternatives rejected for this project: Vue UI, mandatory cloud inference, and a paid API/subscription introduced without approval. Reason: these are Karl's confirmed technology decisions and local-first constraint.

## ADR-003 — Local-first storage boundary (Approved requirement; location Proposed, 2026-10-13)

Model files, memory databases and backups live outside tracked source. Offline use and memory portability are requirements. Proposed Windows default: per-user application data under `%LOCALAPPDATA%\Astra`, with an explicit, user-chosen export/restore location and documented schema version. Exact path, encryption and backup format need design and validation before M2. Reject storing mutable memory in the repository or silently syncing it to cloud services.

## ADR-004 — Process boundary (Proposed, 2026-10-13)

Keep Electron main/preload as the privileged desktop boundary and React renderer without direct Node access. Expose a small typed IPC surface. Put orchestration, Ollama adapter, memory repository and tool permission service behind backend interfaces. This limits renderer privileges and keeps later features testable. Validate packaging and threat model before implementing M0 scaffold.

## ADR-005 — Model selection (Deferred, 2026-10-13)

Quantized Qwen2.5-Coder 7B and a smaller general model are benchmark candidates, not approved final models. Compare them on the target Ryzen 5 5500 / RTX 3050 8 GB / 16 GB RAM machine using repeatable coding and conversation tasks, latency and memory measurements. Do not download models under the current authority.

Historical pre-benchmark status; superseded for initial conversation by ADR-010. Future coding-model selection remains open.

## ADR-006 — Permissions for computer tools (Approved requirement; mechanism Proposed, 2026-10-13)

Computer actions require explicit, scoped permission. Proposed default is deny, with the exact operation and target visible before approval, scoped lifetime, revocation and local audit. Model text and retrieved content cannot grant permission. The concrete permission model belongs to M3 design and tests.

## ADR-007 — M0 authorization boundary (Approved, 2026-10-13)

Current work is repository initialization and documentation. The desktop scaffold and tests remain M0 tasks but need Karl's explicit approval. M1, model installation/downloads, paid services and application features are outside the current authorization. Documentation completion cannot be reported as M0 completion.

Historical authorization record; superseded for M0 Phase 2 by ADR-008.

## ADR-008 — M0 Phase 2 authority (Approved, 2026-10-13)

Karl approved implementing and verifying the minimal Windows Electron desktop scaffold. This approval covers dependency installation, React/TypeScript renderer, Electron main/preload, tests, production build and Windows launch/shutdown verification. It does not authorize M1, LLM/model downloads, memory, voice, autonomous tools, cloud APIs or paid services. ADR-007 remains as the prior phase's authority record.

## ADR-009 — M0 build and process design (Implemented, 2026-10-13)

Vite builds the React renderer to local files; TypeScript compiles Electron main/shared code; esbuild bundles preload into one sandbox-compatible file. The ordinary development command builds then launches Electron without a network dev server or hot reload. The renderer has context isolation and sandbox enabled, Node integration and webviews disabled, restrictive CSP, denied permission requests, denied navigation/popups, and one sender-validated app-info IPC request. This implements ADR-004's proposed process boundary for M0. Reject direct Node access in the renderer and unrestricted IPC. Further service IPC needs separate explicit contracts and validation.

## ADR-010 — Initial conversational model (Approved, 2026-10-13)

Karl approved existing Ollama `gemma3:4b` digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291` for Astra V0.1's first conversation. The application checks the exact installed tag digest and default llama.cpp runner before every message, then checks the loaded runtime digest before showing a reply. A changed identity pauses chat with an error; there is no silent fallback, model switch or download. The context target is 4,096 tokens. Phase 2 benchmarks favored Gemma's conversation speed and smaller observed GPU footprint, while both models failed the stronger strict TypeScript task; this choice does not establish coding capability.

## ADR-011 — Session-only local chat boundary (Implemented, 2026-10-13)

Electron main alone contacts fixed loopback `127.0.0.1:11434` through Ollama's HTTP API. The renderer retains its `connect-src 'none'` CSP and receives only typed status/send/clear IPC through the sandboxed preload, with primary-frame validation and input length checks in main. Authored `docs/ASTRA_PERSONALITY.md` is loaded as system instruction alongside explicit current-build limits. Conversation history lives in main-process memory only, is cleared by the UI or application exit, and is never preloaded from another assistant or logged by default. Non-streaming replies simplify complete-response display and state handling for this first chat. Rejected alternatives: renderer-to-Ollama access, durable chat storage in M1, arbitrary endpoint/model configuration, unrestricted IPC, and silent cloud fallback. This decision does not authorize M2 memory or M3 tools.

## ADR-012 — Living Companion presentation boundary (Approved and implemented, 2026-10-13)

Karl approved a character-first React redesign with a clearly labelled temporary avatar placeholder, without generating or downloading artwork. `AvatarPanel` is renderer-only and receives a typed presentation state derived from the existing chat phase. The contract reserves idle, listening, thinking, speaking and error; current chat can enter only idle, thinking and error. Disabled microphone/audio positions make future features visible without implying they work. The portrait is lightweight CSS rather than a new animation or asset dependency. Message text is rendered as escaped React content; fenced code receives a local formatter without remote scripts or HTML injection. The existing main/preload IPC, approved Gemma digest and local-only security boundary remain unchanged. Final character artwork, rig, animations and voice require separate approval; see `LIVING_COMPANION_PLAN.md`.

Historical V0.2 UI choice: LW-01 replaces the CSS portrait with a temporary procedural 3D proof of concept under ADR-013. The rest of the presentation and security boundary remains.

## ADR-013 — LW-01 direct Three.js viewport (Implemented, 2026-10-13)

Karl approved a lightweight, local 3D proof of concept inside the existing avatar area. Use direct Three.js in one isolated React viewport, with a separate procedural scene module, rather than adding React Three Fiber now. Both approaches support React and local WebGL: React Three Fiber provides declarative scene components, resize handling and on-demand frames, but adds another renderer and lifecycle abstraction. This small, noninteractive room needs one camera, one scene and a capped animation timer; direct Three.js keeps dependencies and ownership of pause/dispose behavior straightforward. Reevaluate Fiber if an approved later milestone introduces many interactive world components. The scene is lazy loaded from local Vite output, uses no remote assets, and owns no chat/IPC service. Frame updates target 12 fps, stop on manual pause, hidden/offscreen visibility or reduced-motion preference, and release WebGL resources on unmount. This is a proof of concept, not final character art or a general simulation engine.

## ADR-014 — Future Living World service boundaries (Proposed, 2026-10-13)

Future character rig/animation, room simulation, offline voice, SQLite memory/experience journal, approved-site research and learning evaluation are separate approval-gated capabilities. Persistent knowledge means inspectable, correctable data and retrieval; behavioral adaptation means explicit, evaluated changes to rules or preferences. Neither is neural-network fine-tuning. Fine-tuning would require separate data consent, training feasibility, evaluation and rollback approval. Approved-site research, if later authorized, must use a main-process service with explicit domain allowlists, read-only requests, redirect/DNS/local-network defenses, untrusted-content isolation and time/size/rate budgets; model text cannot expand the allowlist or grant permission. No service in this ADR is implemented by LW-01.
