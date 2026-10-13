# ASTRA

A standalone, local-first Windows AI companion in development. LW-02A adds a measured 30 fps scene, dimension-driven full-body camera framing and a reviewable non-rigged Blender character design prototype beside current-session conversation with the locally installed Gemma 3 4B model. The prototype is design evidence only: the app still shows the labelled procedural mannequin. Final character artwork, rig, voice, persistent memory, cloud services and computer control are not implemented.

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

## Character design prototype

`docs/LW02A_CHARACTER_SPEC.md` holds the proposed appearance, Blender-to-GLB contract, skeleton, facial controls, clip list and review budgets. The non-rigged blockout and its five review renders are regenerated with local Blender:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/blender/create_astra_design_prototype.py
```

The script accepts an output folder after `--` and writes the five `docs/review/lw02a/astra-design-prototype-*.png` images plus the editable `.blend`.

## Layout and continuity

- `src/main/`: Electron window, permission denial, narrow IPC handler, and local Ollama chat service.
- `src/preload/`: bundled, sandbox-compatible context bridge.
- `src/renderer/`: React Living Companion UI, isolated procedural Three.js viewport and restrictive CSP.
- `src/shared/`: typed bridge contract, safe message-block parser, 3D camera framing and frame-performance summary helpers.
- `tests/` and `scripts/`: foundation, chat-service, formatting, camera/performance and Windows layout/launch, scene-measurement and Blender design-prototype checks.
- `docs/`: plan, decisions, verified state and handover.

Read `AGENTS.md` and the continuity documents before changing the project. Models, personal memory, backups and secrets must stay outside the tracked source tree. No existing assistant history is seeded into Astra.

The 3D mannequin is code-native and clearly labelled as temporary. The viewport paces itself at up to 30 rendered frames per second, has a **Pause scene** control and stops when hidden, minimized, offscreen or under reduced-motion preference. `docs/LIVING_COMPANION_PLAN.md` records later character, animation, offline speech and lip-sync stages; these require separate approval. Microphone and audio controls are visibly unavailable.
