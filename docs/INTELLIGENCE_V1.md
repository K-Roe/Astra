# Intelligence V1 — architecture and operating manual

Approved by Karl, 2026-10-13. This document is the reference for another agent
or for Karl himself. It records what was built, what was measured, and what is
still not true.

---

## 1. What this milestone is

Astra gained persistent, local, approval-gated capabilities:

1. Learn from HTTPS documentation sites Karl approves.
2. Remember things, including corrections, across restarts.
3. Answer from stored sources with real citations, and admit ignorance.
4. Discover, inspect and edit repositories under `C:\Users\karlr\repos`.
5. Run approved development commands in a controlled way.
6. Persist coding tasks across restarts without ever auto-resuming work.

It did **not** change any model weights. "Learning" here means retrieval from a
local SQLite database, plus memory records. Gemma and Qwen run exactly as they
did before.

---

## 2. Process architecture

The renderer gained **no** new privileges. It still runs sandboxed with
`contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` and a
CSP whose `connect-src` is `'none'`, so it cannot reach the network at all.

```
renderer (src/renderer)             preload                    main (src/main)
─────────────────────────────       ──────────────────         ─────────────────────────
workspaces/*.tsx                     astra                      window + IPC + security
  learning.client.ts  ──invoke──▶   astraIntelligence ──▶  IntelligenceService
                                      (typed, 26 channels)      ├─ KnowledgeStore   (SQLite)
                                                                  ├─ MemoryStore      (SQLite)
                                                                  ├─ ApprovalManager  (SQLite)
                                                                  ├─ TaskStore        (SQLite)
                                                                  ├─ reader.ts        (the only code
                                                                  │                     that touches
                                                                  │                     the internet)
                                                                  ├─ pathGuard.ts     (the only code
                                                                  │                     that resolves
                                                                  │                     repo paths)
                                                                  └─ commandRunner.ts (the only code
                                                                    that spawns processes)
```

Everything privileged lives in main. The renderer can only send a *name*
(`project root`, `source id`, `task id`), never a filesystem path it wants
acted upon, and never a shell string.

Source layout:

| Path | Responsibility |
|---|---|
| `src/main/knowledge/database.ts` | SQLite open, migrations, backup, corruption recovery |
| `src/main/knowledge/schema.ts` | Append-only, versioned migrations |
| `src/main/knowledge/knowledgeStore.ts` | Sources, documents, chunks, FTS retrieval |
| `src/main/knowledge/memoryStore.ts` | Memory, corrections, provenance |
| `src/main/knowledge/grounding.ts` | Builds the untrusted reference block + citations |
| `src/main/research/urlGuard.ts` | HTTPS/host/path checks, IP blocking, redirect + DNS pinning |
| `src/main/research/reader.ts` | Crawl with limits, robots.txt, pinned connections |
| `src/main/research/extraction.ts` | HTML → readable text, chunking |
| `src/main/workspace/pathGuard.ts` | Windows path containment, symlink/junction defence |
| `src/main/workspace/repoTools.ts` | Repository discovery, file listing, read, search |
| `src/main/workspace/fileTools.ts` | Write, patch, delete, Git status/diff/branch |
| `src/main/workspace/commandRunner.ts` | Allowlisted, non-shell command execution |
| `src/main/approvals/approvalManager.ts` | Approvals, scope checks, audit log |
| `src/main/agent/taskStore.ts` | Coding task lifecycle + restart recovery |
| `src/main/models/codingBenchmark.ts` | Model routing + objective coding benchmark |
| `src/main/intelligenceService.ts` | Assembles the above for IPC |

---

## 3. Database

Location: `app.getPath('userData')/astra-intelligence.db`, i.e.
`%LOCALAPPDATA%\Astra\...` — **outside the tracked source tree**, never in the
repository. It uses the SQLite build bundled with Node (`node:sqlite`), so no
native dependency and no cloud service were added.

Tables (migration 1 and 2, append-only):

| Table | Purpose |
|---|---|
| `sources` | Approved sites, crawl limits, last refresh, last error |
| `documents` | One row per fetched page, with content hash and freshness |
| `chunks` | Overlapping text chunks (≈900 chars) |
| `chunks_fts` | FTS5 external-content index over `chunks` |
| `citations` | Provenance rows linking documents to sources |
| `memory` | Statements with category, provenance, confidence, active flag |
| `corrections` | What Karl corrected, kept even after superseding |
| `projects` | Repository metadata discovered on disk |
| `coding_tasks` | Objective, state, plan, scope, changes, test results |
| `task_events` | Append-only task history |
| `approvals` | Requested/approved/denied with the exact scope |
| `audit` | Every privileged action and every refusal |

Guarantees:

- **Migrations are idempotent.** Reopening applies nothing twice.
- **Corruption is quarantined, not destroyed.** A damaged file is copied to
  `<name>.corrupt-<timestamp>` and only then replaced, so nothing is lost.
