# Performance+ Enterprise Dashboard

A modern, enterprise-grade dashboard application for marketing performance management and customer segmentation.

## Features

- **Strategy Weights Configurator**: Configure product prioritization factors
- **RFM Analysis**: Customer segmentation insights
- **Product Intelligence**: Inventory & product performance
- **Channel Activation**: AI-powered channel recommendations
- **Content Strategy**: Align content with commercial strategy
- **ROI Attribution**: Measure Performance+ impact
- **AI Insights**: Actionable recommendations

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Recharts
- Framer Motion
- Primer React (GitHub Design System)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Firebase Hosting + Cloud Functions + Firestore. **Two independent switches govern a deploy** — they must agree:

- **What the bundle talks to** (baked at build time): the `.env` `VITE_FIREBASE_*` config, selected by the Vite build mode — `npm run build` = **staging** config, `npm run build:production` = **production** config.
- **Where the artifacts are uploaded** (deploy time): the Firebase CLI `--project` flag, resolved via `.firebaserc` (`staging` → `performanceplus-staging`, `production` → `performance-plus-4a5b2`).

Mixing them (e.g. a staging-mode build deployed to production) ships the wrong Firebase config to the live site. The npm scripts pair them correctly:

**Setup:** `npm install -g firebase-tools` then `firebase login`.

| Command | Build mode | Target (`--project`) | Scope |
|---|---|---|---|
| `npm run firebase:deploy` | staging | staging | hosting only |
| `npm run firebase:deploy:functions` | — | staging | functions only |
| `npm run firebase:deploy:full` (= `:full:staging`) | staging | staging | everything |
| `npm run firebase:deploy:full:production` | production | production | everything |
| `npm run deploy:full` | staging | staging | everything, then `git add -u` + commit + push |

**Live URLs:** staging `https://performanceplus-staging.web.app` · production `https://performance-plus-4a5b2.web.app`.
