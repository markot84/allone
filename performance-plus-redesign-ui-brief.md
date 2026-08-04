# Performance+ Enterprise — UI Redesign Brief

**Έκδοση:** v2 UI
**Παραλήπτης:** Development team
**Stack:** React 18 + TypeScript + Tailwind, ανάπτυξη με Claude Code
**Ημερομηνία:** Αύγουστος 2026

---

## 1. Στόχος

Η υπάρχουσα εφαρμογή λειτουργεί σωστά ως εργαλείο. Το v2 UI στοχεύει σε δύο πράγματα ταυτόχρονα:

1. **Demo value** — η εφαρμογή παρουσιάζεται ζωντανά σε ιδιοκτήτες e-shop. Η πρώτη εντύπωση κρίνει το πώς γίνεται αντιληπτή η αξία.
2. **Καθημερινή χρηστικότητα** — παραμένει εργαλείο λήψης αποφάσεων, όχι showcase. Ο θόρυβος κοστίζει.

Η ισορροπία λύνεται με μία αρχή: **η εντύπωση συγκεντρώνεται σε ένα σημείο, τα υπόλοιπα μένουν ήσυχα και πειθαρχημένα.**

---

## 2. Η κεντρική σχεδιαστική αρχή

Ένα εργαλείο απόφασης δεν εντυπωσιάζει με διάχυτα animations. Εντυπωσιάζει όταν ο χρήστης βλέπει **τη συνέπεια μιας δικής του επιλογής** να εκτυλίσσεται σε πραγματικό χρόνο.

Το signature moment της εφαρμογής είναι ο **Strategy Weights Configurator**. Εκεί συγκεντρώνεται η επένδυση σε κίνηση και λεπτομέρεια. Παντού αλλού: διακριτικές μεταβάσεις, καθαρή τυπογραφία, μηδέν διακόσμηση.

Αν η κίνηση απλωθεί ομοιόμορφα σε όλα τα modules, το αποτέλεσμα διαβάζεται ως template.

---

## 3. Component sourcing — πολιτική

Δεν γράφεται custom component πριν ελεγχθεί αν υπάρχει έτοιμο.

### Βάση (μία οπτική γλώσσα)

| Πηγή | Ρόλος | Εγκατάσταση |
|---|---|---|
| **shadcn/ui** | Primitives (button, dialog, table, command, tabs) | `npx shadcn@latest init` |
| **Tremor** | KPI cards, charts, trackers, sparklines, data bars | `npx shadcn@latest add @tremor/<block>` |

Το Tremor ανήκει πλέον στη Vercel και τα Blocks (300+ sections) είναι δωρεάν/open source. Χρησιμοποιεί Recharts εσωτερικά — δεν αλλάζει το υπάρχον stack. Το vocabulary του (KPI cards, spark lines, trackers) καλύπτει σχεδόν πλήρως τα modules Dashboard, Product Intelligence και ROI Attribution.

### Accents (μόνο σε 2 σημεία)

| Πηγή | Χρήση | Πού |
|---|---|---|
| **Magic UI** | `NumberTicker`, `AnimatedBeam` | ROI counters, cascade indicators |
| **Motion Primitives** | scroll reveals, text effects | Morning Briefing |

Εγκατάσταση: `npx shadcn@latest add @magicui/number-ticker`

### Εξειδικευμένα γραφήματα

Δεν γράφεται custom D3 για τα παρακάτω — υπάρχουν έτοιμα στο **Nivo**:

- `@nivo/radar` → πεντάγωνο των 5 παραγόντων στον Weight Configurator
- `@nivo/sankey` → segment migration flow
- `@nivo/treemap` → RFM segments overview

### Λοιπές εξαρτήσεις

```bash
npm i motion @formkit/auto-animate @nivo/radar @nivo/sankey @nivo/treemap
npm i @tanstack/react-table @tanstack/react-virtual cmdk
```

### Τι αποφεύγουμε

- **Aceternity UI** και παρόμοια «κινηματογραφικά» libraries — δεν ταιριάζουν σε εργαλείο απόφασης
- Ανάμειξη περισσότερων από 3 registries — το αποτέλεσμα διαβάζεται ως συρραφή
- Οποιοδήποτε εισαγόμενο component μένει με τα default χρώματά του

---

## 4. Design tokens

Όλα τα χρώματα και οι τυπογραφικές τιμές ζουν σε ένα αρχείο. Καμία τιμή hex μέσα σε component.

`src/styles/tokens.css`:

