# Unverified project, service and memory claims

**Status:** implemented and verified on 2026-10-15. Not pushed.

## The report

Astra told Karl:

> The repository is now located at `C:\Users\karlr\repos\Astra's Blog`.

She also stated that a website was available at `http://localhost:3000` and that
she had recorded the location in personal memory. Karl checked: the directory did
not exist, nothing was serving port 3000, and no such memory had been written.
All three claims were false, and all three were about the machine rather than
about code.

## Root cause: the routing defect

`CodingBridge.handle()` returned `null` for every message the router labelled
`chitchat`, and `ChatService.send()` treated a `null` tool result as "ordinary
conversation" and handed the message to `gemma3:4b`. The router's
`create_repository` rule recognised a **closed noun list**:

```ts
/\b(create|make|start|scaffold|set up|new)\b.*\b(repo|project|app|application|dashboard|service|site)\b/i
```

Karl said "blog" and "website". Neither is in that list, so his request matched
**no rule at all**, became `chitchat`, and reached the language model — which
had no tools, no filesystem access and no way to know any of it was untrue, and
narrated a plausible result instead. Reproduced directly against the shipped
router:

| Message | Old result |
| --- | --- |
| `Create a new blog website called Astra's Blog` | `chitchat` |
| `Can you make me a blog called Astra's Blog?` | `chitchat` |
| `Set up a blog called Astra's Blog` | `chitchat` |
| `Make a folder called Astra's Blog for blog posts` | `chitchat` |
| `Is the website running on localhost:3000?` | `chitchat` |
| `Start the dev server` | `chitchat` |
| `Does C:\...\Astra's Blog exist?` | `chitchat` |
| `Is C:\...\Astra's Blog a git repository?` | `chitchat` |

CA-01B's file authoring had already closed the file half of this gap. It did not
touch **project creation**, **directory existence**, **Git identity**, **local
services** or **memory**, so those five subjects still fell through.

Three secondary defects made it worse:

1. **A creation request was demoted to a read-only listing.** `Create a folder
   called Blog inside my repositories` matched `list_repositories` because the
   rule fired on the bare word "repositories" — a mutating request silently
   became a read-only one.
2. **A URL was resolved as a repository name.** `Open the website at
   localhost:3000` matched `select_repository` and tried to open a repository
   called "website".
3. **A real path was silently truncated.** `extractAbsoluteFilePath` stopped at
   the first apostrophe, so `C:\Users\karlr\repos\Astra's Blog` resolved to
   `C:\Users\karlr\repos\Astra` — a real-looking path that does not exist. Even
   a correct existence check would have reported "not found" about the wrong
   directory.

There was also no intent for existence, Git-identity or service questions at all,
so those were guaranteed to reach the model rather than merely likely to.

## The fix

### 1. Routing may no longer fall through for these subjects

`codingIntent.ts` gained `check_path`, `check_repository` and `check_service`,
placed **before** the general action rules, plus a broadened `create_repository`
covering `blog`, `website`, `folder` and `site`. Each rule can carry a
`blockedBy` guard so a broad noun cannot steal a message about something else:
`list_repositories` is blocked when a creation frame is present, and the
repository-selection rules are blocked when the message carries a URL or a
loopback address.

The structural guarantee is a **safety net**, not a longer word list. After the
rule table is exhausted, `verificationFallback()` routes any message naming a
loopback address, a Windows path or a project-existence claim to a verification
tool. `chitchat` is therefore unreachable for these subjects regardless of
phrasing. This is the part that actually closes the defect: the old failure was
an unenumerated phrasing, and enumerating phrasings cannot prevent the next one.

### 2. Verification comes from a syscall or a socket

New `src/main/workspace/verification.ts`:

- `inspectPath()` resolves through the existing `pathGuard` containment check,
  then stats the path. `isGitRepository` is true **only** when a real `.git`
  entry is present — never inferred from a name or from having source files.
  A path outside the approved root returns `unavailable` with the reason rather
  than an existence verdict.
- `inspectLocalService()` opens a real TCP connection to a loopback address and
  reports whether one was accepted. It is restricted to loopback: a public host
  is refused and not contacted, so this cannot be used as a network oracle.
- `extractAbsoluteFilePath` now runs to a sentence boundary for verification
  questions and trims a trailing question phrase, so a path with a space or an
  apostrophe survives. Trimming too much fails safely — the tool prints the exact
  path it checked.

`CodingBridge` gained `checkPath`, `checkRepository` and `checkService`, which
report only what the check returned. "Verified: it does not exist" is a complete
and expected answer.

### 3. No canned refusals

None of this is a refusal. Each branch performs a real check whose result becomes
the reply, and each limitation is stated with the action that would resolve it.
A project-creation request that also names a URL now says explicitly that Astra
**cannot start a web server** and will not imply a site exists — it still
produces the normal approval-gated scaffold proposal.

### 4. The generated-reply backstop

`containsFalseFileAction` / `containsFalseMemoryAction` were too narrow: they
matched "I created the file x.js" but not "the repository is now located at …",
"a website is available at …" or "that folder is a git repository". They are
replaced by `unverifiedClaimKind()`, which classifies five claim classes
(`service`, `location`, `git`, `file`, `memory`). A reply asserting one without a
tool behind it is replaced by a truthful statement of what was not verified plus
the check that would establish it. Honest phrasing is not flagged; the tests
pin both directions.

### 5. Memory

`save a memory that …` matched no memory intent, so it fell through to the model
and produced an invented confirmation. `memoryIntents.ts` now recognises
`save/store/record/write … memory|note`, with the noun mandatory so `save the
file` stays a coding request. Memory confirmation still requires a real write
result from the trusted service.

## Preserved guarantees

Nothing about approval or filesystem security was relaxed. `npm test` passes
**336/336**, including all 316 pre-existing tests unchanged. CA-01B's
file create/read/edit/delete flows, the direct-file hash check, disk readback,
the CA-01 task state machine, the approval service, `pathGuard` containment and
the `Does the file X exist?` → `read_file` routing are all untouched. The
verification intents are read-only: they cannot mutate, and they resolve paths
through the same sandbox as every other tool.

## Limits

- Detection is deterministic and lexical, like the guard it replaces. A novel
  phrasing can still evade a given pattern, which is why the routing safety net —
  not the prose detector — is the real fix.
- A loopback port answering a connection proves something is listening, not what.
  The reply says so.
- `resolveClaimSubject` inspects the only project under the root when the request
  names a generic one; with several, it asks rather than guessing.
- The interactive native harness `scripts/acceptance-ca01b.mjs` requires Karl's
  own approval clicks and cannot be run unattended. It has **not** been re-run.