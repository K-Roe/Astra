# Conversational coding and desk activity native review

Captured from the running Electron application on 2026-10-15. `scripts/acceptance-conversational-repository.mjs` used a disposable TEMP profile and repository root, entered “Create a new Git repository called AstraStone.” through the rendered chat composer, waited for Karl's approval, then verified files and local Git after clicking Approve. A real Gemma chat turn responded first. The exact result was: “Coding task #1 completed in C:\Users\karlr\AppData\Local\Temp\astra-conversation-pdl0CX\repos\AstraStone. No executable checks were run. Git diff: 4 file(s), +16/-0. Review the full diff in Coding.” The disposable repository was removed by the harness after verification.

- `approval-seated.png`: V1 seated at the monitor, with the real approval control visible and `seated_idle` active.
- `created.png`: native chat immediately after the approved project was created.
- `v1-coding-desk.png` and `v2-coding-desk.png`: each rig playing `desk_work` during a genuine approved CA-01 test.
- `v1-learning-desk.png` and `v2-learning-desk.png`: each rig at the computer during a real approved website crawl.

The V2 CA-01 run passed 82/82 checks. The first V1 run reached desk work but passed 79/82 overall: one immediate approval sample caught the prior typing clip during transition, and Qwen's second correction did not pass its real test. After sampling the settled wait state and rebuilding V1's missing idle leg keys, a full V1 rerun passed 82/82. The exact-request run also confirmed the pictured approval pose as `seated_idle`. These images are software evidence, not Karl's V2 visual approval or an exhaustive clipping review.