```css
:root {
  /* Brand — αμετάβλητο */
  --nts-orange:        #FF6B35;
  --nts-orange-hover:  #FF8C5A;
  --nts-orange-muted:  rgba(255, 107, 53, 0.12);

  /* Dark canvas — νέο, προεπιλογή για dashboard */
  --surface-0:  #0E0F12;  /* app background */
  --surface-1:  #16181D;  /* cards */
  --surface-2:  #1F222A;  /* elevated / hover */
  --border:     #2A2E38;

  --text-primary:   #F2F4F7;
  --text-secondary: #9BA3B0;
  --text-muted:     #6B7280;

  /* Semantic */
  --positive: #35D07F;
  --caution:  #F5A524;
  --negative: #F04438;
  --neutral:  #5B8DEF;

  /* RFM segments */
  --seg-champions: #35D07F;
  --seg-loyal:     #5B8DEF;
  --seg-potential: #9B7BF7;
  --seg-at-risk:   #F5A524;
  --seg-lost:      #6B7280;

  /* Motion */
  --dur-state:   150ms;  /* hover, toggle, focus */
  --dur-reorder: 300ms;  /* αναδιάταξη λιστών */
  --dur-reveal:  450ms;  /* scroll reveal, μία φορά */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
}
```

**Σημείωση για τη σκούρα βάση:** τα δεδομένα κερδίζουν αντίθεση και το πορτοκαλί αποκτά ένταση χωρίς να χρειάζεται να μεγαλώσει. Διατηρείται φωτεινή έκδοση αποκλειστικά για τις εξαγόμενες αναφορές (PDF/print), όχι ως εναλλακτικό theme της εφαρμογής σε πρώτη φάση.

### Τυπογραφία

| Ρόλος | Γραμματοσειρά | Βάρη |
|---|---|---|
| Display / headings | Plus Jakarta Sans | 600, 700 |
| Body / UI | Inter | 400, 500 |
| Data / metrics | JetBrains Mono | 400, 500 |

**Υποχρεωτικό σε κάθε αριθμητικό πεδίο:**

```css
.metric, td[data-numeric], .kpi-value {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
```

Χωρίς αυτό, οι αριθμοί «χοροπηδούν» σε κάθε ενημέρωση. Είναι η μικρότερη αλλαγή με τη μεγαλύτερη διαφορά στην αντιληπτή ποιότητα.

---

## 5. Προδιαγραφές ανά module

### 5.1 Strategy Weights Configurator — ΠΡΟΤΕΡΑΙΟΤΗΤΑ 1

Το signature module. Εδώ πηγαίνει ο περισσότερος χρόνος.

**Απαιτήσεις:**

1. **Μηδενική καθυστέρηση.** Κανένα κουμπί «Εφαρμογή». Το slider κινείται → όλα ξαναϋπολογίζονται. Debounce στα 60ms το μέγιστο, μόνο για την αποφυγή υπερβολικών re-renders.

2. **Radar των 5 παραγόντων**, συγχρονισμένο αμφίδρομα με τα sliders. Ο χρήστης αναγνωρίζει το «σχήμα» της στρατηγικής του. Υλοποίηση με `@nivo/radar`, animated transitions ενεργά.

3. **Αναδιάταξη με κίνηση θέσης.** Η λίστα Top Products δεν εξαφανίζεται/επανεμφανίζεται — τα στοιχεία ταξιδεύουν στη νέα τους θέση.

```tsx
import { useAutoAnimate } from '@formkit/auto-animate/react'

const [listRef] = useAutoAnimate({ duration: 300, easing: 'ease-out' })
// <ul ref={listRef}> ... </ul>
```

Δίπλα σε κάθε προϊόν, δείκτης μεταβολής θέσης: `↑ 12` / `↓ 4` / `–`, με χρώμα `--positive` / `--negative` / `--text-muted`.

4. **Cascade indicators.** Μόλις σταθεροποιηθεί μια αλλαγή βάρους, «φωτίζονται» διαδοχικά τα επηρεαζόμενα modules στο sidebar με απόσταση ~120ms μεταξύ τους:

```
Στρατηγική → Προϊόντα → Κανάλια → Περιεχόμενο
```

Υλοποίηση με `AnimatedBeam` (Magic UI) ή απλό staggered pulse. Αυτό είναι το οπτικό επιχείρημα της ενοποίησης των εργαλείων — το πιο σημαντικό μήνυμα της παρουσίασης.

5. **Ghost state.** Κατά τη διάρκεια της μετάβασης, ημιδιαφανές αποτύπωμα της προηγούμενης κατάταξης (opacity 0.25) που σβήνει στα 400ms. Κάνει ορατό το πριν/μετά χωρίς δεύτερη οθόνη.

