# Priority Weights — Οδηγός Λειτουργίας

**Commercial Strategy · Performance+** | Εσωτερικός Οδηγός

---

## 1. Τι είναι

Κάθε προϊόν στο σύστημα λαμβάνει ένα **Composite Score (0–100)** — έναν ενιαίο βαθμό προτεραιότητας. Ο βαθμός αυτός καθορίζει **ποια προϊόντα πρέπει να προωθηθούν** σε campaigns, product feeds και ενέργειες marketing.

Τα **Priority Weights** ελέγχουν πόσο μετράει ο κάθε παράγοντας στον υπολογισμό αυτού του βαθμού. Ο χρήστης επιλέγει στρατηγική (ή ρυθμίζει custom sliders) και τα weights αθροίζουν **πάντα σε 100%**.

---

## 2. Οι 5 Παράγοντες Βαθμολόγησης

| # | Παράγοντας | Τι μετράει | Πηγή δεδομένων |
|---|-----------|-----------|---------------|
| 1 | **Profitability** 💰 | Gross margin ανά προϊόν | `margin_percentage` → κανονικοποίηση: margin / 60 × 100 (cap 0–100) |
| 2 | **Inventory** 📦 | Κατάσταση αποθέματος — πόσο κοντά στο ιδανικό | `days_of_stock` vs `TOD` ανά προμηθευτή (βλ. §3) |
| 3 | **Strategic** 🎯 | Στρατηγική σημασία (brand push, new launch κλπ.) | `priority_tag` → Brand Push: 90, New Launch: 85, Best Seller: 75, Clearance: 65, χωρίς tag: 50 |
| 4 | **Revenue** 📈 | Τιμή / revenue potential | `price` → κανονικοποίηση: price / 500 × 100 (cap 0–100) |
| 5 | **Customer Fit** 👥 | Ταίριασμα με segments πελατών | Segment affinities (μέσος όρος). Default: 50 |

Κάθε παράγοντας παράγει ένα **sub-score 0–100** πριν εφαρμοστούν τα weights.

---

## 3. Ο Inventory Score — Αναλυτικά

Αυτός είναι ο πιο σύνθετος παράγοντας γιατί συνδυάζει δύο μετρικές.

### 3.1 Days of Stock (DOS)

```
DOS = stock_level / (qty_sold_period / 30)
```

Μετράει **πόσες ημέρες θα κρατήσει το τρέχον απόθεμα** με τον τρέχοντα ρυθμό πωλήσεων. Αν δεν υπάρχουν πωλήσεις → DOS = ∞ (dead stock).

### 3.2 Target Days of Stock (TOD)

Ο επιθυμητός αριθμός ημερών αποθέματος — **ρυθμίζεται ανά προμηθευτή** στη σελίδα Προμηθευτών. Default: 60 ημέρες.

### 3.3 Υπολογισμός

| Μετρική | Τύπος | Λογική |
|---------|-------|--------|
| **stockScore** | `(1 − |DOS − TOD| / (TOD × 2)) × 100` | Πόσο κοντά στο ιδανικό: 100 = ακριβώς στο TOD, 0 = πολύ μακριά |
| **stockAgeScore** (κανονικά) | `100 − (DOS / (TOD × 2)) × 100` | Λιγότερες μέρες stock → υψηλότερο score |
| **stockAgeScore** (Stock Clearance) | `(DOS / (TOD × 2)) × 100` | Περισσότερες μέρες → υψηλότερο (θέλουμε να ξεφορτωθούμε) |
| **inventoryScore** | `(stockScore + stockAgeScore) / 2` | Μέσος όρος των δύο |

---

## 4. Ο Τύπος Composite Score

```
Composite Score = round(
    profitScore    × (profit_weight / 100)
  + inventoryScore × (stock_weight / 100)
  + strategicScore × (strategic_weight / 100)
  + revenueScore   × (revenue_weight / 100)
  + fitScore       × (fit_weight / 100)
)
```

Αποτέλεσμα: **ακέραιος 0–100**. Τα weights αθροίζουν πάντα σε 100, άρα πρόκειται ουσιαστικά για **σταθμικό μέσο όρο**.

---

## 5. Παράδειγμα Υπολογισμού

Προϊόν: Margin 30%, 45 days of stock (TOD=60), Priority Tag: "Brand Push", Τιμή €200

**Sub-scores:**

```
profitScore    = min(100, 30 / 60 × 100) = 50
inventoryScore = μ.ό.(stockScore, stockAgeScore) ≈ 85
strategicScore = Brand Push = 90
revenueScore   = min(100, 200 / 500 × 100) = 40
fitScore       = default = 50
```

