# Business Requirements για Strategy Scenarios

## Επισκόπηση

Το σύστημα Strategy Weights Configurator χρησιμοποιεί **5 βασικούς παράγοντες (factors)** για να υπολογίσει το **composite score** κάθε προϊόντος και να το προτεραιοποιήσει για marketing campaigns.

---

## 1. Οι 5 Παράγοντες (Weight Factors)

### 1.1 Profitability (Κερδοφορία)
**Τι χρειάζεται:**
- **Gross Margin %** ανά προϊόν (ή Net Margin αν διαθέσιμο)
- **Target margin thresholds:**
  - High margin: > X% (π.χ. >30%)
  - Medium margin: Y-Z% (π.χ. 15-30%)
  - Low margin: < Y% (π.χ. <15%)
- **Cost structure** (COGS, shipping, handling)

**Πώς χρησιμοποιείται:**
- Προϊόντα με υψηλό margin παίρνουν υψηλότερο score όταν το weight είναι υψηλό
- Σενάρια όπως "Profit Maximization" δίνουν 40% weight σε αυτόν τον παράγοντα

---

### 1.2 Inventory Optimization (Βελτιστοποίηση Αποθέματος)
**Τι χρειάζεται:**
- **Stock Level** (τρέχον απόθεμα)
- **Stock Capacity** (μέγιστο απόθεμα)
- **Stock Age** (ημέρες από τότε που ήρθε το απόθεμα)
- **Excess Stock Thresholds:**
  - Ποια προϊόντα θεωρούνται "excess" (>X% capacity)
  - Ποια προϊόντα είναι "low stock" (<Y% capacity)
  - Ποια προϊόντα είναι "dead stock" (>Z ημέρες)

**Πώς χρησιμοποιείται:**
- Προϊόντα με υψηλό stock level και age παίρνουν υψηλότερο score όταν το weight είναι υψηλό
- Σενάρια όπως "Stock Clearance" δίνουν 45% weight σε αυτόν τον παράγοντα

---

### 1.3 Strategic Priority (Στρατηγική Προτεραιότητα)
**Τι χρειάζεται:**
- **Brand Push Flags:** Ποια προϊόντα/brands θέλουμε να προωθήσουμε
- **New Launch Flags:** Νέα προϊόντα που μόλις κυκλοφόρησαν
- **Supplier Deals:** Προϊόντα με ειδικές συμφωνίες με suppliers
- **Category Priorities:** Ποια categories είναι στρατηγικά σημαντικές
- **Seasonal Priorities:** Προϊόντα που είναι relevant για την τρέχουσα περίοδο

**Πώς χρησιμοποιείται:**
- Προϊόντα με strategic flags παίρνουν bonus score
- Σενάρια όπως "Brand Launch" δίνουν 50% weight σε αυτόν τον παράγοντα

---

### 1.4 Revenue Targets (Στόχοι Τζίρου)
**Τι χρειάζεται:**
- **Category Revenue Goals:** Στόχοι τζίρου ανά category (π.χ. Electronics: €100K)
- **Product Revenue Targets:** Individual targets ανά προϊόν (optional)
- **Volume Goals:** Στόχοι σε units/quantity
- **Time Period:** Για ποια περίοδο (μήνας, τρίμηνο, έτος)

**Πώς χρησιμοποιείται:**
- Προϊόντα από categories με υψηλούς στόχους παίρνουν υψηλότερο score
- Σενάρια όπως "Revenue Push" δίνουν 35% weight σε αυτόν τον παράγοντα

---

### 1.5 Customer Fit (Προσαρμογή Πελατών)
**Τι χρειάζεται:**
- **RFM Segment Affinity:** Ποια προϊόντα ταιριάζουν με κάθε RFM segment
- **Purchase History Patterns:** Ιστορικό αγορών ανά segment
- **Category Affinity:** Ποια categories προτιμά κάθε segment
- **Price Sensitivity:** Price ranges που προτιμά κάθε segment
- **Brand Preferences:** Brand affinities ανά segment

**Πώς χρησιμοποιείται:**
- Προϊόντα που ταιριάζουν με το selected RFM segment παίρνουν bonus score
- Όλα τα σενάρια δίνουν 20% weight σε αυτόν τον παράγοντα (σταθερό)

---

## 2. Predefined Scenarios

### 2.1 Profit Maximization
**Weights:** Profit: 40%, Stock: 15%, Strategic: 15%, Revenue: 10%, Fit: 20%

**Χρειάζεται:**
- Accurate margin data για όλα τα προϊόντα
- Clear definition του "high margin" threshold
- Customer fit data για targeting

