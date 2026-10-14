# Project ASTRA master plan

## Goal and constraints

**CA-01 continuation, 2026-10-14: COMPLETE.** The approved chat-to-code path and verification record are in `docs/CA_01.md`. Live failed-test correction, cancellation, restart recovery, scaffold structure and native malformed-model fail-closed behavior passed acceptance. A scaffold build requires separately approved dependency installation. Dependency installation remains separately gated; do not start CA-02 automatically.

Build a standalone Windows AI companion named Astra with a predefined personality, local coding-capable inference, portable personal memory, voice interaction, and permission-controlled computer tools. The default operating path must work without network access after required local software and models are installed. No existing assistant history or memory is seeded into Astra.

Approved stack: Electron, React + TypeScript, Node.js + TypeScript, Ollama, SQLite, Windows first. Vue is prohibited. Paid APIs and subscriptions require Karl's prior approval. Target hardware is Ryzen 5 5500, RTX 3050 8 GB VRAM, 16 GB RAM, NVMe SSD. Candidate models are a quantized Qwen2.5-Coder 7B and a smaller general-purpose model; selection requires a measured benchmark.

## Intelligence V1 and the M2/M3/M5 overlap

Karl approved **Intelligence V1** on 2026-10-13. It deliberately lands on top of several planned milestones at once, so the roadmap should be read as merged rather than sequential:

- **M2 Memory** is substantially delivered: persistent SQLite memory with provenance, explicit corrections, forget and purge, a fresh profile that starts empty, and inspectable controls in the Learning workspace. Still outstanding: export/restore into a separate profile, and encryption of the database at rest.
- **M3 Coding and tools** is substantially delivered: repository discovery, scoped read/write/patch, Git status, diff and branch creation, a controlled command runner, deny-by-default approvals with scope binding, an audit trail, and prompt-injection tests. Still outstanding: a UI that drives the full edit→test→diff loop, and any decision about permitting dependency installation.
- **M5 Learning** is partially delivered: the *journal* and *evaluation* ideas are implemented as a local knowledge base with FTS5 retrieval, and evaluation exists as the coding benchmark. **Fine-tuning remains research and is not authorized.**
- **M1 offline acceptance** is still formally open; retrieval-based knowledge works offline, but the original disconnected-network chat acceptance has not been re-run since the model and application changed.

Architecture and evidence: `docs/INTELLIGENCE_V1.md`, `docs/CURRENT_STATE.md`, `docs/CHECKLIST.md`.

## Scope by milestone

| Milestone | Intended result | Completion evidence |
| --- | --- | --- |
| M0 Foundation | Independent repository, required documentation, later desktop scaffold and tests | Documentation consistency review; scaffold/build/test evidence when separately authorized; offline and memory-portability requirements captured. |
| M1 Local conversation | Ollama discovery, local model selection, personality, basic chat | Offline conversation on target hardware; startup/error handling; benchmark with latency, quality, RAM/VRAM and reproducible prompts. |
| LW Living World | A local full-body 3D companion in a room, developed in approval-gated stages | LW-01: procedural scene, temporary articulated mannequin, idle/pause/resize, live Gemma concurrency and Windows screenshots; LW-02A: measured idle/generating/finished performance and camera framing; LW-02B: a refined 1.70 m, 5.76-head non-rigged design blockout with seven review renders, an LW-02A/LW-02B comparison, and a proposed skeleton/facial-control/GLB-export plan; later production rig, GLB integration and simulation require separate criteria and approval. |
| M2 Memory | Explicitly controlled SQLite memory, recall, correction, deletion, backup and restore | Fresh profile has zero personal records; persistence/retrieval tests; correction and deletion tests; restore tested from an export into a separate profile. |
| M3 Coding and tools | Coding assistance with scoped workspace access and permission-controlled actions | Deny-by-default permission tests, visible operation/target, audit record, revocation and prompt-injection tests. |
| M4 Voice | Offline speech recognition and synthesis | Works disconnected on target hardware; microphone permission and mute control; latency and intelligibility checks. |
| M5 Learning | Local learning journal, feedback evaluation and optional fine-tuning research | User-visible journal controls; export/delete verification; measured evaluation; fine-tuning remains research until separately approved. |

