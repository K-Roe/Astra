# ASTRA

A standalone, local-first Windows AI companion in development. LW-02B-R1 refines the full-body 3D character into a polished, expressive cartoon companion — a 1.70 m stylised young-adult woman with a sculpted face (real eye sockets, seated eyes, integrated lips), a loose violet updo with a side-swept fringe, a purple hoodie with a golden star, dark trousers and lavender trainers — rendered as a **design awaiting Karl's visual approval**. The application still shows the labelled procedural mannequin beside current-session conversation with the locally installed Gemma 3 4B model. No production rig, GLB integration, voice, persistent memory, cloud services or computer control is implemented.

## Requirements

- Windows desktop session
- Node.js and npm (verified here with Node 24.12.0 and npm 11.16.0)
- Existing Ollama installation with `gemma3:4b` resolving to digest `c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291`

## Run

```powershell
npm ci
npm run dev
```

`dev` builds the TypeScript main/preload code and Vite renderer, then opens Electron. It does not run a hot-reload server; rebuild and relaunch after edits. Dependencies require a network connection for the initial install. The app loads local files; Electron main contacts only Ollama at `127.0.0.1:11434`. Start Ollama before chatting. The renderer has no direct network or filesystem access.

Messages remain only in process memory for the running session. Use **Clear conversation** to reset it. Closing Astra clears the session; Astra cannot remember it on the next launch. If Ollama is unavailable or the approved model identity differs, the app shows an error and does not substitute another model.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:desktop
npm run measure:world
```

`npm test` builds first, then runs foundation, chat-service, message-formatting and 3D camera/performance-summary tests. `verify:desktop` requires a completed build, an interactive Windows session, Ollama, and the approved model already installed. It opens the native Electron window, checks 3D rendering, idle frames, manual/minimized pause and resize, sends a synthetic four-turn Gemma conversation, checks session context, no-persistent-memory behavior, scroll following, reset and bridge isolation, then closes the window and checks that Electron exits. It saves ignored screenshots at `test-results/astra-lw01-desktop.png` and `test-results/astra-lw01-compact.png` and resource samples at `test-results/astra-lw01-performance.json`. These are brief samples; whole-GPU readings do not isolate viewport consumption. The verifier uses a loopback Chrome DevTools port only for that test run; the normal `dev` launch does not enable remote debugging. `verify:desktop --allow-occluded` additionally runs when this session's foreground window prevents Chromium from reporting the app as visible; the run then records the visibility method it used. A disconnected-network acceptance test has not yet been run.

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

- `src/main/`: Electron window, permission denial, narrow IPC handler, and local Ollama chat service.
- `src/preload/`: bundled, sandbox-compatible context bridge.
- `src/renderer/`: React Living Companion UI, isolated procedural Three.js viewport and restrictive CSP.
- `src/shared/`: typed bridge contract, safe message-block parser, 3D camera framing and frame-performance summary helpers.
- `tests/` and `scripts/`: foundation, chat-service, formatting, camera/performance and Windows layout/launch, scene-measurement, and Blender character-design scripts.
- `docs/`: plan, decisions, verified state and handover.

Read `AGENTS.md` and the continuity documents before changing the project. Models, personal memory, backups and secrets must stay outside the tracked source tree. No existing assistant history is seeded into Astra.

The 3D mannequin is code-native and clearly labelled as temporary. The viewport paces itself at up to 30 rendered frames per second, has a **Pause scene** control and stops when hidden, minimized, offscreen or under reduced-motion preference. `docs/LIVING_COMPANION_PLAN.md` records later character, animation, offline speech and lip-sync stages; these require separate approval. Microphone and audio controls are visibly unavailable.