**Χρήση:** Όταν ο στόχος είναι να μεγιστοποιήσουμε το κέρδος ανά transaction

---

### 2.2 Stock Clearance
**Weights:** Profit: 15%, Stock: 45%, Strategic: 10%, Revenue: 10%, Fit: 20%

**Χρειάζεται:**
- Real-time stock levels
- Stock age data
- Excess stock identification
- Clearance pricing strategy

**Χρήση:** Όταν θέλουμε να μειώσουμε το απόθεμα γρήγορα

---

### 2.3 Brand Launch
**Weights:** Profit: 10%, Stock: 10%, Strategic: 50%, Revenue: 10%, Fit: 20%

**Χρειάζεται:**
- List of new products/brands
- Launch dates
- Target segments για το launch
- Marketing budget allocation

**Χρήση:** Όταν κάνουμε launch νέου brand ή product line

---

### 2.4 Revenue Push
**Weights:** Profit: 15%, Stock: 15%, Strategic: 15%, Revenue: 35%, Fit: 20%

**Χρειάζεται:**
- Category revenue targets
- Current revenue vs targets
- Volume goals
- Time period definition

**Χρήση:** Όταν θέλουμε να αυξήσουμε τον συνολικό τζίρο

---

### 2.5 Custom
**Weights:** Προσαρμοσμένα από τον επιχειρηματία

**Χρειάζεται:**
- Clear business goals
- Understanding των trade-offs μεταξύ factors
- Approval workflow για custom strategies

**Χρήση:** Όταν κανένα από τα predefined scenarios δεν ταιριάζει

---

## 3. Approval Workflow

### 3.1 Draft → Pending Review
**Χρειάζεται:**
- Business stakeholder να ορίσει τα weights
- Preview του impact πριν το submit
- Documentation του reasoning

### 3.2 Pending Review → Approved
**Χρειάζεται:**
- Review από manager/director
- Approval criteria:
  - Weights sum = 100%
  - Alignment με business goals
  - Impact assessment

### 3.3 Approved → Implementation
**Χρειάζεται:**
- Clear implementation plan
- Channel activation
- Monitoring setup

---

## 4. Data Sources που Χρειάζονται

### 4.1 Product Data
- SKU, Name, Category
- Price, Cost, Margin %
- Stock levels, Capacity, Age
- Strategic flags (new launch, brand push, etc.)

### 4.2 Financial Data
- Revenue targets ανά category
- Margin thresholds
- Cost structure

### 4.3 Customer Data
- RFM segments
- Segment affinities με products/categories
- Purchase history patterns

### 4.4 Inventory Data
- Real-time stock levels
- Stock age tracking
- Excess stock identification

---

## 5. Implementation Checklist για Επιχειρηματίες

### Phase 1: Data Collection
- [ ] Collect margin data για όλα τα προϊόντα
- [ ] Set up stock level tracking
- [ ] Define strategic priorities (brands, launches, deals)
- [ ] Set revenue targets ανά category
- [ ] Map customer segments με product affinities

### Phase 2: Configuration
- [ ] Choose initial scenario (ή create custom)
- [ ] Adjust weights ανάλογα με business goals
- [ ] Preview impact
- [ ] Document reasoning

### Phase 3: Approval
- [ ] Submit for review
- [ ] Get stakeholder approval
- [ ] Document approval decision

### Phase 4: Implementation
- [ ] Activate channels based on recommendations
- [ ] Monitor performance
- [ ] Adjust weights ανάλογα με results

---

## 6. Key Metrics για Monitoring

### 6.1 Strategy Performance
- Composite scores ανά product
- Top 10 prioritized products
- Affected categories count
- Average score

### 6.2 Business Impact
- Revenue από prioritized products
- Margin improvement
- Stock reduction
- Customer engagement

---

## 7. Common Questions

**Q: Πώς ορίζω τα thresholds για "high margin"?**
A: Αναλύστε το margin distribution των προϊόντων σας. Συνήθως:
- Top 25% = High margin
- Middle 50% = Medium margin
- Bottom 25% = Low margin

**Q: Τι σημαίνει "Customer Fit"?**
A: Είναι το πόσο καλά ένα προϊόν ταιριάζει με τα preferences ενός RFM segment. Βασίζεται σε:
- Purchase history
- Category affinity
- Price sensitivity
- Brand preferences

**Q: Μπορώ να αλλάξω weights ενώ το scenario είναι approved?**
A: Ναι, αλλά θα πάει πίσω σε "Draft" status και θα χρειαστεί νέα approval.