**Acceptance:** ο θεατής, χωρίς εξήγηση, καταλαβαίνει ότι μετακίνησε ένα slider και άλλαξε η εμπορική προτεραιότητα.

---

### 5.2 Morning Briefing — ΠΡΟΤΕΡΑΙΟΤΗΤΑ 2

Η παράγραφος γίνεται πλοήγηση, όχι στατικό κείμενο.

- Κάθε **αριθμός** μέσα στο briefing: hover → popover με το υποκείμενο δεδομένο (πηγή, περίοδος, μεταβολή)
- Κάθε **οντότητα** (segment, κατηγορία, SKU, κανάλι): click → μετάβαση στο αντίστοιχο module με shared-element transition
- Εμφάνιση με progressive reveal (staggered, ~40ms ανά φράση) **μόνο στην πρώτη φόρτωση της ημέρας**, όχι σε κάθε επίσκεψη

Το markup παράγεται με tokens από το backend/mock layer:

```ts
type BriefingToken =
  | { kind: 'text';   value: string }
  | { kind: 'metric'; value: string; source: string; delta?: number }
  | { kind: 'entity'; value: string; module: string; id: string }
```

Αποφεύγεται το typewriter effect — διαβάζεται ως gimmick.

---

### 5.3 RFM Analysis

- Αντικατάσταση των 5 στατικών καρτών με **treemap** (`@nivo/treemap`): εμβαδόν = πλήθος καταναλωτών, ένταση χρώματος = μερίδιο τζίρου
- Click σε segment → drill-down με shared-element transition (το πλακίδιο «ανοίγει» στη σελίδα λεπτομέρειας)
- **Migration Sankey** (`@nivo/sankey`) που σχεδιάζεται σταδιακά όταν μπαίνει στο viewport — μία φορά ανά session

### 5.4 Product Intelligence

- `@tanstack/react-table` + `@tanstack/react-virtual` (4.500+ SKUs)
- Inline sparklines ανά γραμμή (Tremor `SparkAreaChart`)
- Sorting → ζωντανή αναδιάταξη με auto-animate, ίδια συμπεριφορά με τον Configurator
- Stock level ως data bar, stock age με χρωματική κλίμακα `--positive` → `--caution` → `--negative`

### 5.5 ROI Attribution

- Waterfall που χτίζεται σταδιακά (stagger 150ms ανά στοιχείο) στην είσοδο στο viewport
- KPI values με `NumberTicker` (Magic UI), **μία φορά** ανά session — όχι σε κάθε re-render
- Methodology panel collapsible, κλειστό by default

### 5.6 Καθολικά

**Command palette (Cmd+K / Ctrl+K)** με `cmdk`:
- Μετάβαση σε module
- Άμεση αλλαγή σεναρίου στρατηγικής
- Αναζήτηση SKU / segment
- Εξαγωγή αναφοράς

Αποδίδει δυσανάλογα: δίνει αίσθηση επαγγελματικού εργαλείου με ελάχιστο κόστος υλοποίησης.

---

## 6. Πειθαρχία κίνησης

Τρεις κατηγορίες μόνο. Ό,τι δεν εμπίπτει σε αυτές, δεν μπαίνει.

| Κατηγορία | Διάρκεια | Πού |
|---|---|---|
| State transition | 150ms | hover, focus, toggle, tab switch |
| Reorder | 300ms | λίστες, πίνακες, κατατάξεις |
| Reveal | 450ms, μία φορά | charts στο viewport, briefing |

**Υποχρεωτικό:**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Απαγορεύονται: parallax, particle backgrounds, glassmorphism, gradient meshes, infinite loops οποιουδήποτε είδους.

---

## 7. Σειρά υλοποίησης

Ένα module τη φορά, ξεχωριστό branch ανά φάση. Ολική ανακατασκευή σε μία κίνηση καταλήγει σε ασυνέπειες.

| Φάση | Περιεχόμενο | Branch |
|---|---|---|
| 0 | Tokens, γραμματοσειρές, `/styleguide` route, shadcn+Tremor init | `feat/design-system` |
| 1 | Strategy Weights Configurator (πλήρες) | `feat/weights-v2` |
| 2 | Morning Briefing διαδραστικό | `feat/briefing-v2` |
| 3 | RFM (treemap + sankey) | `feat/rfm-v2` |
| 4 | Product Intelligence (virtualized) | `feat/products-v2` |
| 5 | ROI Attribution | `feat/roi-v2` |
| 6 | Command palette + περάσματα συνέπειας | `feat/polish` |

**Φάση 0 πρώτα, χωρίς εξαίρεση.** Το `/styleguide` route (όλα τα components σε μία σελίδα) γίνεται το σημείο ελέγχου συνέπειας για κάθε επόμενη φάση.

