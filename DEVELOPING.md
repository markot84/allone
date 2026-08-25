# allone — developing, committing and deploying

Everything you need to go from a fresh clone to a live deploy. Read it once end to end before
your first change; after that the tables are the only part you'll come back to.

The app is **allone** (`markot84/allone`), a marketing and data-analysis dashboard built on
React 19 + TypeScript + Vite, with Firebase for auth, Firestore, storage and Cloud Functions.
It is a fork of a client product called Performance+ — that name still appears in some filenames
and older docs. Anything user-facing says allone.

---

## 1. Before you start

You need four things. The first two you install, the last two someone has to give you.

| | What | How to get it |
|---|---|---|
| 1 | **Node 22** (`node -v` → `v22.x`) | [nvm](https://github.com/nvm-sh/nvm): `nvm install 22 && nvm use 22`. Not optional — the build and the functions both pin 22. |
| 2 | **Firebase CLI** | `npm install -g firebase-tools`, then `firebase login` |
| 3 | **Write access to `markot84/allone`** | Ask Marios |
| 4 | **The `.env` file** | Ask Marios. It is gitignored on purpose and never travels through the repo — expect it over a private channel. |

On `.env`: `.env.example` is committed and lists all 13 variables with comments. If you'd rather
build your own, the six `VITE_FIREBASE_*` values come from Firebase Console → project
`allone-9e685` → Project settings → Your apps. The rest are already filled in in the example.

---

## 2. First-time setup

```bash
git clone https://github.com/markot84/allone.git
cd allone
nvm use 22

npm install                  # app dependencies
(cd functions && npm install)  # Cloud Functions — separate package, easy to forget

cp .env.example .env         # then paste in the real values
```

Then check it works:

```bash
npm run dev
```

Vite serves on **http://localhost:5173** and hot-reloads on save. It talks to the **real**
`allone-9e685` Firebase project — there is no separate dev backend, so what you see is live data
and what you write is written for real. The emulators are only wired up for the rules and
integration tests (§4), not for day-to-day development.

Two pages worth knowing about immediately:

- **`/styleguide`** — every shared component, with live contrast ratios. This is the consistency
  checkpoint: when you add a component, it goes here the same day.
- **the dashboard** — the Signal Board, which is the design language everything else follows.

---

## 3. Working with Claude Code

`CLAUDE.md` in the repo root loads automatically every time you start Claude Code here. It is the
design rulebook — palette, tokens, motion, component sourcing, the quality bar — and it is written
as instructions to Claude, not as background reading. You mostly don't need to repeat any of it in
your prompts; Claude already has it.

What that means in practice:

- **Ask for concrete behaviour, not vibes.** "The KPI row keeps its height while data loads" gets
  you somewhere. "Make the dashboard more impressive" gets you a template.
- **Colours come from tokens.** If Claude reaches for a new hex, push back — `src/styles/tokens.css`
  almost certainly has a tint that covers it.
- **New components go in `src/components/signal/`** if two pages would want them, and into
  `/styleguide` either way.
- **If you change how the project actually works** — a new library, a moved folder, a changed
  convention — update `CLAUDE.md` in the same commit. A rulebook that describes a project that no
  longer exists is worse than none, because Claude follows it confidently.

---

## 4. Checks before you commit

Run these three. They take about a minute together and they are what stands between you and a
broken deploy.

```bash
npm run lint     # eslint, passes at ≤415 warnings
npm test         # vitest unit tests
npm run build    # tsc -b && vite build — catches type errors the dev server tolerates
```

`npm run build` is the important one: `npm run dev` does not typecheck, so a change can look
perfect in the browser and still fail the build.

The lint threshold is a ratchet on inherited warnings. **Don't raise the 415** to make lint pass —
if your change adds warnings, fix them; if you remove some, lowering the number is welcome.

Heavier suites, for when you touch security rules or functions:

```bash
npm run test:rules      # Firestore rules, against the emulator
npm run test:functions  # Cloud Functions
npm run test:all        # all three
```

---

## 5. Commit and push

Work on a branch, not on `main` directly:

```bash
git checkout -b feat/what-it-does
# ... changes, then §4 checks ...
git add -p                       # review as you stage; -p, not -A
git commit
git push -u origin feat/what-it-does
```

Then open a PR on GitHub, or merge locally once you're happy:

```bash
git checkout main
git pull
git merge feat/what-it-does
git push origin main
```

**Commit messages** follow `type(scope): what changed, in plain words`. The repo's habit is a
full sentence in the subject describing the effect, not the mechanism:

```
feat(dashboard): the Morning Briefing opens expanded
fix(hosting): the SPA entry document was cached for an hour, so deploys went stale
docs(claude): the project rules describe the app that exists
```

Types in use: `feat`, `fix`, `chore`, `docs`, `perf`, `refactor`.

**Never commit:** `.env`, `.env.local`, `functions/.env`, anything under `.claude/`, credential
dumps, or a `Pasted image.png`. `git status` before every commit; `git add -p` rather than
`git add -A` keeps you honest.

---

## 6. Deploy

One Firebase project, `allone-9e685`, serving **https://allone-9e685.web.app**.

```bash
npm run firebase:deploy        # the usual one: builds and deploys hosting
```

That covers any frontend-only change, which is most of them. The full set:

| Command | Deploys | Use it when |
|---|---|---|
| `npm run firebase:deploy` | hosting | you changed the UI (the default) |
| `npm run firebase:deploy:functions` | functions | you changed `functions/` |
| `npm run firebase:deploy:full` | hosting + functions + Firestore rules + storage rules | you changed rules, or several of the above |
| `npm run firebase:deploy:full:production` | same, built in production mode | you want analytics/tracking pixels live |
| `npm run deploy:full` | full deploy, **then `git add -u`, commit and push for you** | you know that's what you want |

Two things that surprise people:

- **`staging` and `production` are build modes, not environments.** All three aliases in
  `.firebaserc` resolve to the same project, `allone-9e685`, and there is one `.env`. The only
  practical difference is that production mode loads the tracking pixels. There is no safe staging
  site to try a deploy on — a deploy is live.
- **`deploy:full` touches git.** It commits your tracked changes and pushes them. Fine when
  deliberate, startling otherwise.

After deploying, hard-refresh (Ctrl/Cmd+Shift+R). `index.html` is served no-cache so you should
get the new build immediately, but the browser is not always listening.

### The one hard rule

**Never deploy to `performance-plus-4a5b2` or `performanceplus-staging`.** Those are the *client's*
live Firebase projects, and the signed-in account can reach them. The only thing keeping a deploy
inside allone is `.firebaserc` and the fact that every npm script passes an alias.

So: **always deploy through the `npm run firebase:deploy*` scripts.** Never run a bare
`firebase deploy`, and never pass a raw `--project <id>`. There is no reason you'd need to, and
the failure mode is overwriting a client's production site.

Same rule for git: push only to `origin` (`markot84/allone`). If you ever see a remote called
`upstream`, it is the client's repo — read-only, never push, and don't add one if it isn't there.

---

## 7. When something breaks

| Symptom | Cause |
|---|---|
| `npm install` fails oddly | Wrong Node. `node -v` must be v22 — `nvm use 22` |
| Blank page, console full of Firebase errors | `.env` missing or incomplete |
| Functions fail to deploy | You skipped `cd functions && npm install` |
| `firebase deploy` says permission denied | `firebase login`, and check you have access to `allone-9e685` |
| Build fails but dev server was fine | Type error — dev doesn't typecheck. Read the `tsc` output |
| Deployed but seeing the old site | Hard-refresh. If it persists, check the deploy actually finished |
| Rules tests hang | Java missing — the Firestore emulator needs a JDK |

---

## Reference

| File | What it is |
|---|---|
| `CLAUDE.md` | the design rulebook Claude Code reads automatically |
| `colors.md` | the palette, with contrast measurements — authoritative on colour |
| `performance-plus-redesign-ui-brief.md` | the original redesign brief: behaviour and phasing |
| `PARADOTEO.md` | delivery summary of the redesign work (Greek) |
| `.env.example` | every environment variable, documented |
| `src/styles/tokens.css` | every colour, duration and easing in the app |
| `src/components/signal/` | the shared design language |
| `src/config/modules.ts` | which sections are switched on for this build |