## M0 sequence and acceptance

1. **Documentation and repository foundation (completed):** Create the eight required documents; initialize a separate repository; protect runtime data through ignore rules; review internal consistency. Results are in `CHECKLIST.md` and `CURRENT_STATE.md`.
2. **Desktop scaffold and tests (approved and completed on 2026-10-13):** Add Electron main/preload and React renderer with TypeScript, a narrow typed IPC boundary, package scripts and meaningful startup/build tests. Windows launch and shutdown evidence is in `CURRENT_STATE.md`.

M0 can be marked complete only when all eight documents exist and agree, the Electron/React/TypeScript layout is documented and implemented, offline operation and memory portability are explicit requirements, checklist items have objective checks, a new agent can resume from repository files, and no functionality is claimed without verification. Documentation completion alone does not complete M0.

## Authorization and remaining scope

No models, model downloads, memory database, voice stack, computer control, cloud integrations, paid services, or M1 work were included in M0. Karl subsequently approved M1 discovery/benchmarking, then approved the existing Gemma digest for M1 Phase 3 basic-chat integration on 2026-10-13, then approved LW-02C (rig, GLB and application integration), which Karl then committed and pushed himself as `75cc3de`, and finally approved **Intelligence V1** on 2026-10-13. That last approval covers persistent knowledge and memory, approved-website learning with SSRF defences, repository work confined to `C:\Users\karlr\repos`, controlled command execution, a multi-level approval system and audit logging. It does **not** extend to model downloads or changes, credential access, disabling security protections, actions outside the approved root, cloud services, voice, microphone or fine-tuning. Full M1 acceptance still requires disconnected-network conversation and remaining checklist evidence.

Karl separately approved V0.2 Phase 01 Living Companion UI structure and avatar preparation on 2026-10-13. This keeps the working Gemma chat and security boundary while adding only a temporary, clearly labelled character placeholder and responsive conversation layout. The later artwork, animation and voice sequence is in `LIVING_COMPANION_PLAN.md`; that plan is not implementation authority for future stages.

Karl subsequently approved LW-01 on 2026-10-13: evaluate a minimal local Three.js viewport, procedural test room and temporary articulated mannequin inside the avatar panel, prove pause/resize and concurrent Gemma chat, and document future service boundaries. This does not approve final character art, a complex world, voice, memory, website research, autonomous actions or fine-tuning. LW-01 evidence and limits are in `CURRENT_STATE.md` and `CHECKLIST.md`.

Karl then approved LW-02A on 2026-10-13: explain the previously measured 10.9 fps during Gemma generation, benchmark Three.js while Gemma is idle, generating and finished, improve full-body camera framing for desktop and compact layouts, prepare the full-body 3D Astra character specification, create reviewable design renders if Blender is available, define a lightweight Blender-to-glTF/GLB workflow, verify resize/pause/reduced-motion/WebGL fallback behaviour, run the Windows verification set and record the evidence.

Karl then approved LW-02B on 2026-10-13: refine the character design so it reads as the established Astra rather than a toy-like mannequin, correct proportions, face, hair, hoodie, hands and trainers, produce review renders and a comparison against LW-02A, document animation readiness and the Blender-to-GLB export plan, and confirm the working application is unaffected. LW-02B changed no application code and produced a **design awaiting Karl's approval**.

Karl then approved LW-02B-R1 on 2026-10-13: the review found the appearance still not acceptable — procedural face, protruding eyes, prominent nose, startled eyebrows, helmet hair, cylindrical arms and rigid clothing — so this milestone completed the character refinement for human acceptance. LW-02B-R1 rebuilds the face as a single sculpted mesh with seated eyes and integrated lips, rebuilds the hair as an updo with a side-swept fringe, polishes the body and clothing, adds an automated validation pass and an animation-readiness review, and produces ten review renders plus a comparison sheet. It changes no application code and produces a **design awaiting Karl's approval**. It does not authorize retopology, a production rig, skin weights, morph targets, animation clips, GLB integration, room simulation, voice, memory, website research, autonomous actions or fine-tuning. Those require Karl's visual approval and a separately approved LW-02C.
