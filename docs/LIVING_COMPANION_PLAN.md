# Living Companion implementation plan

Current authorization: **LW-01 local 3D proof of concept**, superseding the V0.2 CSS portrait as the current placeholder. The React layout and a temporary procedural full-body mannequin in a basic room are implemented. No final artwork, production rig, animation engine, microphone, speech engine or lip-sync exists. Each later stage requires Karl's separate approval and must preserve the local Ollama chat and Electron security boundary. The original 2D layered-art suggestions below are historical proposals; Karl's newer full-body 3D vision requires a separately approved 3D character/rig specification before Phase 02 work.

## LW-01 — local 3D proof of concept (implemented; verification in CURRENT_STATE.md)

Direct Three.js inside `AvatarPanel` renders an isolated procedural room and labelled mannequin, with a fixed camera and simple idle joint motion. It caps idle rendering, pauses on manual/hidden/offscreen state and respects reduced-motion preference. This is technical validation only; it adds no room behavior, final character design, voice or memory. The next character stage should specify a versioned local 3D model and articulated/facial rig, asset rights, expressions, animation clips, compact readability and performance targets before implementation.

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
