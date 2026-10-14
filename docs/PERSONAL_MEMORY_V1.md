# PERSONAL MEMORY V1

## What this is

Personal Memory V1 makes Astra remember what **Karl explicitly tells her**, across
messages, new conversations, application restarts and model unloads. It is
retrieval of stored statements, not training: Gemma's weights are never changed,
no fine-tuning happens, and nothing is uploaded anywhere.

It lives in the existing Intelligence V1 database at
`%LOCALAPPDATA%\Astra\astra-intelligence.db`. There is no second memory database.

## The problem it fixes

Karl reported that ordinary chat behaved as though Astra had no personal memory.
Three real causes were found:

1. Retrieval was keyword-only and could return nothing, so nothing was injected.
2. Memory had no natural-language entry point: the only way to add a memory was a
   small form in the Learning workspace.
3. There was no startup load, no memory context in the prompt, and the interface
   showed only a bare list.

## Schema

Migration 3 (`src/main/knowledge/schema.ts`) extends the existing `memory` table
and adds two small tables. Migrations stay append-only, so a database written by an
older build is upgraded in place and its rows remain usable.

`memory` gains:

| column | meaning |
| --- | --- |
| `subject` | stable key such as `preference.frontend_stack`, used to supersede a stale value |
| `status` | `active`, `forgotten` or `superseded`; `active` stays authoritative for retrieval |
| `origin` | `user_stated`, `user_correction`, `ui_edit`, `model_suggested_accepted` |
| `sensitivity` | `normal` or `sensitive` |
| `conversation_ref` | which conversation a memory came from, for "forget this conversation" |
| `forgotten_at` | when it was forgotten |
| `superseded_reason` | which replacement superseded it |

New tables:

- `memory_events(id, memory_id, at, kind, detail)` — every create/update/forget is auditable.
- `settings(key, value, updated_at)` — the automatic-suggestion toggle.

## Startup loading

`IntelligenceService.loadPersonalMemory()` runs once in main before the window is
shown. It reads the active rows, records `memory.loaded` in the audit log, and
prints the count. The interface shows the same count and load time, so what is in
context is visible rather than assumed.

Retrieval is still per-query: `PersonalMemoryService.contextBlock(query)` combines
keyword-relevant memories first, then the most recently updated ones, and
truncates the whole block to `MEMORY_CONTEXT_BUDGET` (1400 characters). A large
database therefore cannot flood the model's 4k context window.

Every write bumps a revision counter, so a cached prompt block or interface list
can never stay stale after an edit or a deletion.

## Natural-language commands

`src/main/memory/memoryIntents.ts` is a pure parser. `MemoryCommands` validates and
executes; `ChatService` runs it **before** the coding tools and before Ollama, so a
memory instruction never becomes a hallucinated claim or a coding task.

| Karl says | Astra does |
| --- | --- |
| "remember that I prefer React and TypeScript" | stores it, replies only after the SQLite transaction commits |
| "what do you remember about my frontend stack?" | lists the real records with their dates |
| "actually, I prefer React with plain JavaScript" | supersedes the earlier preference and says which one it replaced |
| "forget what I told me about React" | deactivates and clears the text |
| "don't remember this conversation" | forgets everything tied to this conversation |

Rules that are deliberate:

- Only **imperatives** store anything. "Will you remember this?" is a question: it
  is answered by the model and writes nothing.
- A vague target ("forget that information") asks for clarification rather than
  deleting something Karl may not have meant.
- Recall falls back to listing everything stored when the topic matches nothing,
  and says so. She never guesses a memory.
- A failed operation is reported as a failure. Nothing is claimed as saved when it
  was not.

## Safety

- **Only Karl's words create memory.** Retrieved website passages, repository files
  and model output never reach the memory path; the Intelligence V1 store refuses a
  web origin outright and that test still runs.
- **Secrets are refused, not redacted.** Statements that look like credentials
  (API keys, tokens, private keys, passwords) are rejected with an explanation.
- **Parameterised queries only.** Injection payloads are stored as literal text;
  the acceptance run proves the table survives and unrelated rows are untouched.
- **Bounded size.** 400 characters per statement, 1400 characters of context per
  prompt, duplicate detection, and superseding rather than accumulating
  contradictory active facts.
