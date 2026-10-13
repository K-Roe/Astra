# ASTRA

A standalone, local-first Windows AI companion in development. LW-02B refines the full-body 3D character design to a 1.70 m, 5.76-head stylised Astra with a violet loose updo, expressive face, purple star hoodie, dark trousers and trainers, rendered as a **non-rigged design blockout awaiting Karl's visual approval**. The application itself still shows the labelled procedural mannequin next to current-session conversation with the locally installed Gemma 3 4B model. No production rig, GLB integration, voice, persistent memory, cloud services or computer control is implemented.

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

`docs/LW02B_CHARACTER_SPEC.md` holds the refined appearance, proportion sheet, palette, the proposed glTF-named skeleton, facial controls, animation-readiness mapping and the Blender-to-GLB export plan. `docs/LW02A_CHARACTER_SPEC.md` is preserved as the superseded first pass. Both are **design proposals awaiting approval**; neither is a rig or a shipped asset.

Generate the refined LW-02B blockout, its six review views, the in-room view and the editable `.blend` with local Blender:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/blender/create_astra_character_refined.py
```

Build the LW-02A versus LW-02B comparison sheet from any two character renders:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/blender/make_astra_design_comparison.py -- docs/review/lw02a/astra-design-prototype-neutral-front.png docs/review/lw02b/astra-lw02b-front.png docs/review/lw02b
```

The character script accepts an output folder after `--` and defaults to `test-results/lw02b/design`. Committed review images live in `docs/review/lw02a/` and `docs/review/lw02b/`; the superseded LW-02A blockout is still reproducible with `scripts/blender/create_astra_design_prototype.py`.

## Layout and continuity

- `src/main/`: Electron window, permission denial, narrow IPC handler, and local Ollama chat service.
- `src/preload/`: bundled, sandbox-compatible context bridge.
- `src/renderer/`: React Living Companion UI, isolated procedural Three.js viewport and restrictive CSP.
- `src/shared/`: typed bridge contract, safe message-block parser, 3D camera framing and frame-performance summary helpers.
- `tests/` and `scripts/`: foundation, chat-service, formatting, camera/performance and Windows layout/launch, scene-measurement, and Blender character-design scripts.
- `docs/`: plan, decisions, verified state and handover.

Read `AGENTS.md` and the continuity documents before changing the project. Models, personal memory, backups and secrets must stay outside the tracked source tree. No existing assistant history is seeded into Astra.

The 3D mannequin is code-native and clearly labelled as temporary. The viewport paces itself at up to 30 rendered frames per second, has a **Pause scene** control and stops when hidden, minimized, offscreen or under reduced-motion preference. `docs/LIVING_COMPANION_PLAN.md` records later character, animation, offline speech and lip-sync stages; these require separate approval. Microphone and audio controls are visibly unavailable.
