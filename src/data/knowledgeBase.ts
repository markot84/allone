// Knowledge Base - Comprehensive User Guide
// Structured articles for user understanding and usage

export interface KnowledgeArticle {
  id: string;
  category: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  related?: string[];
  steps?: string[];
  tips?: string[];
  faq?: { question: string; answer: string }[];
}

export const knowledgeCategories = [
  {
    id: 'getting-started',
    title: 'Ξεκινώντας',
    icon: '🎯',
    description: 'Βασικές έννοιες και πρώτα βήματα',
    color: '#FF6B35'
  },
  {
    id: 'data-import',
    title: 'Εισαγωγή Δεδομένων',
    icon: '📥',
    description: 'Πώς να φορτώσετε και να διαχειριστείτε δεδομένα',
    color: '#3B82F6'
  },
  {
    id: 'strategy',
    title: 'Στρατηγική Προτεραιοποίησης',
    icon: '⚙️',
    description: 'Ρύθμιση βαρών και στρατηγικών',
    color: '#8B5CF6'
  },
  {
    id: 'rfm',
    title: 'RFM Ανάλυση',
    icon: '👥',
    description: 'Κατανόηση των customer segments',
    color: '#22C55E'
  },
  {
    id: 'products',
    title: 'Product Intelligence',
    icon: '📦',
    description: 'Διαχείριση προϊόντων και αποθεμάτων',
    color: '#F59E0B'
  },
  {
    id: 'channels',
    title: 'Channel Activation',
    icon: '📢',
    description: 'Προτάσεις καναλιών και budget allocation',
    color: '#EF4444'
  },
  {
    id: 'content',
    title: 'Content Strategy',
    icon: '✍️',
    description: 'Συγχρονισμός περιεχομένου με στρατηγική',
    color: '#06B6D4'
  },
  {
    id: 'roi',
    title: 'ROI Attribution',
    icon: '💶',
    description: 'Μέτρηση επιπτώσης Performance+',
    color: '#10B981'
  },
  {
    id: 'dashboard',
    title: 'Dashboard & Analytics',
    icon: '📊',
    description: 'Ερμηνεία δεδομένων και KPIs',
    color: '#6366F1'
  },
  {
    id: 'troubleshooting',
    title: 'Αντιμετώπιση Προβλημάτων',
    icon: '🔧',
    description: 'Συχνά προβλήματα και λύσεις',
    color: '#9CA3AF'
  }
];