---

## 8. Ρύθμιση Claude Code

### 8.1 Playwright MCP

Εγκατάσταση απαραίτητη. Χωρίς οπτική ανάδραση ο agent εργάζεται στα τυφλά — δεν μπορεί να κρίνει αποστάσεις, αντιθέσεις ή στοίχιση. Με screenshots, διορθώνει μόνος του πριν παραδώσει.

### 8.2 `CLAUDE.md` — προσθήκη στη ρίζα του project

```markdown
## UI rules (v2)

### Component sourcing
- Πρώτα ψάξε έτοιμο: `npx shadcn search @tremor -q "<keyword>"`
- Βάση: shadcn/ui + Tremor. Accents: Magic UI, Motion Primitives.
- Charts: Tremor για standard, Nivo για radar/sankey/treemap.
- Custom component γράφεται μόνο αν η αναζήτηση δεν επιστρέψει
  κατάλληλο αποτέλεσμα. Ανάφερε τι έψαξες.

### Tokens
- Κάθε χρώμα από src/styles/tokens.css. Καμία τιμή hex σε component.
- Κάθε αριθμητικό πεδίο: font-variant-numeric: tabular-nums.
- Κάθε εισαγόμενο component ξαναβάφεται με τα tokens πριν το commit.

### Motion
- Μόνο Motion ή @formkit/auto-animate. Όχι διάσπαρτα CSS keyframes.
- Τρεις διάρκειες: 150ms state / 300ms reorder / 450ms reveal.
- prefers-reduced-motion υποστηρίζεται παντού.
- Απαγορεύονται: parallax, particles, glassmorphism, infinite loops.

### Workflow
- Πριν από κώδικα σε νέο module: παρουσίασε σχεδιαστικό πλάνο
  (tokens που χρησιμοποιούνται, διάταξη, signature element) και
  περίμενε έγκριση.
- Μετά την υλοποίηση: screenshot μέσω Playwright, αυτοαξιολόγηση,
  διόρθωση, και μετά παράδοση.
- Ενημέρωσε το /styleguide route με κάθε νέο component.
```

### 8.3 Τι **δεν** ζητάμε από τον agent

Η εντολή «κάνε το πιο εντυπωσιακό» παράγει gradients, glassmorphism και particle backgrounds. Κάθε αίτημα διατυπώνεται ως συγκεκριμένη συμπεριφορά:

> ❌ «Κάνε τον Weight Configurator πιο εντυπωσιακό»
> ✅ «Όταν αλλάζει ένα slider, η λίστα Top Products αναδιατάσσεται με auto-animate 300ms και κάθε γραμμή δείχνει δείκτη μεταβολής θέσης»

---

## 9. Ποιοτικός πήχης (μη διαπραγματεύσιμος)

- Responsive έως 375px πλάτος — η παρουσίαση γίνεται και από tablet
- Ορατό keyboard focus σε κάθε διαδραστικό στοιχείο
- `prefers-reduced-motion` σεβαστό
- Αντίθεση κειμένου ≥ 4.5:1 στη σκούρα βάση
- Κανένα layout shift κατά τη φόρτωση δεδομένων — skeleton loaders με σταθερές διαστάσεις
- Πίνακες > 200 γραμμών: υποχρεωτικά virtualized

---

## 10. Κριτήριο επιτυχίας

Ένας ιδιοκτήτης e-shop, χωρίς τεχνικό υπόβαθρο, μετακινεί ένα slider στον Weight Configurator και **καταλαβαίνει μόνος του** ότι μόλις άλλαξε την εμπορική προτεραιότητα της επιχείρησής του — χωρίς να του εξηγηθεί.

Αν αυτό λειτουργεί, η υπόλοιπη εφαρμογή χρειάζεται μόνο συνέπεια.

---

3 σημεία που αξίζει να δοθει ιδιαίτερη βαρύτητα!!

	•	Η Φάση 0 δεν παρακάμπτεται — χωρίς tokens και /styleguide route, κάθε επόμενο module αποκλίνει οπτικά και το κόστος διόρθωσης πολλαπλασιάζεται.
	•	Το Playwright MCP είναι προϋπόθεση, όχι προαιρετικό. Είναι η διαφορά ανάμεσα σε agent που κρίνει το αποτέλεσμά του και σε agent που παράγει κώδικα στα τυφλά.
	•	Το κριτήριο επιτυχίας (§10) είναι το μόνο που μετράει στην παραλαβή. Όλα τα υπόλοιπα είναι μέσα για να το πετύχει.


*Not The Same — Marketing & AI Powered Data Lab*
*www.notthesame.gr · info@notthesame.gr*