**Composite Score ανά στρατηγική:**

| Στρατηγική | Weights (P/I/S/R/F) | Υπολογισμός | Score |
|-----------|---------------------|-------------|-------|
| Profit Maximization | 40 / 15 / 15 / 10 / 20 | 50×0.40 + 85×0.15 + 90×0.15 + 40×0.10 + 50×0.20 | **60** |
| Stock Clearance | 15 / 45 / 10 / 10 / 20 | 50×0.15 + 85×0.45 + 90×0.10 + 40×0.10 + 50×0.20 | **69** |
| Brand Launch | 10 / 10 / 50 / 10 / 20 | 50×0.10 + 85×0.10 + 90×0.50 + 40×0.10 + 50×0.20 | **72** |

> **Το ίδιο προϊόν βαθμολογείται διαφορετικά ανάλογα με τη στρατηγική.** Αυτή είναι η ουσία του μηχανισμού.

---

## 6. Προκαθορισμένα Σενάρια (Presets)

| Σενάριο | Profit | Stock | Strategic | Revenue | Fit | Διάρκεια |
|---------|--------|-------|-----------|---------|-----|----------|
| **Profit Maximization** | **40** | 15 | 15 | 10 | 20 | Ongoing |
| **Stock Clearance** | 15 | **45** | 10 | 10 | 20 | 30 ημέρες |
| **Brand Launch** | 10 | 10 | **50** | 10 | 20 | 60 ημέρες |
| **Revenue Push** | 15 | 15 | 15 | **35** | 20 | 90 ημέρες |
| **Custom** | Ελεύθερη ρύθμιση sliders | | | | | Ongoing |

---

## 7. Πού χρησιμοποιείται το Composite Score

| Σημείο | Πώς |
|--------|-----|
| **Product Table** (WeightConfigurator) | Live ranking — τα προϊόντα ταξινομούνται κατά score σε πραγματικό χρόνο |
| **Generate Product Feed** | Εξαγωγή CSV/XLSX ταξινομημένα κατά score → για χρήση σε ad platforms |
| **Compare Scenarios** | Side-by-side σύγκριση πώς αλλάζει η κατάταξη μεταξύ σεναρίων |
| **Strategy Impact Preview** | Ποια προϊόντα ανεβαίνουν/κατεβαίνουν αν αλλαχτεί στρατηγική |

---

## 8. Τι συμβαίνει όταν αποθηκεύεται μια στρατηγική

```
Αποθήκευση Στρατηγικής
  │
  ├── Αποθήκευση στο Firestore (active_strategies)
  │     └── weights, scenario, status, budget
  │
  ├── AI Generation (παράλληλα):
  │     ├── Channel Recommendations
  │     │     └── Ποια κανάλια, πόσο budget, γιατί
  │     └── Content Suggestions
  │           └── Τι περιεχόμενο να δημιουργηθεί
  │
  ├── Channel Activation ενεργοποιείται
  │     └── Budget allocation, per-channel actions
  │
  └── Dashboard ενημερώνεται
        └── Active strategy badge, AI Insights
```

---

## 9. Κατηγοριοποίηση Αποθέματος (Stock Health)

Με βάση το TOD κάθε προμηθευτή, τα προϊόντα κατηγοριοποιούνται αυτόματα:

| Κατηγορία | Κριτήριο | Σήμανση |
|-----------|----------|---------|
| 🟢 **Healthy Stock** | TOD/2 < Days of Stock ≤ TOD×2 | Ιδανικό εύρος |
| 🟡 **Low Stock** | Days of Stock ≤ TOD/2 | Κίνδυνος εξάντλησης |
| 🔴 **Excess Stock** | Days of Stock > TOD×2 | Πλεόνασμα — δεσμεύει κεφάλαιο |
| 🔴 **Dead Stock** | Μηδενικές πωλήσεις + υπάρχον stock | Clearance priority |

---

## 10. Σύνοψη

> **Τα Priority Weights ρυθμίζουν ποιος παράγοντας (κέρδος, απόθεμα, στρατηγική, revenue, πελάτες) μετράει περισσότερο στην αυτόματη κατάταξη προϊόντων. Αποτέλεσμα: τα campaigns και τα product feeds εστιάζουν στα σωστά προϊόντα ανάλογα με τον τρέχοντα επιχειρηματικό στόχο.**

---

*Performance+ by notthesame.ai · Internal Document*
