# Living Companion implementation plan

Current authorization: **LW-02B refined character design**, superseding LW-02A as the current working state. The React layout, the procedural full-body mannequin, the measured 30 fps scene budget and the dimension-driven desktop/compact camera framing remain implemented and unchanged. LW-02B adds a **refined, non-rigged character blockout** with seven review renders, an LW-02A/LW-02B comparison sheet and a written skeleton/facial-control/GLB plan. There is still **no production rig, no GLB, no asset loader, no animation controller, no room simulation, no microphone, no speech engine and no lip-sync**. Every later stage requires Karl's separate approval and must preserve the local Ollama chat and Electron security boundary.

## LW-02B — refined character design (implemented; awaiting Karl's approval)

- Rebuilt the character at 1.70 m and 5.76 heads using lofted elliptical sections instead of stacked primitives: readable skull, jaw and cheek, expressive eyes with lid lines, tapered brows, slim nose, asymmetric mischievous smile, fitted loose updo, sectioned hoodie with a collar-down hood, kangaroo pocket and a chest-conformed star emblem, tapered trousers and trainers with toe box, sole, heel counter and laces.
- Fixed two genuine modelling defects found by inspecting renders: fingers fanned across the depth axis instead of the width axis, and facial landmarks placed independently of the skull surface.
- Documented animation readiness only: a proposed glTF-named bone hierarchy, shape-key and expression/mouth-shape sets, the motion-to-bone mapping, and a seven-step Blender-to-GLB export plan with a deterministic mannequin fallback.
- Verified the working application is untouched: lint, 11/11 tests, native desktop verification and a 30.0 fps scene measurement matching the LW-02A baseline.

**Boundary:** stop here. Karl must approve or revise the design before any rigging, GLB export or integration. Do not begin LW-02C automatically.

## LW-02A — character design and 3D performance gate (implemented; superseded above)

## LW-02A — character design and 3D performance gate (implemented; superseded above)

- Measured why the LW-01 scene reported about 10.9 fps during Gemma generation: LW-01's own 12 fps `setTimeout` cap, not a renderer stall. A controlled replay of that cap measures about 10.75 fps, while `renderer.render` uses roughly 0.4 ms CPU per frame.
- Replaced that cap with a 30 fps `requestAnimationFrame` budget with the same stop conditions. Idle, generating, finished, compact, restored and resumed samples all hold 30 fps; minimized and manual pause render nothing.
- Replaced the fixed camera with a pure dimension-based framing function so the full body fits desktop and compact panels, with restrained camera interpolation on resize and a slightly larger compact viewport.
- Verified resize, minimize/restore, manual pause, reduced-motion emulation and the WebGL-unavailable text fallback with chat still usable.
- Wrote `LW02A_CHARACTER_SPEC.md`: proportion and turnaround sheet, palette, Blender-to-GLB asset contract, proposed skeleton, facial controls, minimum expression and mouth-shape sets, candidate clip list and provisional review budgets.
- Built a non-rigged design blockout with Blender and five review renders. This is design evidence for Karl, not approved art, a rig or a replacement for the mannequin.

**Boundary:** Karl's visual approval of the character direction is required before LW-02B. Do not model a production rig, integrate a GLB, add animation controllers, room simulation, voice, memory, website research or autonomous actions under LW-02A authority.

## LW-01 — local 3D proof of concept (implemented; superseded above)

Direct Three.js inside `AvatarPanel` renders an isolated procedural room and labelled mannequin, with a fixed camera and simple idle joint motion. It caps idle rendering, pauses on manual/hidden/offscreen state and respects reduced-motion preference. This is technical validation only; it adds no room behavior, final character design, voice or memory. The next character stage should specify a versioned local 3D model and articulated/facial rig, asset rights, expressions, animation clips, compact readability and performance targets before implementation. That specification now exists as `LW02A_CHARACTER_SPEC.md`.

## Phase 01 — character-first interface (implemented and verified 2026-10-13)

- Avatar panel is a responsive, scalable presentation component with a clearly labelled temporary placeholder. The CSS illustration suggests purple hair, an updo, expressive eyes and a star hoodie; it is not approved final artwork.
- `PresentationState` defines `idle`, `listening`, `thinking`, `speaking` and `error`. The current chat maps only ready/connecting to idle, generating to thinking, and failures to error. Listening and speaking are unreachable until corresponding voice features exist.
- Chat remains session-only through the existing main/preload bridge. Voice control positions are visibly disabled. Text and fenced code are rendered without HTML injection. Scrolling follows new messages unless the user scrolls up.
- Acceptance: strict TypeScript, lint, automated tests, production build, native Windows live conversation, desktop and compact screenshots, resize/overflow checks and clean shutdown. Exact results belong in `CURRENT_STATE.md`.

## Phase 02 — approved avatar artwork and rig (future)

- Karl reviews and approves a character sheet, palette and expression set before any artwork is generated, downloaded or integrated. Establish ownership and local source-file location outside mutable runtime data.
- Create layered master artwork suitable for a stable face/eye/mouth/hoodie rig, plus exportable transparent assets at agreed desktop resolutions. Keep source layers and rig versioned; use an explicit fallback frame when assets are unavailable.
- Acceptance: Karl approves the appearance; source and exports render correctly in both desktop and compact panels; expressions remain readable at compact size; no remote asset fetch or unapproved download.

## Phase 03 — animation state controller (future)

- Replace the temporary CSS figure behind the existing `AvatarPanel` boundary. Implement a small controller that consumes typed presentation events and owns transitions, cancellation and fallback. Respect reduced-motion settings and avoid continuous GPU-heavy effects.
- Idle/thinking/error may be driven by real chat state. Listening and speaking must remain unavailable until voice input/output is implemented and verified.
- Acceptance: state transitions, resize behavior, reduced-motion behavior, resource use and failure fallback are tested on target hardware. No animation may imply an action that has not occurred.

## Phase 04 — offline speech output (future)

- Benchmark local speech synthesis candidates on Karl's hardware before choosing one. Route audio generation through a narrow main-process service; provide visible playback, stop, mute and error states. Store no conversation audio by default.
- Acceptance: speech plays without external network access, can be stopped and muted, handles model/service failure, and does not claim speaking when output is unavailable. Record latency and voice quality review.

## Phase 05 — offline speech recognition (future)

- Benchmark local recognition candidates and add explicit microphone permission, visible listening state, push-to-talk or another approved activation rule, cancellation, and a clear text correction path. Deny microphone access until this stage is authorized.
- Acceptance: disconnected microphone-to-text test, permission deny/revoke test, privacy review, latency/accuracy evidence and no hidden recording.

## Phase 06 — lip-sync and expressions (future)

- Drive mouth/expression changes from actual speech timing or verified alignment data, with a neutral fallback when timing is absent. Do not simulate lip-sync during text-only replies.
- Acceptance: inspected audio/video synchronization across short and long utterances, cancellation/reset, reduced-motion fallback and target-hardware performance.

Persistent memory, coding tools, model switching and autonomous actions are separate project scopes. This plan does not authorize their implementation.
