# ASTRA

**LW-03 preview (2026-10-14):** The existing Three.js panel now contains a connected living, work, kitchen and bedroom space, with activity-driven desk behaviour. A separate brunette V2 rig can be selected as a preview; the approved V1 remains default until Karl reviews V2 against his reference. See [LW-03 status and evidence](docs/LW_03.md). Full native behaviour and visual acceptance remain open.

A standalone, local-first Windows AI companion. Astra runs a **rigged 3D character** in a room, **learns from documentation sites Karl approves**, **remembers things including corrections**, answers **with real citations** and admits when it does not know, and can **inspect and edit repositories** under `C:\Users\karlr\repos` through approval-gated, audited tools.

**CA-01 status (2026-10-14): COMPLETE.** Astra can take a coding request in normal chat, inspect a selected local Git repository, propose a validated patch, request approval, edit, run an approved test and show a Git diff. She can also create an approved React/TypeScript scaffold and local Git repository. A disposable native chat run repaired a genuine failed test with a fresh approval for the correction. Interrupted tests require fresh approval after restart. Native malformed-model-response fault injection failed closed. Partially applied work requires manual review. Dependency installation is blocked, so the scaffold has not been built. See [CA-01 architecture and verified limits](docs/CA_01.md).

Everything runs locally with Ollama. There is no cloud dependency and no paid API.

## What it actually does

- **Lives with a real character.** Astra Character V1 is a 56-bone rig, 19,812 triangles, 11 facial morph targets and 15 animation clips, loaded from a local GLB. She walks between waypoints, sits on furniture, waves, blinks and reacts to chat. An idle scheduler keeps her gently active and can be switched off.
- **Learns from approved sources only.** Karl approves an HTTPS documentation URL; Astra fetches permitted pages, respects `robots.txt`, extracts readable text, stores it, and later answers from it with citations back to the real URLs.
- **Says when it does not know.** If nothing is stored, Astra says so instead of inventing an answer or a citation.
- **Remembers deliberately.** Memory is explicit and inspectable, with provenance and corrections. Ordinary conversation is never silently promoted to memory, and nothing scraped from the web can become a memory.
- **Works as a coding assistant.** Discovers repositories, reads and searches code, applies structured patches, shows real Git diffs and runs allowlisted commands. Every privileged action sits behind an explicit, scoped, recorded approval.

## Hard boundaries

- The renderer is sandboxed: no Node, no filesystem, no network. All privileged work happens in the Electron main process behind a typed IPC bridge.
- Only HTTPS sources Karl approved can be fetched, with SSRF, DNS-rebinding, redirect and robots defences.
- Repository work is confined to `C:\Users\karlr\repos`, and **edits are confined to the specific repository**, never a sibling project.
- **Website content and model output are data, never authority.** They cannot grant permission, trigger a command or edit a file.
- Astra never commits, pushes, installs dependencies or deletes files without separate, explicit approval.
- A coding task interrupted by a restart is recovered for review but **never resumes on its own**.
- Knowledge retrieval and memory work fully offline once indexed.

## Requirements

- Windows desktop session
- Node.js and npm (verified here with Node 24.12.0 and npm 11.16.0)
- Existing Ollama installation with `gemma3:4b` resolving to digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291`
- Optionally `qwen2.5-coder:7b` for bounded coding assistance

## Run

```powershell
npm ci
npm run dev
```

`dev` builds the TypeScript main/preload code and Vite renderer, then opens Electron. It does not run a hot-reload server; rebuild and relaunch after edits. Dependencies require a network connection for the initial install. The app loads local files; Electron main contacts only Ollama at `127.0.0.1:11434`. Start Ollama before chatting. The renderer has no direct network or filesystem access.

Conversation history stays in process memory for the running session; use **Clear conversation** to reset it. **Knowledge, memory, approvals and coding tasks persist on disk** in `%LOCALAPPDATA%\Astra\astra-intelligence.db`, which starts empty. If Ollama is unavailable or the approved model identity differs, the app shows an error and does not substitute another model.

## Workspaces

The conversation panel has four tabs: **Chat**, **Learning** (approve sources, search stored knowledge with citations, manage memory), **Projects** (repositories under the approved root) and **Coding** (tasks, approvals, audit trail).

## Coding model honesty

`qwen2.5-coder:7b` measured **0.83 (5/6)** on a short, objective benchmark — enough for small well-specified tasks, and **not** enough to claim reliable unattended software development. The result, including the case it failed, is written to `test-results/intelligence/coding-model-benchmark.json`. Coding work therefore stays bounded: approved scope, verified by running tests, and never committed or pushed without separate approval. Conversation always stays on Gemma 3 4B.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:desktop
npm run measure:world
```