- **Backup** uses `VACUUM INTO`, so a copy is consistent even under WAL.
- **No credential columns exist**, enforced by a test that greps the schema.
- Foreign keys cascade: deleting a source removes its documents and chunks.

---

## 4. Approved-website security

`src/main/research/urlGuard.ts` is the trust boundary for the network.

A URL is fetched only if **all** of these hold:

1. Scheme is `https:`.
2. No credentials in the URL.
3. Port is 443 (or absent).
4. Host matches the approved host **exactly** — not a suffix, not a subdomain,
   not a registrable domain.
5. Path is the approved prefix or below it.
6. The host is not `localhost`/`*.localhost` or a known metadata hostname.
7. **Every** DNS answer for that host is public: not loopback, not private
   (10/8, 172.16/12, 192.168/16), not link-local (169.254/16), not CGNAT
   (100.64/10), not multicast/reserved (224/4, 240/4), not IPv6 loopback/ULA/
   link-local, and not IPv4-mapped, NAT64 (`64:ff9b::/96`) or 6to4 (`2002::/16`)
   spellings that hide a private address.

Then, and this is the part that closes DNS rebinding:

- The validated IP address is **pinned**: the socket connects to that literal
  address with the TLS `servername` still set to the real hostname. A second DNS
  answer cannot swap in `127.0.0.1`.
- **Every redirect hop is re-validated from scratch**, and a hostile redirect
  target is never requested at all.
- Links discovered on a page are validated by the same function, so a page
  cannot widen the crawl.

Crawl limits (`DEFAULT_LIMITS`): ≤20 pages, depth ≤1, ≤25 documents,
≤2 MB per document, ≤8 MB total, ≤3 redirects, 10 s per request, 60 s total,
500 ms minimum delay (raised if `robots.txt` sets `Crawl-delay`).

`robots.txt` is fetched and honoured with longest-match Allow/Disallow. It is
validated against the same origin but with the path prefix relaxed to `/`,
because robots.txt necessarily lives outside an approved path.

---

## 5. Prompt injection: the central rule

Web content and model output are **data, never authority**.

- `MemoryStore.remember` throws if `origin === 'web'`. Nothing scraped can
  become a trusted memory.
- Retrieved passages are wrapped in `<passage id="N" ...>` tags under a header
  that says the content is untrusted data, and the wrapper text appears
  *before* the payload.
- The system prompt tells the model explicitly to ignore any request,
  command or permission claim inside a passage.
- `ApprovalManager.FORBIDDEN_ACTIONS` contains `credential.read`,
  `command.from_web_content`, `security.disable`, `self_grant_permission`,
  `system.delete` and others; these can never be approved at any level.
- No code path turns a model string into a command. The command runner takes an
  executable plus an argument array and rejects metacharacters.

Scenario E verifies this against four realistic injections.

---

## 6. Repository sandbox

The only permitted workspace root is `C:\Users\karlr\repos`.

`resolveWithinRoot` defends against:

- `..` traversal and absolute-path escapes — by resolving and comparing.
- Sibling-prefix bypass (`C:\Users\karlr\repos-evil` vs `...\repos`).
- Symlinks and Windows junctions — via `realpathSync` plus a walk that refuses
  any path with a linked component, and resolves the nearest existing ancestor
  so a not-yet-created file cannot escape through a linked parent.
- Case-insensitive bypass and trailing dot/space tricks.
- NUL bytes and reserved device names (`CON`, `NUL`, `COM1`, …).

**Edits are scoped to the repository, not merely to the workspace root.** This
was a real bug found during testing: `../escaped.js` from inside a repo
originally landed in the parent directory. `repoScope()` now narrows the sandbox
so a project can never write into a sibling project.

Discovery never executes anything, skips `node_modules`/`.git`/`dist`/etc., and
never exposes `.env`, `id_rsa`, `*.pem`, `credentials*`, `secrets*` or bare
`npmrc` — those are filtered before listing, before reading, and before search.

---

## 7. Command execution

`commandRunner.ts` runs commands with **no shell** (`spawn(exe, args)`), which
removes shell injection entirely.

- Allowlisted executables only: `npm node npx git pnpm yarn python pytest tsc eslint`.
- `npm install` / `i` / `add` / `ci` are **always refused** — dependency
  installation needs separate approval.
- `node -e`, `--eval`, `npm -c` and arguments containing `; & | \` $ > <` are refused.
- The working directory is always resolved inside the authorised repository.
- Timeouts kill the whole process tree (`taskkill /T /F` on Windows).
- Output is capped at 200 000 characters.
- `windowsHide` is set; no detached background processes.

Package scripts, installers and test runners are treated as arbitrary code
execution, which is why the allowlist is of *scripts*, not just of executables.

---

## 8. Approvals

Four levels: `read_only`, `task_approval`, `separate_approval`, `forbidden`.

`assertApproved(action, scope)` runs **immediately before** the privileged
operation. It requires an approved record whose scope covers the request.

