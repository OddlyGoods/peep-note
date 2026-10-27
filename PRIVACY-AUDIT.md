# Source privacy audit — 2026-10-27

## Scope

The open repository was initialized separately and contained only its Apache 2.0 license. The original app's tracked source was copied without its `.git` directory, ignored environment files, dependency installation, compiled output, installer artifacts or local application data. The destination's existing license and initial commit were preserved. Package author metadata contains a project contributor label, without a personal email address. The original app's saved notes, attachments and provider settings were never opened or copied.

`npm run test:privacy` checks current source files and reachable Git blobs for common GitHub/provider/AWS credentials, private keys, JWT values, literal credential assignments, personal filesystem paths and non-example email addresses. It also checks commit emails and permits GitHub no-reply identities. It prints file locations, never matching values. The OCR test fixture was visually inspected and contains only synthetic Korean/English test text.

## Findings and changes

- The original `server/jwt.ts` contained a hardcoded JWT verifier key. It exists in the original local history and in the locally cached `origin/main` at `62c026e`. The open repository does not contain that file, the key, or the original Git history.
- The original cloud authentication endpoint and Google login callback were removed, together with account UI, JWT/session logic and the associated dependency. All application APIs use a single local profile; changing old account headers cannot select another data space.
- No live provider API key, GitHub token, private-key file or non-example personal email was detected by the source scan. Original auth test email addresses use the reserved example domain and are synthetic fixtures. GitHub workflow token references are runtime secret expressions, not token values.
- The open app has its own package identity, data directory, preferences namespace, API port and update repository. Its source contains no imported user database. AI provider keys are empty by default and are entered by each local installation's user.

## Remote verification limit and original-key follow-up

Live unauthenticated access to the GitHub repositories returned 404, and `git fetch origin` in the new checkout failed because GitHub credentials were unavailable. Thus this audit covers the checked-out files, all locally available history and cached remote refs; it does not claim to verify the latest GitHub state, server-side secret settings or unreachable/deleted remote objects. No push was performed by this task.

Removing the old verifier key from the new fork does not invalidate the original authentication service's key. If the original service still uses that key, rotate it there and invalidate the affected sessions before exposing the original history. The new local-only app does not depend on that service.

The scanner is heuristic. Run it again before publishing; it cannot guarantee detection of every possible credential format or secrets inside arbitrary binary files.