`npm test` builds first, then runs **235 tests** covering the database and migrations, corruption recovery, SSRF and redirect rejection, HTML extraction, robots and crawl limits, retrieval and citation accuracy, offline retrieval, memory corrections and deletion, Windows path containment, symlink escape prevention, repository creation and editing, patch application, approval enforcement, command restrictions, Git diffs, task cancellation and recovery, prompt-injection resistance, model routing and grounding. `verify:desktop` requires a completed build, an interactive Windows session, Ollama and the approved model installed. It opens the native Electron window, checks 3D rendering and the rigged character loading and walking, idle frames, manual/minimized pause and resize, sends a synthetic four-turn Gemma conversation, checks scroll following, reset, layouts and bridge isolation, then closes the window and checks that Electron exits. It saves ignored screenshots at `test-results/astra-lw01-desktop.png` and `test-results/astra-lw01-compact.png` and resource samples at `test-results/astra-lw01-performance.json`. These are brief samples; whole-GPU readings do not isolate viewport consumption. The verifier uses a loopback Chrome DevTools port only for that test run; the normal `dev` launch does not enable remote debugging. `verify:desktop --allow-occluded` additionally runs when this session's foreground window prevents Chromium from reporting the app as visible.

`node scripts/acceptance-intelligence.mjs` runs the A–F acceptance scenarios against the real services, using throwaway repositories in a temporary directory and **never Karl's real projects**. `node scripts/benchmark-coding-model.mjs` measures the local coding model. `node scripts/live-crawl-test.mjs` performs a real internet crawl and records the retrieval result.

## Documentation

- `docs/INTELLIGENCE_V1.md` — architecture and operating manual (start here)
- `docs/CURRENT_STATE.md` — what is verified right now
- `docs/HANDOVER.md` — how to continue safely
- `docs/CHECKLIST.md` — items with their acceptance checks
- `docs/DECISIONS.md` — decision records
- `docs/LW02B_R1_CHARACTER_SPEC.md` — character design specification

`measure:world` records per-state frame intervals, renderer CPU time, draw calls and system resource samples while Gemma is idle, generating and finished, plus compact resize, minimize/restore, manual pause, reduced-motion and the WebGL fallback. Output is ignored under `test-results/lw02a/`. Add `--baseline` to capture the older 12 fps cap for comparison and `--allow-occluded` in the same situation as above.

## Character design

`docs/LW02B_R1_CHARACTER_SPEC.md` is the current character specification: sculpted-face construction, geometry and material statistics, the validation performed, the animation-readiness review and the geometry that will deform poorly. `docs/LW02B_CHARACTER_SPEC.md` and `docs/LW02A_CHARACTER_SPEC.md` are superseded and kept as history. All three are **design proposals awaiting approval**; none is a rig or a shipped asset.

Regenerate the current character, its nine review views, the room preview and the editable `.blend` with local Blender 5.2 LTS:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/blender/create_astra_character_r1.py
```

The script takes an optional output folder after `--` (default `test-results/lw02b-r1/design`), prints its own triangle/object/material counts, character dimensions and validation result, and needs no add-ons, textures or simulation.

Build a before/after comparison sheet from any two character renders:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/blender/make_astra_design_comparison.py -- <before.png> <after.png> <output_dir> [output_name] [left_caption] [right_caption]
```

Committed review images live in `docs/review/lw02a/`, `docs/review/lw02b/` and `docs/review/lw02b-r1/`. The superseded passes remain reproducible with `scripts/blender/create_astra_design_prototype.py` (LW-02A) and `scripts/blender/create_astra_character_refined.py` (LW-02B).

## Layout and continuity

- `src/main/`: Electron window, permission denial, IPC handlers, Ollama chat service, and the intelligence services (knowledge/memory/task stores, approved-source reader, repository tools, approvals, command runner).
- `src/preload/`: bundled, sandbox-compatible context bridges for chat and intelligence.
- `src/renderer/`: React Living Companion UI, the Three.js viewport, the Learning/Projects/Coding workspaces and a restrictive CSP.
- `src/shared/`: typed bridge contracts, safe message-block parser, character navigation/idle/state logic, 3D camera framing and frame-performance summary helpers.
- `src/assets/`: the local character GLB and its editable Blender source.
- `tests/` and `scripts/`: unit and acceptance tests, Windows layout/launch verification, the coding benchmark, live-crawl test and Blender character scripts.
- `docs/`: plan, decisions, verified state, handover and `INTELLIGENCE_V1.md`.

Read `AGENTS.md` and the continuity documents before changing the project. Models, personal memory, backups and secrets must stay outside the tracked source tree. No existing assistant history is seeded into Astra.

The 3D character is loaded from a local GLB and paced at up to 30 rendered frames per second. The viewport has a **Pause scene** control and stops when hidden, minimized, offscreen or under reduced-motion preference. A **Idle activities** toggle stops her moving. If the character asset cannot load, a clearly labelled procedural mannequin is used as a fallback so chat stays usable. The procedural mannequin remains the fallback; the rigged GLB is the shipped appearance. preference. `docs/LIVING_COMPANION_PLAN.md` records later character, animation, offline speech and lip-sync stages; these require separate approval. Microphone and audio controls are visibly unavailable.
