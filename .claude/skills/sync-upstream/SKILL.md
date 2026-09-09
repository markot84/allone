---
name: sync-upstream
description: Merge the latest performance-plus (client upstream) commits into the allone build, resolving conflicts as upstream's behaviour on top of allone's design decisions, then verify and optionally push/deploy. Use when asked to "sync upstream", "take the latest from performance+", "merge upstream", "pull the client's changes", or bring allone up to date with performance-plus main.
---

# Sync upstream performance-plus into allone

allone is a fork of the client's Performance+. Upstream work is merged in periodically. The fork has
diverged heavily on design (light chrome, Signal Board vocabulary, tokens, accordion rail, hidden
sections), so nearly every sync produces conflicts in the same handful of files.

**The rule that resolves every conflict: upstream's behaviour on top of this build's design
decisions.** Take upstream's logic, copy and structure; keep allone's tokens, layout and switches.

## Non-negotiables

- `upstream` is **fetch-only** (push URL `no_push`). Never push, commit, or modify the working tree
  of `~/projects/makis/performance-plus`. Push only to `origin` (`markot84/allone`).
- Never deploy to `performance-plus-4a5b2` or `performanceplus-staging`. Check `.firebaserc` still
  points `default`/`staging`/`production` at `allone-9e685` **before** any deploy, and deploy only
  through the `npm run firebase:deploy*` scripts (they pass an alias; never a raw project id).

## 1. Fetch what's actually new

The `upstream` remote is a **local sibling checkout**, whose own `main` is usually stale — a plain
`git fetch upstream` will report nothing new even when GitHub has commits. Fetch the sibling's
remote-tracking ref instead:

```bash
cd ~/projects/makis/performance-plus && git fetch origin && cd -   # updates the sibling's origin/main
git fetch upstream 'refs/remotes/origin/main:refs/remotes/upstream/main'
git log --oneline HEAD..upstream/main
git diff --stat HEAD...upstream/main
```

If `HEAD..upstream/main` is empty, there is genuinely nothing to sync — say so and stop.

## 2. Merge

```bash
git status --porcelain   # must be clean first
git merge --no-commit --no-ff upstream/main
```

## 3. Resolve

Read upstream's intent per file before resolving — `git diff HEAD...upstream/main -- <file>` shows
what upstream was trying to achieve, which is often clearer than the conflict hunk.

Recurring conflict sites and how they go:

| File | How it resolves |
|---|---|
| `src/components/layout/AppShell.tsx` | Keep allone's accordion rail, gold badge (no `badgeColor`), collapsed state. Take upstream's nav ordering, group moves and label renames. |
| `src/config/modules.ts` | `HIDDEN_SECTIONS` is allone's and always wins. Merge comment rationales rather than picking one. |
| Any page component | Take upstream's copy/logic; keep allone's `var(--*)` tokens. Never let a `#hex` come back in where allone has a token — especially not `--nts-accent-text` → `--nts-accent` (CLAUDE.md forbids it). |

When upstream's fix is written against markup allone has replaced, **port the intent, not the
patch** (e.g. a badge-wrapping fix expressed in Primer `NavList` classes becomes inline styles on
allone's own rail).

After resolving, check the invariants allone's own code depends on — e.g. nav items must stay
**group-contiguous** after `HIDDEN_SECTIONS` filtering, or a group heading renders twice.

## 4. Upstream tests that assert away allone's build

Upstream tests sometimes assert a module allone hides is enabled. Behaviour is correct; the test
encodes an upstream assumption. **Rewrite the assertion to cover allone's precedence** (hidden
sections outrank the edition switch) rather than deleting or weakening it.

Also grep for strings upstream renamed that only exist in allone (`STANDALONE_SECTION_LABELS`, the
command palette, Signal Board pages) — upstream's rename cannot reach those:

```bash
grep -rn "<the old label>" src/ --include=*.ts --include=*.tsx
```

## 5. Verify (all four, before committing)

```bash
npx tsc -b            # must be clean
npm test              # all tests pass
npm run lint          # 0 errors; warnings must stay under the --max-warnings cap in package.json
npm run build         # production build succeeds
```

Also review what auto-merged without conflicting (`git diff HEAD -- src/`) — silently merged hunks
are where a stray hex or a rule violation slips in.

## 6. Commit

Follow the established merge-commit convention (see `git log --merges`): subject
`Merge upstream performance-plus (N commits) into the allone build`, then a body stating the
upstream SHA merged, where the fork had diverged, and a bullet **per conflicted file** naming what
was kept and what was taken. Close with the verification line (`tsc -b`, N tests, eslint counts,
production build). Add the attribution trailers the session specifies.

## 7. Push and deploy — only when asked

Both are outward-facing; do not do either unless the user asks.

- Push: `git push origin main`.
- Deploy: if the merge touched `functions/`, hosting alone will not make that change live — ask
  whether to ship hosting only (`npm run firebase:deploy`) or hosting + functions + rules
  (`npm run firebase:deploy:full:staging`), and say what stays undeployed either way.
- After deploying, confirm the live entry document is this build, not a cached one:

```bash
curl -sS -D- -o /tmp/live.html https://allone-9e685.web.app/ | grep -i 'cache-control\|HTTP/'
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /tmp/live.html dist/index.html   # hashes must match
```
