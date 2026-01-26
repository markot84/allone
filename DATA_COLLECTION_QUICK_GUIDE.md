# Data Collection Quick Guide

## 🚀 Quick Start: 5-Step Plan

### Step 1: Export Product Data (Day 1-2)
**From ERP/E-commerce:**
- SKU, Name, Category, Price
- Cost (ή calculate margin)
- Stock levels

**If no system:** Use Excel template (see below)

---

### Step 2: Calculate Margins (Day 3)
**Formula:** `Margin % = (Price - Cost) / Price * 100`

**If no cost data:**
- Use category averages
- Check supplier invoices
- Estimate από historical sales

---

### Step 3: Get Stock Data (Day 4-5)
**Export:**
- Current stock levels
- Stock capacity
- Last received date (για age calculation)

**Stock Age:** `=TODAY() - ReceivedDate`

---

### Step 4: Set Strategic Flags (Day 6)
**Create lists:**
- Brand Push products
- New Launches
- Supplier Deals

**Add to Priority Tag field**

---

### Step 5: Define Revenue Targets (Day 7)
**Set targets:**
- By category
- By time period (month/quarter)
- Based on budget ή historical + growth

---

## 📊 Excel Templates

### Products Template
```
| SKU | Name | Category | Price | Cost | Margin % | Stock Level | Stock Capacity | Stock Age Days | Priority Tag |
|-----|------|----------|-------|------|----------|-------------|----------------|----------------|--------------|
| SKU-001 | Product | Electronics | 99.99 | 60.00 | 40.0 | 100 | 500 | 30 | New Launch |
```

**Formulas:**
- Margin %: `=(D2-E2)/D2*100`
- Stock Age: `=TODAY()-I2` (αν I2 = ReceivedDate)

---

### Revenue Targets Template
```
| Category | Target Revenue | Period | Current Revenue | Progress % |
|----------|---------------|--------|-----------------|------------|
| Electronics | 575000 | Q1 2026 | 150000 | =D2/B2*100 |
```

---

## 🔧 Common Exports

### Shopify
1. Products → Export
2. Select: Title, SKU, Vendor, Type, Price, Cost per item, Inventory quantity
3. Export CSV

### WooCommerce
1. Products → Export
2. Include: SKU, Name, Category, Regular Price, Cost, Stock Quantity

### ERP Systems
**SQL Template:**
```sql
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

---

## 📋 Data Quality Checklist

Before importing:
- [ ] All SKUs have required fields
- [ ] Margins are logical (<100%)
- [ ] Stock levels are positive numbers
- [ ] Categories use consistent naming
- [ ] No duplicate SKUs
- [ ] Dates in YYYY-MM-DD format

---

## 🎯 Priority Levels

**If you don't have all data, prioritize:**

1. **Must Have:**
   - SKU, Name, Category, Price
   - Stock Level

2. **Should Have:**
   - Margin %
   - Stock Capacity
   - Priority Tags

3. **Nice to Have:**
   - Stock Age
   - Revenue Targets
   - Customer Affinities

**Start with Must Have, add others gradually!**

---

## 💡 Quick Tips

**Missing Cost Data?**
- Use category averages
- Check supplier price lists
- Estimate από competitor pricing

**No Stock Age?**
- Set default (π.χ. 90 days)
- Use last sale date (backwards)
- Refine later

**No Strategic Flags?**
- Start empty
- Add as priorities emerge
- Use "New Launch" για recent products

**No Revenue Targets?**
- Use last year's revenue + growth %
- Or use budget breakdown
- Set monthly targets

---

## 📞 Need Help?

1. Check `BUSINESS_REQUIREMENTS.md` for detailed guides
2. Use CSV Import feature in Performance+
3. Start small, iterate, and improve

**Remember:** Better to start with partial data than wait for perfect data!