export const knowledgeArticles: KnowledgeArticle[] = [
  // GETTING STARTED
  {
    id: 'what-is-performance-plus',
    category: 'getting-started',
    title: 'Τι είναι το Performance+',
    description: 'Εισαγωγή στην πλατφόρμα και τις βασικές της λειτουργίες',
    content: `Το Performance+ είναι μια ολοκληρωμένη πλατφόρμα διαχείρισης marketing performance που σας βοηθά να:

**Βελτιστοποιήσετε την προτεραιοποίηση προϊόντων** μέσω multi-factor scoring
**Κατανοήσετε τους πελάτες σας** με RFM segmentation
**Αυξήσετε το ROI** μέσω data-driven decisions
**Συγχρονίσετε το περιεχόμενο** με την εμπορική στρατηγική

Η πλατφόρμα συνδυάζει:
- Product Intelligence για αποθέματα και προτεραιοποίηση
- RFM Analysis για customer segmentation
- Strategy Weights Configurator για προσαρμοσμένη στρατηγική
- Channel Activation για budget optimization
- ROI Attribution για μέτρηση επιπτώσεων`,
    tags: ['basics', 'overview', 'introduction'],
    related: ['data-import-basics', 'dashboard-overview']
  },
  {
    id: 'dashboard-overview',
    category: 'getting-started',
    title: 'Επισκόπηση Dashboard',
    description: 'Κατανόηση των βασικών KPIs και metrics',
    content: `Το Dashboard σας δίνει μια ολοκληρωμένη εικόνα της απόδοσης σας.

**Κύρια KPIs:**
- **Total Revenue**: Συνολικό εισόδημα με attribution rate
- **Products**: Συνολικός αριθμός προϊόντων στο σύστημα
- **Segments**: RFM segments με μέσο score
- **Campaigns**: Ενεργά campaigns

**Charts & Visualizations:**
- **Revenue Performance**: Total vs Performance+ Attributed revenue
- **Customer Segments**: Κατανομή πελατών ανά segment
- **Performance Summary**: Stock Clearance, Cost Savings, ROI

**AI Insights**: Προτάσεις για βελτίωση απόδοσης

Κάθε KPI card είναι clickable και σας οδηγεί στην αντίστοιχη λεπτομερή ανάλυση.`,
    tags: ['dashboard', 'kpis', 'metrics'],
    related: ['understanding-kpis', 'roi-attribution-basics'],
    tips: [
      'Κάντε hover πάνω στα labels για tooltips με εξηγήσεις',
      'Κάντε κλικ στα KPI cards για να δείτε λεπτομερή ανάλυση',
      'Χρησιμοποιήστε το AI Insights panel για actionable recommendations'
    ]
  },
  {
    id: 'data-import-basics',
    category: 'data-import',
    title: 'Βασικές Αρχές Εισαγωγής Δεδομένων',
    description: 'Πώς να φορτώσετε δεδομένα στην πλατφόρμα',
    content: `Η εισαγωγή δεδομένων είναι το πρώτο βήμα για να ξεκινήσετε.

**Υποστηριζόμενοι τύποι δεδομένων:**
1. **Products**: Προϊόντα με SKU, τιμή, stock, margin
2. **RFM Segments**: Customer segments με RFM scores
3. **Analytics**: Revenue και performance data
4. **Campaigns**: Marketing campaigns

**Μέθοδοι εισαγωγής:**
- **CSV/XLSX files**: Upload από τον υπολογιστή σας
- **URL links**: Direct link σε CSV/Excel files online

**Βήματα:**
1. Μεταβείτε στο Data Import section
2. Επιλέξτε τον τύπο δεδομένων
3. Κάντε κλικ "Download Template" για να δείτε το format
4. Συμπληρώστε το template με τα δεδομένα σας
5. Upload το αρχείο ή προσθέστε URL
6. Κάντε κλικ "Import"`,
    tags: ['import', 'data', 'csv', 'excel'],
    related: ['products-import', 'segments-import', 'analytics-import'],
    steps: [
      'Επιλέξτε τύπο δεδομένων (Products, Segments, Analytics, Campaigns)',
      'Κάντε κλικ "Download Template" για να δείτε το format',
      'Συμπληρώστε το template με τα δεδομένα σας',
      'Upload το αρχείο ή προσθέστε URL link',
      'Ελέγξτε τα validation errors αν υπάρχουν',
      'Κάντε κλικ "Import" για να ολοκληρώσετε'
    ],
    tips: [
      'Χρησιμοποιήστε πάντα το template για να αποφύγετε errors',
      'Ελέγξτε ότι οι ημερομηνίες είναι σε format YYYY-MM-DD',
      'Για μεγάλα αρχεία (>1000 rows), χρησιμοποιήστε CSV format',
      'Μπορείτε να importάρετε πολλαπλά αρχεία ταυτόχρονα'
    ]
  },
  {
    id: 'products-import',
    category: 'data-import',
    title: 'Εισαγωγή Προϊόντων',
    description: 'Λεπτομερής οδηγός για import προϊόντων',
    content: `**Υποχρεωτικά πεδία:**
- SKU: Μοναδικό identifier προϊόντος
- Name: Όνομα προϊόντος
- Category: Κατηγορία (π.χ. Electronics, Fashion)
- Price: Τιμή πώλησης

**Προαιρετικά αλλά συνιστώμενα:**
- Cost Price: Κόστος για υπολογισμό margin
- Margin Percentage: Ποσοστό κέρδους
- Stock Level: Τρέχον απόθεμα
- Stock Capacity: Μέγιστη χωρητικότητα
- Stock Age Days: Ημέρες από την παραλαβή
- Priority Tag: Strategic flags (New Launch, Brand Push, κλπ)

**Margin Tier:**
- high: >30%
- medium: 15-30%
- low: <15%

**Πιθανές Εκδοχές Ονομάτων Στηλών:**

Το σύστημα αναγνωρίζει αυτόματα διάφορες εκδοχές ονομάτων για κάθε πεδίο:

**SKU/ID:**
SKU_ID, SKU, sku_id, sku, ID, id, Product_ID, product_id, Item_ID, item_id, Code, code, Κωδικός, κωδικός, Barcode, barcode, EAN, ean

**Product Name:**
Product_Name, Product Name, product_name, Name, name, Product, product, Title, title, Item, item, Item_Name, item_name, Description, description, Product_Title, product_title, Όνομα, όνομα, Προϊόν, προϊόν, Περιγραφή, περιγραφή

**Category:**
Category, category, Product_Category, product_category, Group, group, Κατηγορία, κατηγορία, Type, type, Department, department, Προμηθευτής, προμηθευτής

**Price:**
Sell_Price, Sell Price, sell_price, Price, price, Unit_Price, unit_price, Retail_Price, retail_price, MSRP, msrp, Τιμή, τιμή

**Cost Price:**
Cost_Price, Cost Price, cost_price, Cost, cost, Κόστος, κόστος

**Stock Level:**
Stock_On_Hand, Stock On Hand, stock_on_hand, Stock_Level, stock_level, Stock, stock, Quantity, quantity, Qty, qty, Inventory, inventory, On_Hand, on_hand, Units, units, Απόθεμα, απόθεμα, Ποσότητα, ποσότητα, Available_Stock, available_stock, Δυναμικό_Υπόλοιπο, δυναμικό_υπόλοιπο, Κίνηση, κίνηση

**Date:**
First_Available_Date, First Available Date, first_available_date, First_Available, first_available, Available_Date, available_date, Date_Added, date_added, Created_Date, created_date, Creation_Date, creation_date, Inventory_Date, inventory_date, Data, data, Ημερομηνία, ημερομηνία, Ημ/νία, ημ/νία

**Margin:**
Gross_Margin_%, Gross Margin %, gross_margin_%, Margin_Percentage, margin_percentage, Margin_Pct, margin_pct, Margin, margin, Margin_%, margin_%, Gross_Margin, gross_margin, Profit_Margin, profit_margin

**Validation:**
Το σύστημα ελέγχει ότι:
- SKU είναι unique
- Price > 0
- Stock Level >= 0
- Dates είναι σε σωστό format`,
    tags: ['products', 'import', 'inventory'],
    related: ['products-intelligence', 'strategy-weights', 'column-names-guide'],
    faq: [
      {
        question: 'Τι γίνεται αν δεν έχω Cost Price;',
        answer: 'Μπορείτε να αφήσετε το πεδίο κενό. Το σύστημα θα υπολογίσει το margin από άλλα δεδομένα ή θα χρησιμοποιήσει category averages.'
      },
      {
        question: 'Πώς υπολογίζεται το Stock Age;',
        answer: 'Αν δεν το δώσετε, το σύστημα θα το υπολογίσει από το First Available Date ή από το createdAt timestamp.'
      },
      {
        question: 'Τι γίνεται αν οι στήλες μου έχουν διαφορετικά ονόματα;',
        answer: 'Το σύστημα αναγνωρίζει αυτόματα πολλές εκδοχές ονομάτων. Δείτε το πίνακα "Αντιστοίχιση Στηλών" στο Data Import για όλες τις πιθανές εκδοχές.'
      }
    ]
  },
  {
    id: 'segments-import',
    category: 'data-import',
    title: 'Εισαγωγή RFM Segments',
    description: 'Πώς να φορτώσετε customer segments',
    content: `**Υποχρεωτικά πεδία:**
- Name: Όνομα segment (π.χ. Champions, Loyal, At Risk)
- RFM Score: Score format (π.χ. "5-5-5" ή "5-5-5 to 4-4-4")
- Count: Αριθμός πελατών στο segment
- Percentage: Ποσοστό του total customer base

**Προαιρετικά:**
- Revenue Share: Ποσοστό revenue από segment
- Color: Hex color για visualization (π.χ. #22C55E)
- Description: Περιγραφή του segment

**Πιθανές Εκδοχές Ονομάτων Στηλών:**

**Name:**
Name, name, Segment_Name, segment_name, Segment, segment, Title, title

**RFM Score:**
RFM_Score, RFM Score, rfm_score, Score, score, RFM, rfm

**Count:**
Count, count, Customer_Count, customer_count, Customers, customers, Size, size, Total, total

**Percentage:**
Percentage, percentage, Percent, percent, Pct, pct, %, Percentage_Share, percentage_share

**Revenue Share:**
Revenue_Share, Revenue Share, revenue_share, Revenue_Percentage, revenue_percentage, Rev_Share, rev_share

**Color:**
Color, color, Colour, colour, Hex_Color, hex_color, Color_Code, color_code

**Description:**
Description, description, Desc, desc, Note, note, Notes, notes, Περιγραφή, περιγραφή, Behavioral_Persona, behavioral_persona, Tier, tier

**RFM Score Format:**
- Single score: "5-5-5" (Recency-Frequency-Monetary)
- Range: "5-5-5 to 4-4-4" (score range)

**Common Segments:**
- Champions: 5-5-5 (high value, recent, frequent)
- Loyal: 4-4-4 to 5-5-5
- Potential: 3-3-3 to 4-4-4
- At Risk: 2-2-2 to 3-3-3
- Lost: 1-1-1 to 2-2-2`,
    tags: ['segments', 'rfm', 'customers'],
    related: ['rfm-analysis', 'understanding-segments', 'column-names-guide']
  },
  {
    id: 'analytics-import',
    category: 'data-import',
    title: 'Εισαγωγή Analytics Data',
    description: 'Πώς να φορτώσετε revenue και performance data',
    content: `**Υποχρεωτικά πεδία:**
- Date: Ημερομηνία σε format YYYY-MM-DD
- Total Revenue: Συνολικό εισόδημα (σε units, π.χ. 50000 για €50K)
- Attributed Revenue: Revenue που αποδίδεται στο Performance+ (σε units)
- Attribution Rate: Ποσοστό attribution (π.χ. 30.0 για 30%)

**Πιθανές Εκδοχές Ονομάτων Στηλών:**

**Date:**
Date, date, Date_Time, date_time, Timestamp, timestamp, Period, period, Month, month, Year_Month, year_month, Data, data, Ημερομηνία, ημερομηνία, Ημ/νία, ημ/νία

**Total Revenue:**
Total_Revenue, Total Revenue, total_revenue, Revenue, revenue, Total, total, Total_Rev, total_rev, Revenue_Total, revenue_total

**Attributed Revenue:**
Attributed_Revenue, Attributed Revenue, attributed_revenue, Attributed, attributed, Attributed_Rev, attributed_rev, Performance_Plus_Revenue, performance_plus_revenue, PP_Revenue, pp_revenue

**Attribution Rate:**
Attribution_Rate, Attribution Rate, attribution_rate, Attribution_%, attribution_%, Attribution_Percentage, attribution_percentage, Rate, rate

**Format:**
\`\`\`csv
Date,Total Revenue,Attributed Revenue,Attribution Rate
2026-01-01,50000,15000,30.0
2026-02-01,52000,18000,34.6
\`\`\`

**Σημειώσεις:**
- Οι τιμές είναι σε base units (π.χ. 50000 = €50K)
- Το σύστημα θα μετατρέψει αυτόματα σε K format για display
- Η ημερομηνία πρέπει να είναι σε ISO format (YYYY-MM-DD)
- Το Attribution Rate υπολογίζεται αυτόματα αν δεν το δώσετε`,
    tags: ['analytics', 'revenue', 'performance'],
    related: ['roi-attribution-basics', 'dashboard-overview', 'column-names-guide']
  },
  {
    id: 'campaigns-import',
    category: 'data-import',
    title: 'Εισαγωγή Campaigns',
    description: 'Πώς να φορτώσετε marketing campaigns (Google Ads & Meta)',
    content: `**Υποστηριζόμενα κανάλια:**
- Google Ads
- Meta (Facebook/Instagram)

**Υποχρεωτικά πεδία:**
- Campaign Name: Όνομα καμπάνιας
- Channel: Google Ads ή Meta (αναγνωρίζεται αυτόματα)
- Amount Spent: Ποσό που δαπανήθηκε
- Impressions: Αριθμός εμφανίσεων
- Clicks: Αριθμός κλικ

**Πιθανές Εκδοχές Ονομάτων Στηλών:**

**Campaign Name:**
Campaign_Name, Campaign Name, campaign_name, Campaign, campaign, Name, name, Campaign_Name_, campaignname, Campaign-Name

**Channel:**
Channel, channel, Channel_Name, channel_name, Source, source, Platform, platform

**Amount Spent:**
Amount_Spent_(EUR), Amount Spent (EUR), amount_spent_eur, Amount_Spent, amount_spent, Cost, cost, Spend, spend, Total_Cost, total_cost, Spent, spent

**Impressions:**
Impressions, impressions, Impr., impr., Impr, impr, Imp, imp

**Clicks:**
Clicks_(all), Clicks (all), clicks, Click, click, Clicks_All, clicks_all

**CTR:**
CTR_(all), CTR (all), ctr, Click_Through_Rate, click_through_rate, CTR_All, ctr_all

**CPC:**
CPC_(all), CPC (all), Avg._CPC, Avg. CPC, cpc, Cost_Per_Click, cost_per_click, Avg_CPC, avg_cpc, CPC_All, cpc_all

**Conversions/Purchases:**
Conversions, conversions, Purchases, purchases, Conv., conv.

**Conversion Value:**
Conversion_Value, Conversion Value, conversion_value, Purchases_Conversion_Value, Purchases conversion value, Purchase_ROAS, Purchase ROAS

**ROAS:**
ROAS, roas, Conv._Value_/_Cost, Conv. Value / Cost, Conv_Value_/_Cost

**Period/Month:**
Month, month, Period, period, Date_Range, date_range, Reporting_Starts, reporting starts, Reporting_Ends, reporting ends

**Σημειώσεις:**
- Το σύστημα αναγνωρίζει αυτόματα το κανάλι από τις στήλες
- Για Meta campaigns, χρησιμοποιείται "Purchase ROAS" αντί για "ROAS"
- Αν λείπει το Campaign Name, χρησιμοποιείται το Period/Month ως όνομα`,
    tags: ['campaigns', 'google-ads', 'meta', 'marketing'],
    related: ['channel-activation', 'column-names-guide']
  },
  {
    id: 'column-names-guide',
    category: 'data-import',
    title: 'Οδηγός Ονομάτων Στηλών',
    description: 'Πλήρης λίστα πιθανών εκδοχών ονομάτων για κάθε template',
    content: `Το σύστημα αναγνωρίζει αυτόματα διάφορες εκδοχές ονομάτων για κάθε πεδίο. Αυτό σημαίνει ότι δεν χρειάζεται να αλλάξετε τα ονόματα των στηλών σας - το σύστημα θα τα βρει αυτόματα.

**Πώς λειτουργεί:**
- Το σύστημα αναζητά case-insensitive matches
- Υποστηρίζει underscores, spaces, και διάφορες μορφές
- Υποστηρίζει ελληνικά και αγγλικά ονόματα
- Αν δεν βρει ακριβή match, κάνει partial matching

**Για κάθε template:**
- **Products**: Δείτε "Εισαγωγή Προϊόντων" για όλες τις εκδοχές
- **Campaigns**: Δείτε "Εισαγωγή Campaigns" για Google Ads & Meta
- **Analytics**: Δείτε "Εισαγωγή Analytics Data" για revenue columns
- **Segments**: Δείτε "Εισαγωγή RFM Segments" για segment columns

**Συμβουλές:**
- Χρησιμοποιήστε τον πίνακα "Αντιστοίχιση Στηλών" παρακάτω για να δείτε όλες τις πιθανές εκδοχές
- Αν μια στήλη δεν αναγνωρίζεται, ελέγξτε αν υπάρχει παρόμοιο όνομα στη λίστα
- Μπορείτε να χρησιμοποιήσετε ελληνικά ή αγγλικά ονόματα`,
    tags: ['import', 'columns', 'template', 'guide'],
    related: ['products-import', 'campaigns-import', 'analytics-import', 'segments-import']
  },
  {
    id: 'column-mapping-table',
    category: 'data-import',
    title: 'Πίνακας Αντιστοίχισης Στηλών - Products',
    description: 'Πλήρης πίνακας με όλες τις πιθανές εκδοχές ονομάτων για κάθε πεδίο προϊόντων',
    content: `Ο παρακάτω πίνακας δείχνει όλες τις πιθανές εκδοχές ονομάτων που αναγνωρίζει το σύστημα για κάθε πεδίο προϊόντων.

**SKU/ID:**
SKU_ID, SKU, sku_id, sku, ID, id, Product_ID, product_id, Item_ID, item_id, Item ID, item id, Code, code, Κωδικός, κωδικός, Barcode, barcode, EAN, ean

**Product Name:**
Product_Name, Product Name, product_name, Name, name, Product, product, Title, title, Item, item, Item_Name, item_name, Description, description, Product_Title, product_title, Όνομα, όνομα, Προϊόν, προϊόν, Περιγραφή, περιγραφή

**Category:**
Category, category, Product_Category, product_category, Group, group, Κατηγορία, κατηγορία, Type, type, Department, department, Προμηθευτής, προμηθευτής

**Price:**
Sell_Price, Sell Price, sell_price, Price, price, Unit_Price, unit_price, Retail_Price, retail_price, MSRP, msrp, Τιμή, τιμή

**Cost Price:**
Cost_Price, Cost Price, cost_price, Cost, cost, Κόστος, κόστος

**Stock Level:**
Stock_On_Hand, Stock On Hand, stock_on_hand, Stock_Level, stock_level, Stock, stock, Quantity, quantity, Qty, qty, Inventory, inventory, On_Hand, on_hand, Units, units, Απόθεμα, απόθεμα, Ποσότητα, ποσότητα, Available_Stock, available_stock, Δυναμικό_Υπόλοιπο, δυναμικό_υπόλοιπο, Κίνηση, κίνηση

**Date:**
First_Available_Date, First Available Date, first_available_date, First_Available, first_available, Available_Date, available_date, Date_Added, date_added, Created_Date, created_date, Creation_Date, creation_date, Inventory_Date, inventory_date, Data, data, Ημερομηνία, ημερομηνία, Ημ/νία, ημ/νία

**Margin:**
Gross_Margin_%, Gross Margin %, gross_margin_%, Margin_Percentage, margin_percentage, Margin_Pct, margin_pct, Margin, margin, Margin_%, margin_%, Gross_Margin, gross_margin, Profit_Margin, profit_margin

**Stock Age:**
Stock_Age_Days, Stock Age Days, stock_age_days, Age_Days, age_days, Days_In_Stock, days_in_stock, Stock_Age, stock_age, Age, age, MST_(ημέρες), mst_(ημέρες)

**Revenue:**
Revenue_Period, Revenue Period, revenue_period, Revenue, revenue

**Quantity Sold:**
Qty_Sold_Period, Qty Sold Period, qty_sold_period, Qty_Sold, qty_sold, Quantity_Sold, quantity_sold

**Priority:**
Priority_Flag, Priority Flag, priority_flag, Priority_Tag, priority_tag, Priority, priority, Tag, tag, Label, label, Alerts, alerts, Κατάσταση, κατάσταση

**Margin Tier:**
Margin_Tier, Margin Tier, margin_tier, Margin_Category, margin_category, Tier, tier`,
    tags: ['products', 'import', 'columns', 'mapping', 'table'],
    related: ['products-import', 'column-names-guide']
  },
  // STRATEGY
  {
    id: 'strategy-weights',
    category: 'strategy',
    title: 'Strategy Weights Configurator',
    description: 'Πώς να ρυθμίσετε τους παράγοντες προτεραιοποίησης',
    content: `Το Strategy Weights Configurator σας επιτρέπει να προσαρμόσετε πώς το σύστημα προτεραιοποιεί προϊόντα.

**Διαθέσιμοι παράγοντες:**
1. **Profitability** (💰): Margin και profit potential
2. **Inventory** (📦): Stock levels και stock age
3. **Strategic** (🎯): Priority tags και brand flags
4. **Revenue** (📈): Historical revenue performance
5. **Customer Fit** (👥): Affinity με RFM segments

**Πώς λειτουργεί:**
- Κάθε παράγοντας έχει βάρος από 0% έως 100%
- Το σύνολο πρέπει να είναι 100%
- Το σύστημα υπολογίζει composite score για κάθε προϊόν
- Προϊόντα με υψηλότερο score προτεραιοποιούνται

**Preset Scenarios:**
- **Profit Maximization**: Εστίαση σε margin
- **Stock Clearance**: Εστίαση σε excess/dead stock
- **Revenue Push**: Εστίαση σε volume
- **Brand Launch**: Εστίαση σε strategic flags

Μπορείτε να αποθηκεύσετε custom scenarios για γρήγορη πρόσβαση.`,
    tags: ['strategy', 'weights', 'prioritization'],
    related: ['scenarios', 'composite-score'],
    steps: [
      'Επιλέξτε scenario ή δημιουργήστε custom',
      'Ρυθμίστε τα βάρη για κάθε παράγοντα',
      'Δείτε το preview των top 10 προϊόντων',
      'Αποθηκεύστε το scenario αν θέλετε',
      'Εφαρμόστε για να δημιουργήσετε prioritized feed'
    ],
    tips: [
      'Ξεκινήστε με preset scenarios για να κατανοήσετε τη λογική',
      'Χρησιμοποιήστε το preview για να δείτε πώς αλλάζουν τα rankings',
      'Αποθηκεύστε διαφορετικά scenarios για διαφορετικές περιόδους',
      'Συνδυάστε multiple factors για balanced approach'
    ]
  },
  {
    id: 'scenarios',
    category: 'strategy',
    title: 'Scenarios & Presets',
    description: 'Πώς να χρησιμοποιήσετε και να δημιουργήσετε scenarios',
    content: `**Preset Scenarios:**

1. **Profit Maximization** (💰)
   - Profitability: 50%
   - Strategic: 30%
   - Revenue: 20%
   - Ιδανικό για: Premium positioning, high-margin focus

2. **Stock Clearance** (📦)
   - Inventory: 60%
   - Revenue: 30%
   - Customer Fit: 10%
   - Ιδανικό για: Excess/dead stock reduction

3. **Revenue Push** (📈)
   - Revenue: 50%
   - Customer Fit: 30%
   - Profitability: 20%
   - Ιδανικό για: Volume growth, sales targets

4. **Brand Launch** (🚀)
   - Strategic: 50%
   - Customer Fit: 30%
   - Revenue: 20%
   - Ιδανικό για: New product launches

**Custom Scenarios:**
Μπορείτε να δημιουργήσετε και να αποθηκεύσετε τα δικά σας scenarios με custom weights.`,
    tags: ['scenarios', 'presets', 'strategy'],
    related: ['strategy-weights', 'approval-workflow']
  },
  // RFM
  {
    id: 'rfm-analysis',
    category: 'rfm',
    title: 'RFM Analysis - Βασικές Έννοιες',
    description: 'Κατανόηση του RFM segmentation model',
    content: `Το RFM (Recency, Frequency, Monetary) είναι ένα μοντέλο segmentation που κατηγοριοποιεί πελάτες βάσει:

**R - Recency**: Πόσο πρόσφατα αγόρασε ο πελάτης
- 5: Πολύ πρόσφατα (π.χ. <30 ημέρες)
- 1: Πολύ παλιά (π.χ. >180 ημέρες)

**F - Frequency**: Πόσο συχνά αγοράζει
- 5: Πολύ συχνά (π.χ. >10 orders)
- 1: Σπάνια (π.χ. 1 order)

**M - Monetary**: Πόσο ξοδεύει
- 5: Πολύ υψηλό (π.χ. >€500)
- 1: Πολύ χαμηλό (π.χ. <€50)

**Common Segments:**
- **Champions** (5-5-5): Best customers, high value
- **Loyal** (4-4-4): Regular customers, good value
- **Potential** (3-3-3): New or occasional customers
- **At Risk** (2-2-2): Declining engagement
- **Lost** (1-1-1): Inactive customers

**Μέση RFM Score:**
Υπολογίζεται ως μέσος όρος των R, F, M scores για όλα τα segments.`,
    tags: ['rfm', 'segmentation', 'customers'],
    related: ['understanding-segments', 'segment-migration'],
    faq: [
      {
        question: 'Πώς υπολογίζεται το Avg Segment Score;',
        answer: 'Είναι ο μέσος όρος των RFM scores (R+F+M)/3 για όλα τα segments. Αν ένα segment έχει range (π.χ. "5-5-5 to 4-4-4"), χρησιμοποιείται το μέσο.'
      },
      {
        question: 'Τι σημαίνει Segment Migration;',
        answer: 'Είναι η μετακίνηση πελατών από ένα segment σε άλλο με την πάροδο του χρόνου. Βοηθά να εντοπίσετε trends (π.χ. Loyal → At Risk).'
      }
    ]
  },
  {
    id: 'understanding-segments',
    category: 'rfm',
    title: 'Κατανόηση των Segments',
    description: 'Τι σημαίνει κάθε RFM segment',
    content: `**Champions (5-5-5)**
- Best customers, high value και recent
- Strategy: Exclusive offers, early access, loyalty rewards
- Revenue share: Συνήθως 30-50% του total revenue

**Loyal (4-4-4)**
- Regular customers με consistent purchases
- Strategy: Retention campaigns, cross-sell opportunities
- Revenue share: Συνήθως 20-30%

**Potential (3-3-3)**
- New ή occasional customers με potential
- Strategy: Acquisition campaigns, engagement boosters
- Revenue share: Συνήθως 10-20%

**At Risk (2-2-2)**
- Declining engagement, risk of churn
- Strategy: Win-back campaigns, special offers
- Revenue share: Συνήθως 5-15%

**Lost (1-1-1)**
- Inactive customers
- Strategy: Reactivation campaigns (low priority)
- Revenue share: Συνήθως <5%`,
    tags: ['segments', 'rfm', 'strategy'],
    related: ['rfm-analysis', 'channel-recommendations']
  },
  // PRODUCTS
  {
    id: 'products-intelligence',
    category: 'products',
    title: 'Product Intelligence',
    description: 'Κατανόηση του inventory και product management',
    content: `Το Product Intelligence section σας δίνει πλήρη εικόνα για:

**Inventory Summary:**
- **Total SKUs**: Συνολικός αριθμός προϊόντων
- **Healthy Stock**: Προϊόντα με stock 20-80% capacity και age <180 days
- **Excess Stock**: Προϊόντα με stock >80% capacity
- **Dead Stock**: Προϊόντα με stock age >180 days

**Product Details:**
Για κάθε προϊόν βλέπετε:
- Stock level vs capacity
- Stock age (days)
- Margin percentage
- Price
- Priority tag
- Composite score (αν έχει εφαρμοστεί strategy)

**Actions:**
- Filter και sort προϊόντα
- Export prioritized feed
- View detailed product information`,
    tags: ['products', 'inventory', 'stock'],
    related: ['stock-clearance', 'strategy-weights'],
    tips: [
      'Χρησιμοποιήστε filters για να βρείτε γρήγορα excess/dead stock',
      'Το Stock Age υπολογίζεται από First Available Date ή createdAt',
      'Priority Tags βοηθούν στη strategic prioritization'
    ]
  },
  {
    id: 'stock-clearance',
    category: 'products',
    title: 'Stock Clearance Strategy',
    description: 'Πώς να διαχειριστείτε excess και dead stock',
    content: `**Stock Clearance** είναι το revenue που προέκυψε από την πώληση υπερπλήρων ή παλαιών αποθεμάτων.

**Πώς λειτουργεί:**
1. Το σύστημα εντοπίζει excess stock (>80% capacity) και dead stock (>180 days)
2. Προτείνεται να προωθηθούν σε specific segments (π.χ. At Risk, Potential)
3. Δημιουργούνται targeted campaigns
4. Το revenue από αυτές τις πωλήσεις trackάρεται ως Stock Clearance

**Best Practices:**
- Target At Risk και Potential segments για clearance
- Χρησιμοποιήστε urgency messaging
- Bundle deals για dead stock
- Flash sales για excess stock

**Cost Savings:**
Εκτός από revenue, το clearance εξοικονομεί:
- Warehousing costs
- Storage fees
- Opportunity cost από tied-up capital`,
    tags: ['stock', 'clearance', 'inventory'],
    related: ['products-intelligence', 'channel-recommendations']
  },
  // CHANNELS
  {
    id: 'channel-activation',
    category: 'channels',
    title: 'Channel Activation',
    description: 'Πώς να χρησιμοποιήσετε τις channel recommendations',
    content: `Το Channel Activation σας δίνει AI-powered recommendations για:

**Channel Mix Optimization:**
- Προτάσεις για budget allocation ανά channel
- Expected ROAS για κάθε channel
- Target segments για κάθε channel
- Priority products για promotion

**Channels:**
- Google Shopping
- Meta Ads (Facebook/Instagram)
- Email Marketing
- SMS Campaigns
- Display/Remarketing

**Πώς λειτουργεί:**
1. Το σύστημα αναλύει τα products, segments, και strategy
2. Προτείνει optimal channel mix
3. Δίνει budget allocation recommendations
4. Προτείνει target segments και products

**Budget Allocation:**
- Total budget κατανέμεται ανά channel
- Κάθε channel έχει expected ROAS
- Προτείνονται specific segments και products`,
    tags: ['channels', 'marketing', 'budget'],
    related: ['strategy-weights', 'understanding-segments'],
    tips: [
      'Χρησιμοποιήστε το channel mix chart για visual representation',
      'Κάθε channel έχει rationale γιατί προτείνεται',
      'Expected ROAS βασίζεται σε historical data και segment affinity'
    ]
  },
  // ROI
  {
    id: 'roi-attribution-basics',
    category: 'roi',
    title: 'ROI Attribution - Βασικές Έννοιες',
    description: 'Πώς να κατανοήσετε το ROI attribution',
    content: `Το ROI Attribution μετράει την επιπτώση του Performance+ στο business σας.

**Κύρια Metrics:**
- **Total Revenue**: Συνολικό εισόδημα
- **P+ Attributed**: Revenue που αποδίδεται στο Performance+
- **Attribution Rate**: Ποσοστό του total revenue που είναι attributed
- **ROI Multiplier**: Πόσες φορές επιστρέφει το investment (π.χ. 64x)

**Attribution Methodology:**
1. **Segment Campaign Attribution**: Revenue από campaigns που στοχεύουν RFM segments
2. **Product Prioritization**: Revenue από prioritized products
3. **Stock Clearance**: Revenue από excess/dead stock sales
4. **Channel Optimization**: Incremental ROAS improvement

**Breakdown:**
- Segment Activation: Revenue από segment-specific campaigns
- Inventory Optimization: Stock clearance revenue
- Channel Optimization: ROAS improvements

**Cost Savings:**
Εκτός από revenue, μετράμε:
- Warehousing costs avoided
- Google CSS savings
- Ad spend efficiency
- Content production savings`,
    tags: ['roi', 'attribution', 'performance'],
    related: ['dashboard-overview', 'analytics-import'],
    faq: [
      {
        question: 'Πώς υπολογίζεται το ROI Multiplier;',
        answer: 'Είναι το Performance+ Attributed Revenue διαιρεμένο με το Subscription Cost. Αν το attributed revenue είναι €64K και το subscription €1K, το ROI είναι 64x.'
      },
      {
        question: 'Τι σημαίνει "Attribution Rate";',
        answer: 'Είναι το ποσοστό του total revenue που αποδίδεται στο Performance+. Αν το total είναι €100K και το attributed €30K, το rate είναι 30%.'
      }
    ]
  },
  // DASHBOARD
  {
    id: 'understanding-kpis',
    category: 'dashboard',
    title: 'Κατανόηση των KPIs',
    description: 'Τι σημαίνει κάθε KPI στο Dashboard',
    content: `**Total Revenue (€XK)**
- Συνολικό εισόδημα από όλες τις πωλήσεις
- Δείχνει "X% attributed" για το ποσοστό που αποδίδεται στο Performance+

**Products**
- Συνολικός αριθμός προϊόντων στο σύστημα
- Clickable για να δείτε Product Intelligence

**Segments**
- Αριθμός RFM segments
- Δείχνει "X avg score" για μέσο RFM score

**Campaigns**
- Αριθμός ενεργών marketing campaigns
- Clickable για Channel Activation

**Stock Clearance (€XK)**
- Revenue από πώληση excess/dead stock
- Tooltip: "Το συνολικό ποσό εσόδων που προέκυψε από την πώληση υπερπλήρων ή παλαιών αποθεμάτων"

**Cost Savings (€XK)**
- Χρήματα που εξοικονομήθηκαν
- Tooltip: "Το συνολικό ποσό χρημάτων που εξοικονομήθηκε μέσω βελτιώσεων λειτουργικής αποδοτικότητας"`,
    tags: ['kpis', 'dashboard', 'metrics'],
    related: ['dashboard-overview', 'roi-attribution-basics']
  },
  // TROUBLESHOOTING
  {
    id: 'common-issues',
    category: 'troubleshooting',
    title: 'Συχνά Προβλήματα',
    description: 'Λύσεις σε κοινά προβλήματα',
    content: `**Δεδομένα δεν εμφανίζονται:**
- Ελέγξτε ότι έχετε κάνει import δεδομένα
- Ελέγξτε ότι τα δεδομένα είναι για το σωστό brand
- Refresh τη σελίδα

**Validation errors στο import:**
- Χρησιμοποιήστε το template για σωστό format
- Ελέγξτε ότι οι ημερομηνίες είναι YYYY-MM-DD
- Ελέγξτε ότι τα required fields είναι συμπληρωμένα

**Charts δεν εμφανίζουν data:**
- Βεβαιωθείτε ότι έχετε importάρει analytics data
- Ελέγξτε ότι τα dates είναι σωστά formatted
- Μπορεί να χρειάζεται Firestore index (θα εμφανιστεί error message)

**RFM Score shows 0:**
- Ελέγξτε ότι τα segments έχουν RFM Score field
- Αν λείπει, το σύστημα θα προσπαθήσει να το υπολογίσει από το name

**Currency symbols:**
- Όλα τα amounts εμφανίζονται σε € (Euro)
- Icons χρησιμοποιούν Euro symbol`,
    tags: ['troubleshooting', 'issues', 'help'],
    related: ['data-import-basics'],
    faq: [
      {
        question: 'Γιατί δεν βλέπω revenue data στο chart;',
        answer: 'Βεβαιωθείτε ότι έχετε importάρει analytics data με Date, Total Revenue, και Attributed Revenue fields. Ελέγξτε ότι το date format είναι YYYY-MM-DD.'
      },
      {
        question: 'Πώς μπορώ να διορθώσω validation errors;',
        answer: 'Κάντε κλικ στο error message για να δείτε το row και το field που έχει πρόβλημα. Χρησιμοποιήστε το template για reference.'
      }
    ]
  }
];

// Helper function to get articles by category
export function getArticlesByCategory(categoryId: string): KnowledgeArticle[] {
  return knowledgeArticles.filter(article => article.category === categoryId);
}

// Helper function to search articles
export function searchArticles(query: string): KnowledgeArticle[] {
  const lowerQuery = query.toLowerCase();
  return knowledgeArticles.filter(article =>
    article.title.toLowerCase().includes(lowerQuery) ||
    article.description.toLowerCase().includes(lowerQuery) ||
    article.content.toLowerCase().includes(lowerQuery) ||
    article.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

// Helper function to get article by ID
export function getArticleById(id: string): KnowledgeArticle | undefined {
  return knowledgeArticles.find(article => article.id === id);
}
