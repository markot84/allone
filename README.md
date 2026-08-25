# allone

A marketing and data-analysis dashboard: customer segmentation, campaign and channel
performance, product intelligence and commercial strategy.

Forked from a client product called Performance+, whose name survives in some filenames.

## Sections

The visible build is the Marketing & Data Analysis product — eleven sections:

Dashboard · Data Analysis (RFM) · Competitive Intelligence · Commercial Strategy · Campaigns ·
E-commerce · Web Analytics (GA4) · Brand Profile · Content Strategy · Product Intelligence ·
Data Import

Nineteen further sections exist in the codebase, compile, and are switched off through
`HIDDEN_SECTIONS` in `src/config/modules.ts`. Nothing was deleted — removing an id restores a
section.

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Recharts
- Framer Motion
- Primer React (GitHub Design System)

## Development

**[DEVELOPING.md](DEVELOPING.md) is the full guide** — setup, local development, commit conventions
and deploys. The short version:

```bash
nvm use 22                     # Node 22 is required
npm install
(cd functions && npm install)
cp .env.example .env           # real values from Marios
npm run dev                    # http://localhost:5173
```

## Checks

```bash
npm run lint     # passes at <=415 warnings
npm test
npm run build    # dev does not typecheck; this does
```

## Deploy

One Firebase project, `allone-9e685`, serving **https://allone-9e685.web.app**. The `staging` and
`production` aliases in `.firebaserc` both resolve to it — they select a *build mode*, not an
environment, and only decide whether tracking pixels load. A deploy is always live.

**Setup:** `npm install -g firebase-tools`, then `firebase login`.

| Command | Deploys |
|---|---|
| `npm run firebase:deploy` | hosting (the usual one) |
| `npm run firebase:deploy:functions` | functions |
| `npm run firebase:deploy:full` | hosting + functions + Firestore and storage rules |
| `npm run firebase:deploy:full:production` | the same, built in production mode |
| `npm run deploy:full` | full deploy, then commits and pushes tracked changes |

**Never deploy to `performance-plus-4a5b2` or `performanceplus-staging`** — those are the client's
live projects and the signed-in account can reach them. Always deploy through the
`npm run firebase:deploy*` scripts; never a bare `firebase deploy` or a raw `--project <id>`.
