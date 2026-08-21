# Performance+ — project instructions

## UI rules (v2)

Authoritative sources: `performance-plus-redesign-ui-brief.md` for behaviour and phasing,
`colors.md` for the palette. Where they disagree, `colors.md` wins — it replaces §4 of the brief and
withdraws the dark canvas in favour of a white background.

### Brand palette (v2 — light theme)

- Base is a **white** background (`--surface-0`), not a dark canvas.
- **Navy `#003087`** — text, headings, **navigation**, branding. Never a large-surface background.
  Navigation means the label and the active-item wash, not a navy sidebar; the chrome surface stays
  white. All of it routes through the `--chrome-*` tokens, so it is one block to change, not a sweep.
- **Orange `#FE630C`** — the single primary-action colour. On white it measures 3.00:1, so it is
  never body text: use `--orange-700` (5.61:1) for orange text. `--nts-accent-text` exists for exactly this reason; do not "simplify" it back   to `--nts-accent`.
- **Gold `#FEC405`** — badge and highlight backgrounds only. Never text (1.60:1). Put navy on top.
- **Sky `#005ECD`** — links, secondary CTA, info states.
- The four brand colours are sampled from the logo and are fixed. A fifth "active" colour is not
  added; reuse one of the four at a different intensity.
- Before adding any colour: is there already a tint or shade in `src/styles/tokens.css` that
  covers it? If yes, use it. A new hex needs a reason.

### Tokens

- Every colour comes from `src/styles/tokens.css`. **No hex values inside components.**
- The `--nts-*` names are a legacy bridge that re-points ~4.000 pre-existing hardcoded colours at
  the new palette. Migrate components to the real tokens as you touch them; the bridge should
  shrink over time.
- Every numeric field carries `font-variant-numeric: tabular-nums` — use `.metric`, `.kpi-value`
  or `data-numeric`, which already apply it.
- Any imported component is recoloured with these tokens before it is committed. An import that
  still shows its own default colours is not finished.

### Component sourcing

- Look for something ready first: `npx shadcn search @tremor -q "<keyword>"`.
- Base: shadcn/ui + Tremor. Accents: Magic UI, Motion Primitives — and only in the two places the
  brief names (ROI counters, Morning Briefing).
- Charts: Tremor for standard ones, Nivo for radar / sankey / treemap.
- Write a custom component only when the search returns nothing suitable, and say what you searched.
- Do not mix more than three registries, and avoid "cinematic" libraries such as Aceternity — they
  read as decoration in a decision tool.

### Motion

- Only Motion or `@formkit/auto-animate`. No scattered CSS keyframes.
- Three durations, and nothing else: **150ms** state / **300ms** reorder / **450ms** reveal (once).
  They exist as `--dur-state`, `--dur-reorder`, `--dur-reveal` with `--ease-out`.
- `prefers-reduced-motion` is honoured globally in `tokens.css`; do not defeat it locally.
- Forbidden: parallax, particle backgrounds, glassmorphism, gradient meshes, infinite loops,
  typewriter effects.
- Motion is concentrated in the Strategy Weights Configurator. Spread evenly across every module,
  it reads as a template.

### Hidden sections

Sections switched off for this build are listed in `HIDDEN_SECTIONS` (`src/config/modules.ts`).
Nothing is deleted — removing an id restores the section. When adding a link from one section to
another, guard it with `isSectionHidden()` so the reduced build stays free of dead links.

### Workflow

- Before writing code for a new module: present a design plan (tokens used, layout, signature
  element) and wait for approval.
- After implementing: screenshot it, assess it yourself, fix what is wrong, then hand it over.
- Update `/styleguide` with every new component — it is the consistency checkpoint for every phase.
- Requests are phrased as concrete behaviour, never as "make it more impressive".

### Quality bar (non-negotiable)

- Responsive down to 375px.
- Visible keyboard focus on every interactive element.
- Text contrast ≥ 4.5:1 — `/styleguide` computes this live, so check it there.
- No layout shift while data loads: skeletons with fixed dimensions.
- Tables over 200 rows are virtualized.

## Repository

Push only to `markot84/allone`. The sibling checkout `~/projects/makis/performance-plus` is the
client's repo (`makis-nts/performance-plus`) and must not receive pushes. It is wired here as the
fetch-only remote `upstream` (push URL `no_push`), which is how upstream work is merged in — read
from it freely, never write to it.

Never deploy to the client's Firebase projects — `performance-plus-4a5b2` (production) or
`performanceplus-staging`. The signed-in Firebase account can reach both, so the only thing keeping
a deploy inside allone is `.firebaserc`, where `default`, `staging` and `production` all resolve to
`allone-9e685`. Deploy through the `npm run firebase:deploy*` scripts, which pass an alias; never
pass a raw project id.