Scope matching is a **ceiling, not a floor**: every key in the approval must be
present and equal in the request. Extra request keys are ignored. So an approval
for `files: ['src/a.ts']` does not authorise `src/b.ts`, and an approval for
one repository does not authorise another.

Everything is recorded in `audit`, including refusals.

---

## 9. Task lifecycle and recovery

States: `draft → investigating → planning → awaiting_approval → implementing →
testing → reviewing → completed`, plus `failed`, `paused`, `cancelled`.
Illegal transitions throw.

Only `implementing` and `testing` may execute, and only when
`requiresConfirm` is false.

**On startup**, every unfinished task is marked `requiresConfirm = 1` and
records `interruptedAtState`. Astra surfaces it as "awaiting your confirmation".
Nothing resumes. `confirmResume()` clears the flag only when Karl explicitly
acts. A cancelled task cannot be resumed at all.

---

## 10. Model routing and the coding benchmark

Gemma `gemma3:4b` remains the conversational model. `qwen2.5-coder:7b` is the
coding candidate.

`routeTask('coding', { codingReliability })` **refuses to delegate** until a
measured reliability reaches `MIN_CODING_RELIABILITY = 0.6`. Unmeasured means
not trusted.

Measured on this machine (2026-10-13, `scripts/benchmark-coding-model.mjs`):

```
PASS  ts-type-error            TypeScript correctness
PASS  code-generation          Code generation
PASS  bug-fix                  Bug fixing
FAIL  test-interpretation      Test interpretation
PASS  structured-tool-call     Structured tool calls
PASS  multi-file-reasoning     Multi-file reasoning
reliability 0.83 (5/6) → usable for delegated coding: true
```

**Read this honestly.** Six short, single-shot prompts with objective checks
show the model handles small well-specified tasks. They do **not** establish
reliable unattended multi-step development on a real repository. The benchmark
file records that caveat in its own output. Delegated work therefore stays
bounded: every change needs approval, every edit is verified by running tests,
and nothing is committed or pushed without separate approval.

The failing case is recorded, not hidden: asked why a test expected 4 but got
5, the model restated the symptom instead of naming a cause.

---

## 11. Grounded answering

Before each generation, `ChatService` calls the retrieval hook:

1. `KnowledgeStore.search(query)` → up to 5 passages with real URLs.
2. `MemoryStore.relevant(query)` → up to 5 trusted statements.
3. `referenceBlock()` builds a labelled, fenced block.
4. `groundingInstruction()` tells the model to cite `[1]`, `[2]`, to admit gaps,
   and never to invent a citation.
5. After generation, `extractUsedCitations()` appends only the sources the model
   actually referenced.

Verified live: Astra fetched `https://react.dev/learn`, indexed 5 documents
(1.78 MB, 167 chunks), answered a React question from retrieved text with a real
citation, and refused an out-of-scope question without fabricating a source.

---

## 12. Verification summary

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | **176/176 pass** (109 new) |
| `node scripts/acceptance-intelligence.mjs` | **39/39 checks pass** |
| `npm run verify:desktop` | PASS, native Windows, exit code 0 |
| `node scripts/benchmark-coding-model.mjs` | 0.83 reliability recorded |
| `node scripts/live-crawl-test.mjs` | live fetch + retrieval succeeded |

Performance with everything running: 30 fps idle, 30 fps during generation,
392 MiB Electron working set, first reply ~7.7 s (4B model on CPU-class
hardware, unchanged from before).

---

## 13. Known limitations

- **No embeddings.** FTS5 keyword retrieval only. It matches lexical overlap,
  so a paraphrased question may miss relevant chunks.
- **No new-repository scaffolding.** `ensureNewRepositoryDirectory` +
  `writeProjectFile` can create and initialise a repository, but there is no
  `npm create vite` equivalent, because package installation is blocked.
- **The Coding workspace lists tasks and approvals but does not yet drive a
  full automated edit→test→diff loop from the UI.** The underlying tools and
  the task machine work and are tested (Scenario D does the whole loop through
  the service layer); the UI exposes create/cancel/resume/approve.
- **No vector search, no fine-tuning, no cloud.** By design.
- **`node:sqlite` is marked experimental by Node.** It works on Node 24.21 as
  bundled with Electron 44, but the API could change between majors.
- **Benchmarks are small.** Six cases is enough to catch a broken model and not
  enough to certify a good one.
- Nothing has been committed or pushed.

---

## 14. Exact next steps

1. Karl reviews `test-results/intelligence/learning-workspace.png` and the
   grounded chat transcript in `test-results/intelligence/grounded-chat.json`.
2. If retrieval quality disappoints, add local embeddings behind a flag and
   benchmark them against FTS5 rather than assuming they help.
3. Wire the Coding workspace to the task machine so the UI can run the
   investigate → approve → edit → test → diff loop end to end.
4. Decide whether dependency installation should ever be permitted, and under
   what separate approval.