**Q: Πώς ξέρω ποιο scenario να επιλέξω;**
A: Εξαρτάται από τους στόχους σας:
- **Profit Maximization:** Όταν θέλετε να μεγιστοποιήσετε margin
- **Stock Clearance:** Όταν έχετε excess inventory
- **Brand Launch:** Όταν κάνετε launch νέου brand/product
- **Revenue Push:** Όταν θέλετε να αυξήσετε volume
- **Custom:** Όταν θέλετε balanced approach ή specific goals

---

## 8. Data Extraction & Organization Guide

Αν δεν έχεις τα δεδομένα έτοιμα, αυτή η ενότητα σου δείχνει πώς να τα εξάγεις και να τα οργανώσεις.

---

### 8.1 Product Data Extraction

#### Από ERP Systems (SAP, Oracle, Microsoft Dynamics, κλπ.)

**Τι να εξάγεις:**
```sql
-- Example SQL Query (adapt to your ERP)
SELECT 
    SKU,
    ProductName,
    Category,
    Price,
    Cost,
    (Price - Cost) / Price * 100 AS MarginPercentage,
    CurrentStock,
    MaxStock,
    DATEDIFF(day, LastReceivedDate, GETDATE()) AS StockAgeDays
FROM Products
WHERE Active = 1
```

**Export Format:**
- CSV ή Excel
- Columns: SKU, Name, Category, Price, Cost, Margin %, Stock Level, Stock Capacity, Stock Age Days

**Tools:**
- ERP built-in reporting
- Business Intelligence tools (Power BI, Tableau)
- Direct database export (αν έχεις access)

---

#### Από E-commerce Platforms

**Shopify:**
1. Go to Products → Export
2. Select: Title, SKU, Vendor, Type, Price, Cost per item, Inventory quantity
3. Export as CSV
4. Calculate margin: `(Price - Cost) / Price * 100`

**WooCommerce:**
1. Products → Export
2. Include: SKU, Name, Category, Regular Price, Cost, Stock Quantity
3. Use WooCommerce Cost of Goods plugin για cost data

**Magento:**
1. System → Data Transfer → Export
2. Entity Type: Products
3. Select attributes: SKU, Name, Price, Cost, Qty, Category

**Custom E-commerce:**
- Export από database ή admin panel
- Χρησιμοποίησε API αν διαθέσιμο

---

#### Manual Collection (αν δεν υπάρχει σύστημα)

**Template για Excel/Google Sheets:**

| SKU | Name | Category | Price | Cost | Margin % | Stock Level | Stock Capacity | Stock Age (Days) | Priority Tag |
|-----|------|----------|-------|------|----------|-------------|----------------|-----------------|--------------|
| SKU-001 | Product Name | Electronics | 99.99 | 60.00 | 40.0 | 100 | 500 | 30 | New Launch |

**Calculation Formulas:**
- Margin %: `=(Price - Cost) / Price * 100`
- Stock Age: `=TODAY() - ReceivedDate`

---

### 8.2 Margin Data Organization

#### Αν δεν έχεις Cost Data:

**Method 1: Estimate από Supplier Invoices**
1. Export supplier invoices
2. Match SKU με invoice line items
3. Calculate average cost per SKU
4. Update στο product data

**Method 2: Category-level Margins**
1. Define average margin ανά category:
   - Electronics: 35%
   - Fashion: 45%
   - Home: 30%
   - etc.
2. Apply category margin ως starting point
3. Refine με time

**Method 3: Historical Analysis**
1. Export sales data (last 6-12 months)
2. Calculate: `(Revenue - COGS) / Revenue`
3. Group by SKU ή Category
4. Use για margin estimates

**Template για Margin Thresholds:**

| Category | High Margin Threshold | Medium Margin Threshold | Low Margin Threshold |
|----------|----------------------|-------------------------|---------------------|
| Electronics | >35% | 20-35% | <20% |
| Fashion | >45% | 30-45% | <30% |
| Home | >30% | 15-30% | <15% |

---

### 8.3 Inventory Data Collection

#### Real-time Stock Levels

**Από Warehouse Management System (WMS):**
1. Export current inventory report
2. Include: SKU, Location, Quantity, Capacity
3. Calculate utilization: `Quantity / Capacity * 100`

**Από E-commerce Platform:**
- Most platforms show stock levels in admin
- Export inventory reports
- Set up automated exports (daily/weekly)

