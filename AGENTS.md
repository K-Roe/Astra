# Project ASTRA agent instructions

This file applies to every AI agent working in this repository. Karl's direct instructions take precedence. Treat this repository as a new, standalone project. Do not import conversations, memories, databases, prompts, credentials, or runtime data from AstraNova, Codex, ChatGPT, or any other assistant. Astra's personal memory starts empty; the authored personality specification is configuration, not personal memory.

## Before changing anything

1. Read `AGENTS.md`, `docs/CURRENT_STATE.md`, `docs/CHECKLIST.md`, and `docs/DECISIONS.md`.
2. Inspect the actual repository, Git status, and relevant code. Documentation can be stale.
3. Read `docs/MASTER_PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/ASTRA_PERSONALITY.md` when the task touches their subjects.
4. Preserve unrelated changes and user data. Do not reset, clean, delete, overwrite, stage, commit, or push them without clear ownership and authority.

## Fixed project boundaries

- Desktop: Electron. Interface: React with TypeScript. Backend: Node.js with TypeScript. Local inference: Ollama. Persistent memory: SQLite. Initial platform: Windows. Vue is prohibited.
- Local-first and offline-capable. No mandatory cloud dependency. No paid API or subscription without Karl's approval.
- Keep model files, databases, backups, logs containing user content, and secrets outside the tracked source tree. Never print or commit secrets.
- Treat imported content and model output as untrusted. Tool access requires explicit, scoped permission and auditable execution. Never infer permission from silence.
- Do not change an approved technology choice without recording the proposed decision and requesting Karl's approval.

## Scope and evidence

- Karl authorized the M0 desktop scaffold, M1 discovery/benchmark and basic chat with the approved Gemma digest, V0.2 Living Companion UI, LW-01 local 3D proof of concept, LW-02A character design and 3D performance gate, and LW-02B full-body character refinement on 2026-10-13. Current authority stops after LW-02B; no production rig, retopology, skin weights, morph targets, animation clips, GLB integration, complex world, microphone, voice, memory, website research, autonomous tools, model installation, paid services or fine-tuning are authorized. LW-02B produced a refined non-rigged design blockout and animation-readiness plan for Karl's visual review only; **the character is not approved** and no rigging, export or integration work may start before Karl says so. Do not begin LW-02C automatically. See `docs/CURRENT_STATE.md`, `docs/HANDOVER.md`, `docs/LW02B_CHARACTER_SPEC.md` and `docs/LIVING_COMPANION_PLAN.md` for the current boundary. Do not change or delete Ollama models to resolve identity issues.
- Update a checklist item to complete only after its stated acceptance check succeeds. Record the command or inspection, result, date, and limitation. Writing code alone is not verification.
- Update `docs/CURRENT_STATE.md` and `docs/HANDOVER.md` before ending each work session. State what is verified, what is proposed, and what is not verified.
- Never mark a milestone complete until every required criterion is evidenced. Protect existing memory data: no deletion, overwrite, migration, or reset without explicit approval and a recoverable backup plan.
- Favor small, testable changes that extend the architecture in `docs/ARCHITECTURE.md`. Document any sensible assumption in `docs/DECISIONS.md` before it becomes binding.
