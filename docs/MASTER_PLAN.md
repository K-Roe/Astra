# Project ASTRA master plan

## Goal and constraints

Build a standalone Windows AI companion named Astra with a predefined personality, local coding-capable inference, portable personal memory, voice interaction, and permission-controlled computer tools. The default operating path must work without network access after required local software and models are installed. No existing assistant history or memory is seeded into Astra.

Approved stack: Electron, React + TypeScript, Node.js + TypeScript, Ollama, SQLite, Windows first. Vue is prohibited. Paid APIs and subscriptions require Karl's prior approval. Target hardware is Ryzen 5 5500, RTX 3050 8 GB VRAM, 16 GB RAM, NVMe SSD. Candidate models are a quantized Qwen2.5-Coder 7B and a smaller general-purpose model; selection requires a measured benchmark.

## Scope by milestone

| Milestone | Intended result | Completion evidence |
| --- | --- | --- |
| M0 Foundation | Independent repository, required documentation, later desktop scaffold and tests | Documentation consistency review; scaffold/build/test evidence when separately authorized; offline and memory-portability requirements captured. |
| M1 Local conversation | Ollama discovery, local model selection, personality, basic chat | Offline conversation on target hardware; startup/error handling; benchmark with latency, quality, RAM/VRAM and reproducible prompts. |
| M2 Memory | Explicitly controlled SQLite memory, recall, correction, deletion, backup and restore | Fresh profile has zero personal records; persistence/retrieval tests; correction and deletion tests; restore tested from an export into a separate profile. |
| M3 Coding and tools | Coding assistance with scoped workspace access and permission-controlled actions | Deny-by-default permission tests, visible operation/target, audit record, revocation and prompt-injection tests. |
| M4 Voice | Offline speech recognition and synthesis | Works disconnected on target hardware; microphone permission and mute control; latency and intelligibility checks. |
| M5 Learning | Local learning journal, feedback evaluation and optional fine-tuning research | User-visible journal controls; export/delete verification; measured evaluation; fine-tuning remains research until separately approved. |

## M0 sequence and acceptance

1. **Documentation and repository foundation (completed):** Create the eight required documents; initialize a separate repository; protect runtime data through ignore rules; review internal consistency. Results are in `CHECKLIST.md` and `CURRENT_STATE.md`.
2. **Desktop scaffold and tests (approved and completed on 2026-10-13):** Add Electron main/preload and React renderer with TypeScript, a narrow typed IPC boundary, package scripts and meaningful startup/build tests. Windows launch and shutdown evidence is in `CURRENT_STATE.md`.

M0 can be marked complete only when all eight documents exist and agree, the Electron/React/TypeScript layout is documented and implemented, offline operation and memory portability are explicit requirements, checklist items have objective checks, a new agent can resume from repository files, and no functionality is claimed without verification. Documentation completion alone does not complete M0.

## Authorization and remaining scope

No models, model downloads, memory database, voice stack, computer control, cloud integrations, paid services, or M1 work were included in M0. Karl subsequently approved M1 discovery/benchmarking, then approved the existing Gemma digest for M1 Phase 3 basic-chat integration on 2026-10-13. That approval does not extend to model downloads, persistent memory, voice, tools, cloud services or further M1 expansion. Full M1 acceptance still requires disconnected-network conversation and remaining checklist evidence.

Karl separately approved V0.2 Phase 01 Living Companion UI structure and avatar preparation on 2026-10-13. This keeps the working Gemma chat and security boundary while adding only a temporary, clearly labelled character placeholder and responsive conversation layout. The later artwork, animation and voice sequence is in `LIVING_COMPANION_PLAN.md`; that plan is not implementation authority for future stages.