**Manual Tracking:**
1. Create inventory spreadsheet
2. Update weekly/monthly
3. Track: SKU, Current Stock, Max Stock, Last Count Date

**Stock Age Calculation:**
```
Stock Age = Today's Date - Last Received Date
```

Αν δεν έχεις Last Received Date:
- Use Last Sale Date (ανάποδα)
- Estimate από average turnover
- Set default (π.χ. 90 days) και refine

---

#### Excess Stock Identification

**Criteria για Excess Stock:**
- Stock Level > 80% of Capacity
- Stock Age > 180 days
- No sales in last 90 days

**Query Template:**
```sql
SELECT SKU, Name, StockLevel, StockCapacity, StockAgeDays
FROM Products
WHERE (StockLevel / StockCapacity) > 0.8 
  AND StockAgeDays > 180
  AND LastSaleDate < DATEADD(day, -90, GETDATE())
```

---

### 8.4 Strategic Priority Flags

#### Brand Push Flags

**Πώς να τα ορίσεις:**
1. Create list of brands προς promotion
2. Tag products με brand name
3. Add "Brand Push" flag στο priority_tag field

**Template:**
| SKU | Brand | Priority Tag |
|-----|-------|--------------|
| SKU-001 | Sony | Brand Push |
| SKU-002 | Apple | Brand Push |

---

#### New Launch Flags

**Πώς να τα track:**
1. Create calendar με launch dates
2. Tag products με "New Launch" 30-90 days before/after launch
3. Update priority_tag field

**Launch Tracking Template:**

| Product Name | SKU | Launch Date | Status | Priority Tag |
|--------------|-----|-------------|--------|--------------|
| iPhone 16 | SKU-001 | 2026-02-15 | Upcoming | New Launch |
| Galaxy S25 | SKU-002 | 2026-01-20 | Recent | New Launch |

---

#### Supplier Deals

**Track Special Agreements:**
1. Document supplier deals (exclusive, volume discounts, etc.)
2. Tag affected products
3. Add to strategic priority

**Template:**
| Supplier | Deal Type | Products (SKUs) | Start Date | End Date |
|----------|-----------|-----------------|------------|----------|
| Supplier A | Exclusive | SKU-001, SKU-002 | 2026-01-01 | 2026-12-31 |
| Supplier B | Volume Discount | SKU-003, SKU-004 | 2026-02-01 | 2026-06-30 |

---

### 8.5 Revenue Targets Setup

#### Category Revenue Goals

**Πώς να τα ορίσεις:**

**Method 1: Historical + Growth**
1. Export last year's revenue ανά category
2. Apply growth target (π.χ. +15%)
3. Set as target

**Template:**

| Category | Last Year Revenue | Growth Target % | Target Revenue | Period |
|----------|-------------------|-----------------|----------------|--------|
| Electronics | €500,000 | 15% | €575,000 | Q1 2026 |
| Fashion | €300,000 | 20% | €360,000 | Q1 2026 |
| Home | €200,000 | 10% | €220,000 | Q1 2026 |

**Method 2: Budget-based**
1. Use annual budget breakdown
2. Allocate ανά category
3. Divide by quarters/months

**Method 3: Market-based**
1. Research market size ανά category
2. Set market share targets
3. Calculate revenue targets

---

#### Volume Goals

**Setup:**
1. Define units ανά category
2. Set quantity targets
3. Track progress

**Template:**

| Category | Unit Type | Target Quantity | Current Quantity | Progress % |
|----------|-----------|-----------------|------------------|------------|
| Electronics | Units | 1,000 | 250 | 25% |
| Fashion | Items | 2,500 | 800 | 32% |

---

### 8.6 Customer Fit Data Collection

#### RFM Segment Affinities

**Από Customer Database:**

**Step 1: Export Customer Purchase History**
```sql
SELECT 
    CustomerID,
    OrderDate,
    ProductSKU,
    Category,
    Quantity,
    Revenue
FROM Orders
WHERE OrderDate >= DATEADD(month, -12, GETDATE())
```

**Step 2: Calculate RFM Scores**
- Use RFM Analysis tool ή manual calculation
- Segment customers: Champions, Loyal, Potential, At Risk, Lost

**Step 3: Map Product Affinities**
- For each segment, find top products/categories
- Calculate affinity score: `(Segment Purchases / Total Purchases) * 100`

**Template:**

| RFM Segment | Top Categories | Top Brands | Avg Order Value | Price Range |
|-------------|----------------|------------|-----------------|-------------|
| Champions | Electronics, Fashion | Sony, Apple | €150-€500 | €50-€1000 |
| Loyal | Home, Fashion | IKEA, Zara | €50-€200 | €20-€300 |
| Potential | Electronics | Various | €30-€150 | €20-€500 |