- **Forgetting clears the text**, so a forgotten memory is not merely hidden. The
  `corrections` audit rows and the `memory_events` log remain, and a backup of the
  database file taken before the forget can still contain the old value until it
  ages out.

## Suggestions, never silent saving

`suggestMemory()` looks for a stable first-person preference in Karl's own message
("I prefer…", "always use…"). When one is found the chat shows a **Worth
remembering?** chip with the exact statement. Nothing is written until Karl presses
*Remember this*. The toggle *Suggest memories from conversation* in the Personal
Memory panel turns even that off, and the setting persists.

## Interface

The Personal Memory panel in the Learning workspace shows every record including
forgotten ones, with category, origin, created and updated dates, an inline edit,
a forget button, an add form with a category chooser, and the suggestion toggle.
The chat footer reports the live active count, and accepting a suggestion updates
it immediately.

## Verification evidence

Automated (`npm test`, 281/281 on 2026-10-14, of which 34 are new):

- `tests/personalMemory.test.mjs` — creation, retrieval, update, deletion,
  persistence across reopen, empty database, migration of a legacy database,
  duplicates, superseding corrections, disabled suggestions, context budget,
  secret refusal, SQL injection, revision bumping, conversation forgetting.
- `tests/memoryIntents.test.mjs` — parsing of every supported phrasing, vocatives,
  questions that must not store, over-long messages.
- `tests/chatMemory.test.mjs` — memory reaches the prompt, a forgotten memory does
  not, memory commands never call the model, hostile retrieved content creates no
  memory, failures are reported.

Native (`node scripts/acceptance-personal-memory.mjs`, **32/32** on 2026-10-14,
disposable profile, real local model, evidence in `test-results/memory/`):

- **A** chat save → restart → recall; an ordinary question answered from memory.
- **B** a correction in chat, restart, only the corrected value used.
- **C** forgetting in chat, restart, memory gone; the *panel* forget too.
- **D** add, edit and forget through the interface, plus the suggestion toggle.
- **E** hostile content, an unapproved source and a credential are all refused.
- **F** character V2 loads, walks, sits and stands in the same session.
- **G** chat, knowledge, coding state and the world all still work.

Screenshots: `docs/review/lw03/final/memory-chat-save.png`,
`memory-chat-recall.png`, `memory-ui.png`, `final-v2-native.png`.

## Performance and memory pressure (measured 2026-10-14)

| Item | Measurement |
| --- | --- |
| System RAM | 15.8 GiB total |
| Free system RAM on a quiet desktop | ~4.3 GiB |
| Model residency | `gemma3:4b` fully resident in VRAM, 2.68 GiB of an 8 GiB card; 4,478 MiB of 8,192 MiB in use while Astra was closed |
| Astra's own footprint | 392-536 MiB Electron process tree across idle, chat, roam, sofa, desk walk, coding and learning |
| Renderer | 29.6-30.0 displayed fps in every mode measured, holding the 30 fps cap |

LW-03 previously recorded system free RAM falling to about 62 MiB during a busy run. Investigation shows that was **not** Astra: it happened while local inference and other applications were competing, and the low figure tracks whole-system pressure rather than the application's own working set. Astra's contribution stays in the 392-536 MiB range in every mode, Personal Memory V1 adds only rows to the same SQLite file, and no model was downloaded, resized or given more VRAM. The honest statement remains: on a 16 GiB machine, running Astra alongside local inference and other applications leaves little headroom, and that is a property of the machine rather than of the 3D scene.

## Limitations

- Retrieval is keyword matching over the statement, category and subject. A
  paraphrase with no shared word falls back to listing everything stored, which is
  honest but wordier than a semantic answer would be.
- Subjects are generated from the first few meaningful words of the statement, so
  an "actually…" correction with completely different wording supersedes the most
  recent memory of the same category rather than a precisely identified one. The
  reply always says which record was replaced.
- Forgetting clears the row text but cannot reach backups already on disk.
- Memory is single-user and local. There is no encryption at rest beyond what the
  operating system provides for the user profile.
- The model still chooses how to *phrase* an answer from a retrieved memory; the
  record list, dates and the stored statements themselves are exact.