---

#### Purchase History Patterns

**Export από E-commerce/CRM:**
1. Customer orders (last 12-24 months)
2. Include: Customer ID, Segment, Product SKU, Category, Date, Value
3. Analyze patterns:
   - Which categories each segment buys
   - Price sensitivity
   - Brand preferences
   - Purchase frequency

**Tools:**
- Google Analytics (if e-commerce tracking enabled)
- CRM exports
- Database queries

---

### 8.7 Data Quality Checklist

**Before Import:**

- [ ] **Completeness:** Όλα τα SKUs έχουν required fields
- [ ] **Accuracy:** Margins, prices, stock levels είναι correct
- [ ] **Consistency:** Categories, brands use consistent naming
- [ ] **Currency:** Όλα τα prices σε ίδιο currency
- [ ] **Dates:** Date formats είναι consistent (YYYY-MM-DD)
- [ ] **No Duplicates:** Κανένα duplicate SKU
- [ ] **Valid Values:** Stock levels, margins είναι logical (π.χ. margin < 100%)

---

### 8.8 Data Collection Tools & Resources

#### Free Tools:
- **Google Sheets:** For manual data entry και organization
- **Excel:** For data manipulation και formulas
- **CSV Export:** From most systems
- **Google Analytics:** For customer behavior data
- **Export from E-commerce:** Built-in export features

#### Paid Tools (αν χρειάζεται):
- **Data Integration Platforms:** Zapier, Make (Integromat)
- **BI Tools:** Power BI, Tableau (αν έχεις access)
- **ETL Tools:** For complex data transformations

---

### 8.9 Step-by-Step Data Collection Plan

#### Week 1: Product Data
- [ ] Day 1-2: Export από ERP/E-commerce
- [ ] Day 3-4: Clean και organize data
- [ ] Day 5: Calculate missing margins
- [ ] Day 6-7: Validate και fix errors

#### Week 2: Inventory Data
- [ ] Day 1-2: Export stock levels
- [ ] Day 3: Calculate stock age
- [ ] Day 4: Identify excess stock
- [ ] Day 5-7: Update strategic flags

#### Week 3: Financial & Strategic Data
- [ ] Day 1-2: Set revenue targets
- [ ] Day 3-4: Define strategic priorities
- [ ] Day 5-7: Map customer affinities

#### Week 4: Integration & Testing
- [ ] Day 1-2: Import data στο Performance+
- [ ] Day 3-4: Test scenarios
- [ ] Day 5-7: Refine και optimize

---

### 8.10 CSV Import Templates

**Products Template (ready for import):**

```csv
SKU,Name,Category,Margin Tier,Margin Percentage,Stock Level,Stock Capacity,Stock Age Days,Price,Priority Tag
SKU-001,Product Name,Electronics,high,35.5,100,500,30,99.99,New Launch
SKU-002,Another Product,Fashion,medium,25.0,50,200,15,49.99,Brand Push
```

**Revenue Targets Template:**

```csv
Category,Target Revenue,Period,Current Revenue,Progress %
Electronics,575000,Q1 2026,150000,26.1
Fashion,360000,Q1 2026,90000,25.0
```

---

### 8.11 Common Data Challenges & Solutions

**Challenge: Missing Cost Data**
- **Solution:** Use category averages, supplier quotes, ή historical analysis

**Challenge: Outdated Stock Levels**
- **Solution:** Set up automated exports, manual weekly updates, ή real-time API integration

**Challenge: No RFM Segments**
- **Solution:** Start με simple segmentation (High/Medium/Low value), refine later

**Challenge: Inconsistent Categories**
- **Solution:** Create category mapping table, standardize names

**Challenge: No Strategic Flags**
- **Solution:** Start empty, add flags gradually as priorities emerge

---

## 9. Next Steps

1. **Data Import:** Χρησιμοποίησε το CSV Import feature για να φορτώσεις:
   - Product data (SKU, margin, stock, etc.)
   - Strategic flags
   - Revenue targets

2. **RFM Setup:** Βεβαιώσου ότι έχεις RFM segments configured

3. **Test Scenarios:** Δοκίμασε τα predefined scenarios και δες το impact

4. **Custom Configuration:** Αν χρειάζεται, δημιούργησε custom scenario

5. **Approval Workflow:** Χρησιμοποίησε το approval workflow για governance

6. **Iterative Improvement:** Start με available data, refine με time
