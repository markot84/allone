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
    icon: 'GS',
    description: 'Βασικές έννοιες και πρώτα βήματα',
    color: '#6B7280'
  },
  {
    id: 'data-import',
    title: 'Εισαγωγή Δεδομένων',
    icon: 'DI',
    description: 'Πώς να φορτώσετε και να διαχειριστείτε δεδομένα',
    color: '#6B7280'
  },
  {
    id: 'strategy',
    title: 'Στρατηγική Προτεραιοποίησης',
    icon: 'SW',
    description: 'Ρύθμιση βαρών και στρατηγικών',
    color: '#6B7280'
  },
  {
    id: 'rfm',
    title: 'RFM Ανάλυση',
    icon: 'DA',
    description: 'Κατανόηση των customer segments',
    color: '#6B7280'
  },
  {
    id: 'products',
    title: 'Product Intelligence',
    icon: 'PI',
    description: 'Διαχείριση προϊόντων και αποθεμάτων',
    color: '#6B7280'
  },
  {
    id: 'channels',
    title: 'Channel Activation',
    icon: 'CA',
    description: 'Προτάσεις καναλιών και budget allocation',
    color: '#6B7280'
  },
  {
    id: 'content',
    title: 'Content Strategy',
    icon: 'CS',
    description: 'Συγχρονισμός περιεχομένου με στρατηγική',
    color: '#6B7280'
  },
  {
    id: 'roi',
    title: 'ROI Attribution',
    icon: 'RA',
    description: 'Μέτρηση επιπτώσης Performance+',
    color: '#6B7280'
  },
  {
    id: 'dashboard',
    title: 'Dashboard & Analytics',
    icon: 'DB',
    description: 'Ερμηνεία δεδομένων και KPIs',
    color: '#6B7280'
  },
  {
    id: 'troubleshooting',
    title: 'Αντιμετώπιση Προβλημάτων',
    icon: 'TR',
    description: 'Συχνά προβλήματα και λύσεις',
    color: '#6B7280'
  },
  {
    id: 'coordination',
    title: 'Συντονισμός Τμημάτων',
    icon: 'CO',
    description: 'Briefing Board, αποφάσεις και συντονισμός ομάδων',
    color: '#6B7280'
  },
  {
    id: 'automation',
    title: 'Αυτοματισμοί',
    icon: 'AU',
    description: 'Smart triggers και αυτόματη λήψη αποφάσεων',
    color: '#6B7280'
  },
  {
    id: 'connectors',
    title: 'Connectors & E-commerce',
    icon: 'EC',
    description: 'Σύνδεση e-shop, analytics και e-commerce explorer',
    color: '#F97316'
  },
  {
    id: 'competitive',
    title: 'Ανταγωνισμός & Τιμές',
    icon: 'CI',
    description: 'Price benchmarking και competitor monitoring',
    color: '#0D652D'
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

Βελτιστοποιήσετε την προτεραιοποίηση προϊόντων μέσω multi-factor scoring
Κατανοήσετε τους πελάτες σας με RFM segmentation
Αυξήσετε το ROI μέσω data-driven decisions
Συγχρονίσετε το περιεχόμενο με την εμπορική στρατηγική

Η πλατφόρμα συνδυάζει:
- Product Intelligence για αποθέματα και προτεραιοποίηση
- RFM Analysis για customer segmentation
- Commercial Strategy για προσαρμοσμένη στρατηγική
- Channel Activation για budget optimization
- ROI Attribution για μέτρηση επιπτώσεων
- E-commerce Explorer για ενοποιημένα δεδομένα e-shop (Shopify, WooCommerce, OpenCart, Magento)
- Web Analytics (GA4) για traffic, sessions και conversions
- Connectors για αυτόματο sync δεδομένων από εξωτερικές πλατφόρμες`,
    tags: ['basics', 'overview', 'introduction'],
    related: ['data-import-basics', 'dashboard-overview']
  },
  {
    id: 'dashboard-overview',
    category: 'getting-started',
    title: 'Επισκόπηση Dashboard',
    description: 'Κατανόηση των βασικών KPIs και metrics',
    content: `Το Dashboard σας δίνει μια ολοκληρωμένη εικόνα της απόδοσης σας.

Κύρια KPIs:
- Total Revenue: Συνολικό εισόδημα (και ποσοστό εσόδων καμπανιών όπου υπάρχει στο import)
- Products: Συνολικός αριθμός προϊόντων στο σύστημα
- Segments: RFM segments με μέσο score
- Campaigns: Ενεργά campaigns

Charts & Visualizations:
- Revenue Performance: τζίρος e-shop (αν υπάρχει σύνδεση) vs έσοδα που αναφέρουν οι πλατφόρμες διαφημίσεων (conversion value)
- Customer Segments: Κατανομή πελατών ανά segment
- Performance Summary: Stock Clearance, Cost Savings, ROI

E-commerce Card: Αν έχετε συνδεδεμένο e-shop (Shopify, WooCommerce κλπ), εμφανίζεται summary card με e-shop Revenue, Παραγγελίες, AOV, top platform και mini sparkline. Κλικ → E-commerce Explorer.

GA4 Card: Αν είναι συνδεδεμένο το GA4, εμφανίζεται summary card με sessions, users, conversions. Κλικ → Web Analytics.

AI Insights: Προτάσεις για βελτίωση απόδοσης

Κάθε KPI card και summary card είναι clickable και σας οδηγεί στην αντίστοιχη λεπτομερή ανάλυση.`,
    tags: ['dashboard', 'kpis', 'metrics'],
    related: ['understanding-kpis', 'roi-attribution-basics', 'ai-briefing'],
    tips: [
      'Κάντε hover πάνω στα labels για tooltips με εξηγήσεις',
      'Κάντε κλικ στα KPI cards για να δείτε λεπτομερή ανάλυση',
      'Το AI Briefing στην κορυφή σας δίνει αυτόματη σύνοψη κατάστασης'
    ]
  },
  {
    id: 'ai-briefing',
    category: 'dashboard',
    title: 'AI Briefing — Αυτόματη Ενημέρωση',
    description: 'Πώς λειτουργεί η AI-powered σύνοψη στην κορυφή του Dashboard',
    content: `# AI Briefing

Το AI Briefing είναι μια αυτοματοποιημένη, narrative-first σύνοψη που εμφανίζεται στην κορυφή του Dashboard. Αντί για δεκάδες KPIs, σας δίνει σε 10 δευτερόλεπτα μια ολοκληρωμένη εικόνα της κατάστασης της επιχείρησής σας.

## Πώς λειτουργεί

### Αυτόματη δημιουργία (1x/ημέρα)
Κατά την πρώτη σας είσοδο στην εφαρμογή κάθε ημέρα, το σύστημα δημιουργεί αυτόματα ένα νέο briefing. Αναλύει:
- Έσοδα & ROAS — organic + campaign revenue, ad spend
- E-commerce performance — e-shop Revenue, Orders, AOV, True ROAS, Revenue Gap (όταν υπάρχουν συνδεδεμένα e-shop δεδομένα)
- Traffic — sessions, users, conversions, εβδομαδιαίες μεταβολές (GA4)
- Απόθεμα — dead stock, low stock σε best sellers, δεσμευμένο κεφάλαιο
- Segments — At Risk %, Champions %, μεγέθη segments
- Campaigns — top/worst performers by ROAS
- Alerts — ενεργά automation alerts

### Smart Auto-Update
Κάθε 10 λεπτά, το σύστημα ελέγχει αν κάτι σημαντικό άλλαξε. Ενημερώνεται αυτόματα μόνο αν:
- Τα έσοδα μεταβλήθηκαν ±20% ή περισσότερο
- Το ROAS έπεσε 30%+
- Εμφανίστηκε νέο critical alert
- Εντοπίστηκαν 15+ νέα dead stock προϊόντα
- Το At Risk segment αυξήθηκε 5+ ποσοστιαίες μονάδες

### Προστασία από υπερβολική χρήση
- Μέγιστο 4 generations ανά ημέρα
- Cooldown 1 ώρα μεταξύ auto-updates
- Χωρίς update αν δεν υπάρχει σημαντική αλλαγή

## Ένδειξη Επείγοντος
Όταν γίνεται auto-update λόγω σημαντικής αλλαγής, το briefing εμφανίζει:
- Amber border αντί για το κανονικό
- Badge "Ενημερώθηκε" δίπλα στον τίτλο
- Τον λόγο ενημέρωσης κάτω από την ώρα δημιουργίας

## Action Items
Κάθε briefing περιλαμβάνει 3 προτεινόμενες ενέργειες σε διαφορετικούς τομείς (Campaigns, Inventory, Segments, Traffic, Content). Κάθε ενέργεια είναι clickable και σας οδηγεί στη σχετική σελίδα.`,
    tags: ['ai', 'briefing', 'dashboard', 'automation', 'gemini'],
    related: ['dashboard-overview', 'understanding-kpis'],
    tips: [
      'Το briefing δημιουργείται αυτόματα — δεν χρειάζεται κάποια ενέργεια από εσάς',
      'Αν δείτε amber border, σημαίνει ότι κάτι σημαντικό άλλαξε στα δεδομένα',
      'Κάντε κλικ στις ενέργειες για να πλοηγηθείτε άμεσα στη σχετική σελίδα',
      'Τα e-commerce metrics (e-shop Revenue, AOV, True ROAS) συμμετέχουν πλέον στη λογική του briefing όταν υπάρχουν connector δεδομένα'
    ],
    faq: [
      {
        question: 'Πόσο συχνά ενημερώνεται το briefing;',
        answer: 'Μία φορά αυτόματα κατά την πρώτη είσοδο της ημέρας. Ενημερώνεται αυτόματα αν εντοπιστεί σημαντική αλλαγή, με μέγιστο 4 φορές ανά ημέρα.'
      },
      {
        question: 'Τι σημαίνει η κίτρινη ένδειξη "Ενημερώθηκε";',
        answer: 'Σημαίνει ότι το briefing ενημερώθηκε αυτόματα λόγω σημαντικής μεταβολής στα δεδομένα σας (π.χ. πτώση ROAS, αύξηση εσόδων, νέο critical alert).'
      },
      {
        question: 'Ποια δεδομένα χρησιμοποιεί;',
        answer: 'Αξιοποιεί όλα τα υπάρχοντα δεδομένα: organic revenue, campaigns, GA4 analytics, product inventory, RFM segments, automation alerts και (όταν υπάρχουν) e-commerce metrics όπως e-shop Revenue, Orders, AOV και True ROAS.'
      }
    ]
  },
  {
    id: 'data-import-basics',
    category: 'data-import',
    title: 'Βασικές Αρχές Εισαγωγής Δεδομένων',
    description: 'Πώς να φορτώσετε δεδομένα στην πλατφόρμα',
    content: `Η εισαγωγή δεδομένων είναι το πρώτο βήμα για να ξεκινήσετε.

Υποστηριζόμενοι τύποι δεδομένων:
1. Products: Προϊόντα με SKU, τιμή, stock, margin
2. RFM Segments: Customer segments με RFM scores
3. Analytics: Revenue και performance data
4. Campaigns: Marketing campaigns

Μέθοδοι εισαγωγής:
- CSV/XLSX files: Upload από τον υπολογιστή σας
- URL links: Direct link σε CSV/Excel files online
- Connectors: Αυτόματο sync μέσω API — Google Ads, Meta, GA4, Shopify, WooCommerce, OpenCart, Magento, Merchant Center

Βήματα:
1. Μεταβείτε στο τμήμα Συνδέσεις & εισαγωγή
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
    content: `Το official product import είναι πλέον ένα single flat ERP sheet για το products collection. Το Enterprise procurement workbook 7 sheets παραμένει ξεχωριστό και δεν αλλάζει.

Required:
- SKU_ID
- Product_Name
- Category
- Sell_Price
- Cost_Price
- Stock_On_Hand

Strongly recommended:
- Supplier
- Brand
- Barcode / GTIN
- Qty_Sold_Period
- Revenue_Period
- Gross_Margin_%
- First_Available_Date
- Last_Sale_Date

Optional αλλά χρήσιμα:
- Subcategory
- Status
- List_Price / Compare_At_Price
- Available_Stock
- Reorder_Point
- Reorder_Qty
- ABC_Class
- Flow_Group / Product_Segment
- Seasonality_Tag
- Priority_Flag

Margin Tier:
- high: >30%
- medium: 15-30%
- low: <15%

Derive logic:
- Αν λείπει το Gross_Margin_%, υπολογίζεται από Sell_Price και Cost_Price
- Αν λείπει το Stock_Age_Days, υπολογίζεται από το First_Available_Date
- Αν υπάρχει Available_Stock, χρησιμοποιείται ως βασικό διαθέσιμο stock στα downstream modules

Validation:
Το σύστημα ελέγχει ότι:
- SKU ή Name υπάρχει
- Price >= 0
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
        answer: 'Το σύστημα αναγνωρίζει αυτόματα πολλές εκδοχές ονομάτων. Δείτε το πίνακα "Αντιστοίχιση Στηλών" στις Συνδέσεις για όλες τις πιθανές εκδοχές.'
      }
    ]
  },
  {
    id: 'segments-import',
    category: 'data-import',
    title: 'Εισαγωγή Segments (RFM + Behavioral + Predictive)',
    description: 'Πώς να φορτώσετε customer segments με behavioral και predictive data',
    content: `Υποχρεωτικά πεδία (RFM):
- Name: Όνομα segment (π.χ. Champions, Loyal, At Risk)
- RFM Score: Score format (π.χ. "5-5-5" ή "5-5-5 to 4-4-4")
- Count: Αριθμός πελατών στο segment
- Percentage: Ποσοστό του total customer base

Προαιρετικά RFM:
- Revenue Share: Ποσοστό revenue από segment
- Color: Hex color για visualization
- Description: Περιγραφή του segment

Behavioral πεδία (προαιρετικά):
- persona: Τύπος πελάτη (π.χ. Power Buyer, Fading Customer)
- lifecycle_stage: new, active, loyal, declining, dormant
- purchase_frequency: daily, weekly, monthly, quarterly, rare
- avg_basket_size: Μέση αξία καλαθιού (αριθμός)
- upsell_score: 0-100 score upsell πιθανότητας
- cross_sell_score: 0-100 score cross-sell πιθανότητας
- engagement_score: 0-100 engagement score
- price_sensitivity: low, medium, high
- device_preference: mobile, desktop, mixed
- preferred_channels: Κανάλια χωρισμένα με κόμμα (π.χ. "Email,SMS,Remarketing")
- peak_hours: Ώρες αιχμής (π.χ. "10:00-12:00,20:00-22:00")
- peak_days: Ημέρες αιχμής (π.χ. "Δευτέρα,Πέμπτη")
- payment_method: Τρόπος πληρωμής

Predictive πεδία (προαιρετικά):
- estimated_ltv / ltv: Εκτιμώμενη αξία ζωής πελάτη
- churn_risk: 0-100 ποσοστό κινδύνου churn
- churn_risk_label: low, medium, high, critical
- next_purchase_probability: 0-100 πιθανότητα επόμενης αγοράς
- days_to_next_purchase: Εκτίμηση ημερών μέχρι επόμενη αγορά
- predicted_next_order_value: Προβλεπόμενη αξία επόμενης παραγγελίας
- revenue_forecast_30d: Πρόβλεψη εσόδων 30 ημερών
- revenue_forecast_90d: Πρόβλεψη εσόδων 90 ημερών
- demand_trend: growing, stable, declining
- retention_score: 0-100 δείκτης διατήρησης

Πιθανές Εκδοχές Ονομάτων Στηλών:

Name: Name, Segment_Name, Segment, Label, Group, Customer_Segment
RFM Score: RFM_Score, Score, RFM, R_Score + F_Score + M_Score
Count: Count, Customer_Count, Customers, Size, Total
Percentage: Percentage, Percent, Pct, %
Revenue Share: Revenue_Share, Revenue, Revenue_Pct, Rev_Share
Color: Color, Colour, Hex
Description: Description, Desc, Note, Notes, Behavioral_Persona, Tier

Αν δεν υπάρχουν behavioral/predictive στήλες, η εφαρμογή θα τα υπολογίσει αυτόματα (rule-based) από τα RFM δεδομένα. Αν εισαχθούν, αντικαθιστούν τα αυτόματα.`,
    tags: ['segments', 'rfm', 'customers', 'behavioral', 'predictive', 'ltv', 'churn'],
    related: ['rfm-analysis', 'understanding-segments', 'column-names-guide']
  },
  {
    id: 'analytics-import',
    category: 'data-import',
    title: 'Εισαγωγή Analytics Data',
    description: 'Πώς να φορτώσετε revenue και performance data',
    content: `Υποχρεωτικά πεδία:
- Date: Ημερομηνία σε format YYYY-MM-DD
- Total Revenue: Συνολικό εισόδημα (σε units, π.χ. 50000 για €50K)
- Campaigns Revenue: Έσοδα καμπανιών / Performance+ (σε units). (Στο CSV import υποστηρίζονται και παλιά ονόματα στηλών — δες τη λίστα «Πιθανές εκδοχές» παρακάτω.)
- Attribution Rate: Ποσοστό attribution (π.χ. 30.0 για 30%)

Πιθανές Εκδοχές Ονομάτων Στηλών:

Date:
Date, date, Date_Time, date_time, Timestamp, timestamp, Period, period, Month, month, Year_Month, year_month, Data, data, Ημερομηνία, ημερομηνία, Ημ/νία, ημ/νία

Total Revenue:
Total_Revenue, Total Revenue, total_revenue, Revenue, revenue, Total, total, Total_Rev, total_rev, Revenue_Total, revenue_total

Campaigns Revenue:
Campaigns_Revenue, Campaigns Revenue, campaigns_revenue, campaigns_rev, Attributed_Revenue, Attributed Revenue, attributed_revenue, Attributed, attributed, Attributed_Rev, attributed_rev, Performance_Plus_Revenue, performance_plus_revenue, PP_Revenue, pp_revenue
(σημ.: τα «Attributed*» / «attributed*» είναι μόνο συμβατότητα με παλιά exports — το νόημα είναι «έσοδα καμπανιών».)

Attribution Rate:
Attribution_Rate, Attribution Rate, attribution_rate, Attribution_%, attribution_%, Attribution_Percentage, attribution_percentage, Rate, rate

Format:
\`\`\`csv
Date,Total Revenue,Campaigns Revenue,Attribution Rate
2026-01-01,50000,15000,30.0
2026-02-01,52000,18000,34.6
\`\`\`

Σημειώσεις:
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
    content: `Υποστηριζόμενα κανάλια:
- Google Ads
- Meta (Facebook/Instagram)

Υποχρεωτικά πεδία:
- Campaign Name: Όνομα καμπάνιας
- Channel: Google Ads ή Meta (αναγνωρίζεται αυτόματα)
- Amount Spent: Ποσό που δαπανήθηκε
- Impressions: Αριθμός εμφανίσεων
- Clicks: Αριθμός κλικ

Πιθανές Εκδοχές Ονομάτων Στηλών:

Campaign Name:
Campaign_Name, Campaign Name, campaign_name, Campaign, campaign, Name, name, Campaign_Name_, campaignname, Campaign-Name

Channel:
Channel, channel, Channel_Name, channel_name, Source, source, Platform, platform

Amount Spent:
Amount_Spent_(EUR), Amount Spent (EUR), amount_spent_eur, Amount_Spent, amount_spent, Cost, cost, Spend, spend, Total_Cost, total_cost, Spent, spent

Impressions:
Impressions, impressions, Impr., impr., Impr, impr, Imp, imp

Clicks:
Clicks_(all), Clicks (all), clicks, Click, click, Clicks_All, clicks_all

CTR:
CTR_(all), CTR (all), ctr, Click_Through_Rate, click_through_rate, CTR_All, ctr_all

CPC:
CPC_(all), CPC (all), Avg._CPC, Avg. CPC, cpc, Cost_Per_Click, cost_per_click, Avg_CPC, avg_cpc, CPC_All, cpc_all

Conversions/Purchases:
Conversions, conversions, Purchases, purchases, Conv., conv.

Conversion Value:
Conversion_Value, Conversion Value, conversion_value, Purchases_Conversion_Value, Purchases conversion value, Purchase_ROAS, Purchase ROAS

ROAS:
ROAS, roas, Conv._Value_/_Cost, Conv. Value / Cost, Conv_Value_/_Cost

Period/Month:
Month, month, Period, period, Date_Range, date_range, Reporting_Starts, reporting starts, Reporting_Ends, reporting ends

Σημειώσεις:
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

Πώς λειτουργεί:
- Το σύστημα αναζητά case-insensitive matches
- Υποστηρίζει underscores, spaces, και διάφορες μορφές
- Υποστηρίζει ελληνικά και αγγλικά ονόματα
- Αν δεν βρει ακριβή match, κάνει partial matching

Για κάθε template:
- Products: Δείτε "Εισαγωγή Προϊόντων" για όλες τις εκδοχές
- Campaigns: Δείτε "Εισαγωγή Campaigns" για Google Ads & Meta
- Analytics: Δείτε "Εισαγωγή Analytics Data" για revenue columns
- Segments: Δείτε "Εισαγωγή RFM Segments" για segment columns

Συμβουλές:
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
    content: `Ο παρακάτω πίνακας δείχνει όλες τις πιθανές εκδοχές ονομάτων που αναγνωρίζει το σύστημα για κάθε πεδίο προϊόντων στο flat ERP import.

SKU/ID:
SKU_ID, SKU, sku_id, sku, ID, id, Product_ID, product_id, Item_ID, item_id, Item ID, item id, Code, code, Κωδικός, κωδικός, Barcode, barcode, EAN, ean

Product Name:
Product_Name, Product Name, product_name, Name, name, Product, product, Title, title, Item, item, Item_Name, item_name, Description, description, Product_Title, product_title, Όνομα, όνομα, Προϊόν, προϊόν, Περιγραφή, περιγραφή

Category:
Category, category, Product_Category, product_category, Group, group, Κατηγορία, κατηγορία, Type, type, Department, department

Subcategory:
Subcategory, sub_category, sub-category, subcategory, Sub_Category, Sub Category, Υποκατηγορία, υποκατηγορία

Brand:
Brand, brand, Manufacturer, manufacturer, Vendor_Brand, vendor_brand, Μάρκα, μάρκα

Barcode / GTIN:
Barcode, barcode, GTIN, gtin, EAN, ean, UPC, upc, Bar_Code, bar_code

Status:
Status, status, Product_Status, product_status, Item_Status, item_status, Κατάσταση_Προϊόντος, κατάσταση_προϊόντος

Price:
Sell_Price, Sell Price, sell_price, Price, price, Unit_Price, unit_price, Retail_Price, retail_price, MSRP, msrp, Τιμή, τιμή

List / Compare Price:
List_Price, List Price, list_price, Compare_At_Price, compare_at_price, Compare At Price, compare_at, MSRP, Catalog_Price, catalog_price, Τιμοκατάλογος, τιμοκατάλογος

Cost Price:
Cost_Price, Cost Price, cost_price, Cost, cost, Κόστος, κόστος

Stock On Hand / Stock Level:
Stock_On_Hand, Stock On Hand, stock_on_hand, Stock_Level, stock_level, Stock, stock, Quantity, quantity, Qty, qty, Inventory, inventory, On_Hand, on_hand, Units, units, Απόθεμα, απόθεμα, Ποσότητα, ποσότητα, Available_Stock, available_stock, Δυναμικό_Υπόλοιπο, δυναμικό_υπόλοιπο, Κίνηση, κίνηση

Available Stock:
Available_Stock, Available Stock, available_stock, Sellable_Stock, sellable_stock, Free_Stock, free_stock, Διαθέσιμο_Απόθεμα, διαθέσιμο_απόθεμα

Date:
First_Available_Date, First Available Date, first_available_date, First_Available, first_available, Available_Date, available_date, Date_Added, date_added, Created_Date, created_date, Creation_Date, creation_date, Inventory_Date, inventory_date, Data, data, Ημερομηνία, ημερομηνία, Ημ/νία, ημ/νία

Last Sale Date:
Last_Sale_Date, Last Sale Date, last_sale_date, Last_Sale_At, last_sale_at, Last_Sold_Date, last_sold_date, Τελευταία_Πώληση, τελευταία_πώληση, Τελευταια_Πωληση, τελευταια_πωληση

Margin:
Gross_Margin_%, Gross Margin %, gross_margin_%, Margin_Percentage, margin_percentage, Margin_Pct, margin_pct, Margin, margin, Margin_%, margin_%, Gross_Margin, gross_margin, Profit_Margin, profit_margin

Stock Age:
Stock_Age_Days, Stock Age Days, stock_age_days, Age_Days, age_days, Days_In_Stock, days_in_stock, Stock_Age, stock_age, Age, age, MST_(ημέρες), mst_(ημέρες)

Revenue:
Revenue_Period, Revenue Period, revenue_period, Revenue, revenue

Quantity Sold:
Qty_Sold_Period, Qty Sold Period, qty_sold_period, Qty_Sold, qty_sold, Quantity_Sold, quantity_sold

Priority:
Priority_Flag, Priority Flag, priority_flag, Priority_Tag, priority_tag, Priority, priority, Tag, tag, Label, label, Alerts, alerts, Κατάσταση, κατάσταση

Margin Tier:
Margin_Tier, Margin Tier, margin_tier, Margin_Category, margin_category, Tier, tier

Supplier:
Supplier, supplier, Vendor, vendor, Supplier_Name, supplier_name, Προμηθευτής, προμηθευτής, Vendor_Name, vendor_name

Reorder Point:
Reorder_Point, Reorder Point, reorder_point, Min_Stock, min_stock, Safety_Stock, safety_stock, Σημείο_Αναπαραγγελίας, σημείο_αναπαραγγελίας

Reorder Qty:
Reorder_Qty, Reorder Qty, reorder_qty, Reorder_Quantity, reorder_quantity, Order_Qty, order_qty, Ποσότητα_Αναπαραγγελίας, ποσότητα_αναπαραγγελίας

ABC Class:
ABC_Class, ABC Class, abc_class, ABC, abc, Abc_Class

Flow Group:
Flow_Group, Flow Group, flow_group, Product_Segment, product_segment, Segment, segment, Ομάδα_Ροής, ομάδα_ροής

Seasonality:
Seasonality_Tag, Seasonality Tag, seasonality_tag, Seasonality, seasonality, Season_Tag, season_tag, Εποχικότητα, εποχικότητα`,
    tags: ['products', 'import', 'columns', 'mapping', 'table'],
    related: ['products-import', 'column-names-guide']
  },
  // STRATEGY
  {
    id: 'strategy-weights',
    category: 'strategy',
    title: 'Commercial Strategy',
    description: 'Πώς να ρυθμίσετε τους παράγοντες προτεραιοποίησης',
    content: `Το Commercial Strategy σας επιτρέπει να προσαρμόσετε πώς το σύστημα προτεραιοποιεί προϊόντα.

Διαθέσιμοι παράγοντες:
1. Profitability (💰): Margin και profit potential
2. Inventory (📦): Stock levels και stock age
3. Strategic (🎯): Priority tags και brand flags
4. Revenue (📈): Historical revenue performance
5. Customer Fit (👥): Affinity με RFM segments

Πώς λειτουργεί:
- Κάθε παράγοντας έχει βάρος από 0% έως 100%
- Το σύνολο πρέπει να είναι 100%
- Το σύστημα υπολογίζει composite score για κάθε προϊόν
- Προϊόντα με υψηλότερο score προτεραιοποιούνται

Preset Scenarios:
- Profit Maximization: Εστίαση σε margin
- Stock Clearance: Εστίαση σε excess/dead stock
- Revenue Push: Εστίαση σε volume
- Brand Launch: Εστίαση σε strategic flags

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
    content: `Preset Scenarios:

1. Profit Maximization (💰)
   - Profitability: 50%
   - Strategic: 30%
   - Revenue: 20%
   - Ιδανικό για: Premium positioning, high-margin focus

2. Stock Clearance (📦)
   - Inventory: 60%
   - Revenue: 30%
   - Customer Fit: 10%
   - Ιδανικό για: Excess/dead stock reduction

3. Revenue Push (📈)
   - Revenue: 50%
   - Customer Fit: 30%
   - Profitability: 20%
   - Ιδανικό για: Volume growth, sales targets

4. Brand Launch (🚀)
   - Strategic: 50%
   - Customer Fit: 30%
   - Revenue: 20%
   - Ιδανικό για: New product launches

Custom Scenarios:
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

R - Recency: Πόσο πρόσφατα αγόρασε ο πελάτης
- 5: Πολύ πρόσφατα (π.χ. <30 ημέρες)
- 1: Πολύ παλιά (π.χ. >180 ημέρες)

F - Frequency: Πόσο συχνά αγοράζει
- 5: Πολύ συχνά (π.χ. >10 orders)
- 1: Σπάνια (π.χ. 1 order)

M - Monetary: Πόσο ξοδεύει
- 5: Πολύ υψηλό (π.χ. >€500)
- 1: Πολύ χαμηλό (π.χ. <€50)

Common Segments:
- Champions (5-5-5): Best customers, high value
- Loyal (4-4-4): Regular customers, good value
- Potential (3-3-3): New or occasional customers
- At Risk (2-2-2): Declining engagement
- Lost (1-1-1): Inactive customers

Μέση RFM Score:
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
    content: `Champions (5-5-5)
- Best customers, high value και recent
- Strategy: Exclusive offers, early access, loyalty rewards
- Revenue share: Συνήθως 30-50% του total revenue

Loyal (4-4-4)
- Regular customers με consistent purchases
- Strategy: Retention campaigns, cross-sell opportunities
- Revenue share: Συνήθως 20-30%

Potential (3-3-3)
- New ή occasional customers με potential
- Strategy: Acquisition campaigns, engagement boosters
- Revenue share: Συνήθως 10-20%

At Risk (2-2-2)
- Declining engagement, risk of churn
- Strategy: Win-back campaigns, special offers
- Revenue share: Συνήθως 5-15%

Lost (1-1-1)
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

Inventory Summary:
- Total SKUs: Συνολικός αριθμός προϊόντων
- Healthy Stock: Προϊόντα με διάρκεια αποθέματος μεταξύ TOD/2 και TOD×2
- Excess Stock: Προϊόντα με διάρκεια αποθέματος > TOD×2 (πλεόνασμα)
- Low Stock: Προϊόντα με διάρκεια αποθέματος ≤ TOD/2 (κίνδυνος εξάντλησης)
- Dead Stock: Προϊόντα χωρίς πωλήσεις και με απόθεμα (TOD = Target Days of Stock, default 60 ημέρες)

Product Details:
Για κάθε προϊόν βλέπετε:
- Stock level vs capacity
- Stock age (days)
- Margin percentage
- Price
- Priority tag
- Composite score (αν έχει εφαρμοστεί strategy)

Actions:
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
    content: `Stock Clearance είναι το revenue που προέκυψε από την πώληση υπερπλήρων ή παλαιών αποθεμάτων.

Πώς λειτουργεί:
1. Το σύστημα εντοπίζει excess stock (>TOD×2 ημέρες αποθέματος) και dead stock (μηδενικές πωλήσεις)
2. Προτείνεται να προωθηθούν σε specific segments (π.χ. At Risk, Potential)
3. Δημιουργούνται targeted campaigns
4. Το revenue από αυτές τις πωλήσεις trackάρεται ως Stock Clearance

Best Practices:
- Target At Risk και Potential segments για clearance
- Χρησιμοποιήστε urgency messaging
- Bundle deals για dead stock
- Flash sales για excess stock

Cost Savings:
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

Channel Mix Optimization:
- Προτάσεις για budget allocation ανά channel
- Expected ROAS για κάθε channel
- Target segments για κάθε channel
- Priority products για promotion

Channels:
- Google Shopping
- Meta Ads (Facebook/Instagram)
- Email Marketing
- SMS Campaigns
- Display/Remarketing

Πώς λειτουργεί:
1. Το σύστημα αναλύει τα products, segments, και strategy
2. Προτείνει optimal channel mix
3. Δίνει budget allocation recommendations
4. Προτείνει target segments και products

Budget Allocation:
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

Κύρια Metrics:
- Total Revenue: Συνολικό εισόδημα
- Campaigns Revenue: Έσοδα καμπανιών / Performance+
- Attribution Rate: Ποσοστό του total revenue που αποδίδεται στο Performance+
- ROI Multiplier: Πόσες φορές επιστρέφει το investment (π.χ. 64x)

Attribution Methodology:
1. Segment Campaign Attribution: Revenue από campaigns που στοχεύουν RFM segments
2. Product Prioritization: Revenue από prioritized products
3. Stock Clearance: Revenue από excess/dead stock sales
4. Channel Optimization: Incremental ROAS improvement

Breakdown:
- Segment Activation: Revenue από segment-specific campaigns
- Inventory Optimization: Stock clearance revenue
- Channel Optimization: ROAS improvements

Cost Savings:
Εκτός από revenue, μετράμε:
- Warehousing costs avoided
- Google CSS savings
- Ad spend efficiency
- Content production savings

E-commerce Integration:
Αν έχετε συνδεδεμένο e-shop, εμφανίζονται επιπλέον:
- e-shop Revenue: Πραγματικά έσοδα από παραγγελίες e-shop
- True ROAS: e-shop Revenue ÷ Ad Spend (vs ROAS από conversion value καμπανιών)
- Revenue Gap: Διαφορά μεταξύ πραγματικών εσόδων και campaigns revenue
- e-shop Revenue line στο monthly trend chart (πράσινη γραμμή)`,
    tags: ['roi', 'attribution', 'performance', 'true roas', 'e-shop revenue'],
    related: ['dashboard-overview', 'analytics-import', 'store-revenue-vs-attributed'],
    faq: [
      {
        question: 'Πώς υπολογίζεται το ROI Multiplier;',
        answer: 'Είναι το Campaigns Revenue διαιρεμένο με το Subscription Cost. Αν το campaigns revenue είναι €64K και το subscription €1K, το ROI είναι 64x.'
      },
      {
        question: 'Τι σημαίνει "Attribution Rate";',
        answer: 'Είναι το ποσοστό του total revenue που αποδίδεται στο Performance+. Αν το total είναι €100K και το campaigns revenue €30K, το rate είναι 30%.'
      }
    ]
  },
  // DASHBOARD
  {
    id: 'understanding-kpis',
    category: 'dashboard',
    title: 'Κατανόηση των KPIs',
    description: 'Τι σημαίνει κάθε KPI στο Dashboard',
    content: `Total Revenue (€XK)
- Συνολικό εισόδημα από όλες τις πωλήσεις
- Δείχνει "X%" για το ποσοστό εσόδων καμπανιών έναντι του συνολικού (όπου υπάρχει στο import)

Products
- Συνολικός αριθμός προϊόντων στο σύστημα
- Clickable για να δείτε Product Intelligence

Segments
- Αριθμός RFM segments
- Δείχνει "X avg score" για μέσο RFM score

Campaigns
- Αριθμός ενεργών marketing campaigns
- Clickable για Channel Activation

Stock Clearance (€XK)
- Revenue από πώληση excess/dead stock
- Tooltip: "Το συνολικό ποσό εσόδων που προέκυψε από την πώληση υπερπλήρων ή παλαιών αποθεμάτων"

Cost Savings (€XK)
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
    content: `Δεδομένα δεν εμφανίζονται:
- Ελέγξτε ότι έχετε κάνει import δεδομένα
- Ελέγξτε ότι τα δεδομένα είναι για το σωστό brand
- Refresh τη σελίδα

Validation errors στο import:
- Χρησιμοποιήστε το template για σωστό format
- Ελέγξτε ότι οι ημερομηνίες είναι YYYY-MM-DD
- Ελέγξτε ότι τα required fields είναι συμπληρωμένα

Charts δεν εμφανίζουν data:
- Βεβαιωθείτε ότι έχετε importάρει analytics data
- Ελέγξτε ότι τα dates είναι σωστά formatted
- Μπορεί να χρειάζεται Firestore index (θα εμφανιστεί error message)

RFM Score shows 0:
- Ελέγξτε ότι τα segments έχουν RFM Score field
- Αν λείπει, το σύστημα θα προσπαθήσει να το υπολογίσει από το name

Currency symbols:
- Όλα τα amounts εμφανίζονται σε € (Euro)
- Icons χρησιμοποιούν Euro symbol`,
    tags: ['troubleshooting', 'issues', 'help'],
    related: ['data-import-basics'],
    faq: [
      {
        question: 'Γιατί δεν βλέπω revenue data στο chart;',
        answer: 'Βεβαιωθείτε ότι έχετε importάρει analytics data με Date, Total Revenue, και Campaigns Revenue (ή ισοδύναμη στήλη από παλιό export — δες Help → Εισαγωγή Analytics). Ελέγξτε ότι το date format είναι YYYY-MM-DD.'
      },
      {
        question: 'Πώς μπορώ να διορθώσω validation errors;',
        answer: 'Κάντε κλικ στο error message για να δείτε το row και το field που έχει πρόβλημα. Χρησιμοποιήστε το template για reference.'
      }
    ]
  },

  // ── Coordination ──────────────────────────────────────────────────────
  {
    id: 'coordination-briefing-board',
    category: 'coordination',
    title: 'Briefing Board — Συντονισμός Τμημάτων',
    description: 'Πώς λειτουργεί το κεντρικό σύστημα συντονισμού αποφάσεων και ενεργειών.',
    content: `# Briefing Board — Συντονισμός Τμημάτων

Το Briefing Board είναι ο κεντρικός χώρος επικοινωνίας μεταξύ επιχειρηματία, εσωτερικών τμημάτων (εμπορική δ/νση, marketing, procurement) και εξωτερικών συνεργατών (agency).

## Δομή

### Τελευταίο Briefing (Top Bar)
Εμφανίζει την πιο πρόσφατη ενεργή απόφαση σε dark bar στην κορυφή. Κλικ για λεπτομέρειες.

### Ενεργές Αποφάσεις (Αριστερή στήλη)
Λίστα αποφάσεων με:
- Χρωματική ένδειξη κατηγορίας
- Τίτλο και περιγραφή
- Τμήματα που αφορά
- Ημερομηνία δημιουργίας

### Εισερχόμενες Προτάσεις (Δεξιά στήλη)
Προτάσεις από τμήματα που περιμένουν έγκριση. Inline κουμπιά Έγκριση / Απόρριψη.

### Εκκρεμείς Εργασίες (Πλήρες πλάτος)
Flat list εργασιών με status, τμήμα, assignee και inline ολοκλήρωση.

## Τύποι Ενεργειών
- Νέα Απόφαση: Δημιουργεί ενεργή απόφαση και ειδοποιεί τα tagged τμήματα
- Πρόταση: Δημιουργεί πρόταση (status: proposal) που περιμένει έγκριση
- Εργασία: Ανατίθεται σε τμήμα/άτομο και παρακολουθείται

## Ειδοποιήσεις
- Bell (in-app): Real-time ειδοποιήσεις μέσα στην εφαρμογή
- Email: Αυτόματη αποστολή email στα tagged τμήματα

## Ροή Ενεργειών (Activity Feed)
Side drawer που δείχνει χρονολογικά όλες τις ενέργειες: δημιουργία, αλλαγή status, σχόλια.`,
    tags: ['coordination', 'briefing', 'decisions', 'tasks', 'notifications', 'συντονισμός'],
    related: ['coordination-briefing-from-strategy'],
    steps: [
      'Πλοηγηθείτε στο Συντονισμός Τμημάτων από το sidebar',
      'Κλικ "+ Νέα Απόφαση" για νέα απόφαση ή "+ Πρόταση" για πρόταση',
      'Συμπληρώστε τίτλο, περιγραφή, κατηγορία, προτεραιότητα',
      'Επιλέξτε τα τμήματα που αφορά (tags)',
      'Αποθηκεύστε — τα τμήματα ειδοποιούνται αυτόματα',
      'Προσθέστε εργασίες και σχόλια στο detail panel'
    ],
    faq: [
      {
        question: 'Τι διαφορά έχει η Απόφαση από την Πρόταση;',
        answer: 'Η Απόφαση είναι ενεργή αμέσως και εμφανίζεται στις Ενεργές Αποφάσεις. Η Πρόταση περιμένει έγκριση και εμφανίζεται στις Εισερχόμενες Προτάσεις.'
      },
      {
        question: 'Πώς ειδοποιούνται τα τμήματα;',
        answer: 'Μέσω bell notification εντός εφαρμογής και email. Η ειδοποίηση περιλαμβάνει τίτλο, περιγραφή και link στην απόφαση.'
      }
    ]
  },
  {
    id: 'coordination-briefing-from-strategy',
    category: 'coordination',
    title: 'Αποστολή Briefing από Εμπορική Στρατηγική',
    description: 'Πώς η ενεργοποίηση μιας εμπορικής στρατηγικής δημιουργεί αυτόματα briefing στα τμήματα.',
    content: `# Αποστολή Briefing από Commercial Strategy

Μετά την ενεργοποίηση μιας εμπορικής στρατηγικής, το Performance+ προτείνει αυτόματη κοινοποίηση στα τμήματα μέσω του Briefing Board.

## Ροή

### 1. Ενεργοποίηση Στρατηγικής
Επιλέγετε ένα scenario (π.χ. Profit Maximization) και πατάτε Save.

### 2. Banner
Εμφανίζεται dark banner:
> Στρατηγική "Profit Maximization" ενεργοποιήθηκε  [Παράλειψη] [Αποστολή Briefing →]

### 3. Briefing Drawer
Πατώντας "Αποστολή Briefing" ανοίγει bottom sheet:
- Τίτλος (pre-filled με το όνομα στρατηγικής)
- Σημείωση (textarea για πρόσθετες οδηγίες)
- Τμήματα (department chips — θυμάται τις τελευταίες επιλογές)

### 4. Αποστολή
Δημιουργεί:
- Απόφαση στο Briefing Board (status: active, priority: high)
- Bell notification στα tagged τμήματα
- Email ειδοποίηση

## Τμήματα
Τα διαθέσιμα τμήματα: Εμπορική Δ/νση, Marketing, Procurement, Agency, Διοίκηση.
Η εφαρμογή θυμάται τις τελευταίες επιλογές σας (localStorage).`,
    tags: ['briefing', 'strategy', 'coordination', 'notifications', 'στρατηγική'],
    related: ['coordination-briefing-board', 'strategy-weights'],
    steps: [
      'Πηγαίνετε στο Commercial Strategy',
      'Επιλέξτε ένα scenario και πατήστε Save',
      'Στο banner πατήστε "Αποστολή Briefing"',
      'Ελέγξτε/τροποποιήστε τίτλο και σημείωση',
      'Επιλέξτε τα τμήματα που αφορά',
      'Πατήστε "Αποστολή" — η απόφαση εμφανίζεται στο Συντονισμό'
    ]
  },

  // ── Automation ────────────────────────────────────────────────────────
  {
    id: 'automation-triggers',
    category: 'automation',
    title: 'Αυτοματισμοί Λήψης Αποφάσεων',
    description: 'Πώς λειτουργούν τα smart triggers και πώς ρυθμίζονται.',
    content: `# Αυτοματισμοί Λήψης Αποφάσεων

Η εφαρμογή παρακολουθεί αυτόματα τα δεδομένα σας και δημιουργεί ειδοποιήσεις/αποφάσεις όταν εντοπίσει σημαντικά σήματα.

## Κατηγορίες Triggers

### Απόθεμα & Προϊόντα (Growth Plan)
- Dead stock — SKUs χωρίς πωλήσεις πάνω από X%
- Excess stock — Αξία πλεονάσματος πάνω από X€
- Χαμηλό απόθεμα (high-margin) — Κρίσιμα χαμηλό stock σε κερδοφόρα SKUs
- Νέα προϊόντα — Ειδοποίηση εισαγωγής νέων SKUs
- Μεγέθυνση αποθέματος — Stock level πάνω από threshold

### Καμπάνιες & Απόδοση (Growth Plan)
- Υψηλή απόδοση — ROAS πάνω από Xx
- Αδυναμία campaign — ROAS κάτω από Xx

### Πελατολόγιο & Segments (Growth Plan)
- Churn risk — At-risk segment πάνω από X%
- VIP ανάπτυξη — Champions segment αυξάνεται

### Εποχικότητα (Growth Plan)
- Εποχική περίοδος — X ημέρες πριν από Black Friday, Χριστούγεννα κ.α.

### Ανταγωνισμός & Τιμές (Growth Plan)
- Τιμή πάνω από αγορά — SKUs ακριβότερα κατά >X% από τη μέση αγοράς (Google Merchant Center)
- Νέες ads ανταγωνιστών — Εντοπισμός >X νέων διαφημίσεων ανταγωνιστών (Meta Ad Library)

### Procurement (Enterprise only)
- Χαμηλή επάρκεια — Ημέρες κάλυψης κάτω από threshold
- Πλεόνασμα — Surplus αξία πάνω από X€
- Νέο brand — Νέο brand στα procurement data
- Τιμολογιακή απόκλιση — Τιμή vs πολιτική πάνω από X%
- Καθυστέρηση προμηθευτή — Χρόνος παράδοσης πέρα από αναμενόμενο

## Ρυθμίσεις ανά Trigger
- Toggle on/off
- Κατώφλι (threshold) — αριθμητική τιμή ενεργοποίησης
- Έλεγχος κάθε — πόσες ημέρες μεσολαβούν μεταξύ ελέγχων
- Auto-briefing — αυτόματη δημιουργία απόφασης στο Συντονισμό

## Πότε τρέχουν
Οι αυτοματισμοί αξιολογούνται κατά τη φόρτωση του Dashboard. Αν ένα trigger «πυροδοτηθεί», δημιουργείται alert και (αν είναι ενεργό το auto-briefing) απόφαση στο Briefing Board.`,
    tags: ['automation', 'triggers', 'alerts', 'αυτοματισμοί', 'ειδοποιήσεις'],
    related: ['coordination-briefing-board'],
    steps: [
      'Πλοηγηθείτε στο Αυτοματισμοί από το sidebar',
      'Ενεργοποιήστε τα triggers που σας ενδιαφέρουν με το toggle',
      'Ρυθμίστε το κατώφλι (π.χ. Dead stock > 15%)',
      'Ορίστε κάθε πόσες ημέρες θέλετε έλεγχο',
      'Ενεργοποιήστε Auto-briefing αν θέλετε αυτόματη ενημέρωση τμημάτων',
      'Αποθηκεύστε — οι αυτοματισμοί τρέχουν αυτόματα'
    ],
    faq: [
      {
        question: 'Πότε τρέχουν οι αυτοματισμοί;',
        answer: 'Κατά τη φόρτωση του Dashboard. Η εφαρμογή ελέγχει αν έχει περάσει αρκετός χρόνος από τον τελευταίο έλεγχο (βάσει του interval που ορίσατε) πριν αξιολογήσει ξανά.'
      },
      {
        question: 'Τι είναι auto-briefing;',
        answer: 'Όταν ένα trigger ενεργοποιηθεί και έχετε ενεργό το auto-briefing, δημιουργείται αυτόματα μια απόφαση στο Briefing Board (Συντονισμός Τμημάτων) και ειδοποιούνται τα αρμόδια τμήματα.'
      },
      {
        question: 'Τι σημαίνουν τα Enterprise triggers;',
        answer: 'Τα triggers της κατηγορίας Procurement είναι διαθέσιμα μόνο στο Performance+ Enterprise. Αφορούν δεδομένα ERP, προμηθευτές και τιμολογιακή πολιτική.'
      }
    ]
  },

  // ── Financial KPIs ────────────────────────────────────────────────────
  {
    id: 'understanding-financial-kpis',
    category: 'dashboard',
    title: 'Κατανόηση Οικονομικών KPIs',
    description: 'Αναλυτικοί ορισμοί για όλους τους οικονομικούς δείκτες του Dashboard.',
    content: `# Κατανόηση Οικονομικών KPIs

## Σύνολο Εσόδων
Συνολικά έσοδα από e-shop revenue (όταν υπάρχει σύνδεση) + οργανικά έσοδα + conversion value από campaigns (Google Ads, Meta). Εμφανίζει MoM (month-over-month) μεταβολή με την ίδια blended λογική.

## Ad Spend
Συνολικό ποσό που δαπανήθηκε σε διαφημίσεις. Περιλαμβάνει Google Ads και Meta Ads spend. Εμφανίζει CPA (Cost Per Acquisition) ως subtitle.

## ROI (Return on Investment)
Υπολογισμός: (Campaign Revenue − Ad Spend) ÷ Ad Spend × 100

Παράδειγμα: Αν ξοδέψατε €1.000 και κερδίσατε €4.000, ROI = +300%.

## ROAS (Return on Ad Spend)
Υπολογισμός: Campaign Revenue ÷ Ad Spend

Παράδειγμα: ROAS 4.0x = Κάθε €1 που ξοδεύετε σε διαφήμιση φέρνει €4 σε πωλήσεις.

Σημαντική διαφορά: Ο **Campaigns ROAS** μετράει μόνο τα έσοδα καμπανιών (από platforms), ενώ ο Blended ROAS περιλαμβάνει και τα οργανικά.

## Blended ROAS
Υπολογισμός: Συνολικά Έσοδα (οργανικά + paid) ÷ Ad Spend

Γιατί είναι σημαντικός: Η διαφήμιση επηρεάζει και τις οργανικές πωλήσεις (brand awareness, remarketing effect). Ο Blended ROAS δίνει μια πιο ρεαλιστική εικόνα της συνολικής απόδοσης.

## Μέσο Καλάθι — AOV (Average Order Value)
Υπολογισμός: Αξία Μετατροπών ÷ Αριθμός Μετατροπών

Τι δείχνει:
- Αν αυξάνεται → τα upsells/cross-sells λειτουργούν
- Αν μειώνεται → πιθανή υπερβολική χρήση εκπτώσεων (discount fatigue)

## MoM (Month-over-Month)
Σύγκριση με τον προηγούμενο μήνα. Εμφανίζεται ως ▲ ή ▼ με ποσοστό αλλαγής.

## Sparklines
Τα μικρά γραφήματα κάτω από κάθε KPI δείχνουν την τάση ανά μήνα. Ανοδική τάση = πράγματα πάνε καλά, καθοδική = χρειάζεται δράση.`,
    tags: ['kpis', 'roi', 'roas', 'aov', 'blended', 'financial', 'dashboard', 'οικονομικά'],
    related: ['understanding-kpis', 'roi-attribution-basics'],
    tips: [
      'ROAS > 4x θεωρείται πολύ καλός στα περισσότερα industries',
      'Blended ROAS είναι πιο σημαντικός από τον Campaigns ROAS για τη συνολική εικόνα',
      'Αν το AOV μειώνεται, σκεφτείτε στρατηγικές αύξησης μέσου καλαθιού (bundles, free shipping thresholds)',
      'MoM comparison έχει νόημα μόνο αν συγκρίνεται μήνες χωρίς ιδιαιτερότητες (π.χ. μη συγκρίνετε Δεκέμβριο με Ιανουάριο)'
    ]
  },

  // ── Content Strategy ──────────────────────────────────────────────────
  {
    id: 'content-strategy-guide',
    category: 'content',
    title: 'Content Strategy — Οδηγός',
    description: 'Πώς λειτουργεί η AI-generated content strategy και πώς αξιοποιείται.',
    content: `# Content Strategy — Οδηγός

Η σελίδα Content Strategy παρέχει AI-generated κατευθύνσεις περιεχομένου ευθυγραμμισμένες με την ενεργή εμπορική στρατηγική σας.

## Πώς δημιουργείται

### 1. Ενεργοποίηση Στρατηγικής
Πηγαίνετε στο Commercial Strategy, επιλέξτε scenario και πατήστε Save. Η εφαρμογή χρησιμοποιεί Google Generative AI για να δημιουργήσει εξατομικευμένες προτάσεις.

### 2. Inputs στο AI
- Ενεργή στρατηγική (π.χ. Profit Maximization, Stock Clearance)
- Βάρη στρατηγικής (κερδοφορία, απόθεμα, τζίρος κ.λπ.)
- Brand name και κατηγορίες προϊόντων
- Customer segments (π.χ. Champions, At Risk)

### 3. Τι παράγεται
- Θεματικές κατευθύνσεις ανά κανάλι: Blog, Social Media, Email, κ.λπ. — με θέμα, reasoning, target segments
- Παραδείγματα ενεργειών: Συγκεκριμένα content pieces με τίτλο, περιγραφή, κανάλι, priority
- Brief για ομάδα marketing: Έτοιμο κείμενο για αποστολή στην ομάδα ή το agency

## Αξιοποίηση
- Αντιγραφή brief: Αποστέλλεται στην ομάδα marketing ή στο agency
- Σύνδεση με Briefing Board: Μέσω αποστολής briefing από τη στρατηγική
- Εναρμόνιση content: Το περιεχόμενο ευθυγραμμίζεται αυτόματα με τις εμπορικές προτεραιότητες`,
    tags: ['content', 'strategy', 'ai', 'marketing', 'blog', 'social media', 'περιεχόμενο'],
    related: ['strategy-weights', 'channel-activation'],
    steps: [
      'Πηγαίνετε στο Commercial Strategy και ενεργοποιήστε μια στρατηγική',
      'Πλοηγηθείτε στο Content Strategy',
      'Δείτε τις θεματικές κατευθύνσεις ανά κανάλι',
      'Ανοίξτε τα παραδείγματα ενεργειών για ιδέες',
      'Αντιγράψτε το brief και στείλτε το στην ομάδα σας'
    ]
  },

  // ── Plans ─────────────────────────────────────────────────────────────
  {
    id: 'plan-growth-enterprise',
    category: 'getting-started',
    title: 'Growth Plan vs Enterprise',
    description: 'Τι περιλαμβάνει κάθε plan και πώς διαφοροποιείται.',
    content: `# Growth Plan vs Enterprise

Το Performance+ διατίθεται σε δύο εκδόσεις:

## Performance+ (Growth Plan)
Η βασική έκδοση για e-commerce SMBs:
- Dashboard — KPIs, revenue chart, AI insights, e-commerce summary
- Commercial Strategy — εμπορικά σενάρια (συμπ. Sales Optimization, Price Benchmarking), composite scoring
- RFM Analysis — Customer segmentation
- Product Intelligence — Stock health, inventory analytics
- Campaigns — Google Ads & Meta tracking, 3 χρόνια ιστορικό
- Content Strategy — AI-generated content directions
- ROI Attribution — Channel performance, ROAS, ROI, e-shop Revenue, True ROAS
- E-commerce Explorer — Ενοποιημένα δεδομένα e-shop (Shopify, WooCommerce, OpenCart, Magento)
- Web Analytics — GA4 integration (sessions, users, conversions, traffic sources)
- Connectors — Αυτόματο sync από 8+ πλατφόρμες (Google Ads, Meta, GA4, Shopify, WooCommerce, OpenCart, Magento, Merchant Center)
- Συντονισμός Τμημάτων — Briefing Board, αποφάσεις, εργασίες
- Αυτοματισμοί — 10 smart triggers (Απόθεμα, Καμπάνιες, Πελατολόγιο, Εποχικότητα)
- AI Insights — Πρακτικές συστάσεις βασισμένες στα δεδομένα

## Performance+ Enterprise
Όλα τα παραπάνω +:
- Procurement module — Διαχείριση αποθέματος ERP, κοστολόγηση, αξιολόγηση ειδών, τιμολογιακή πολιτική, απολογιστικό, στατιστικά
- Enterprise KPIs — ERP SKUs, ημέρες επάρκειας, συνολικές πωλήσεις στο Product Intelligence
- 5 extra triggers — Procurement-specific: χαμηλή επάρκεια, πλεόνασμα, νέο brand, τιμολογιακή απόκλιση, καθυστέρηση προμηθευτή
- ERP data integration — Import δεδομένων από ERP/procurement systems

## Πώς αλλάζει
Η έκδοση ορίζεται στο brand profile (Firestore). Μεταβίβαση σε Enterprise γίνεται κατόπιν επικοινωνίας.`,
    tags: ['plans', 'growth', 'enterprise', 'procurement', 'features', 'pricing'],
    related: ['what-is-performance-plus', 'automation-triggers'],
    faq: [
      {
        question: 'Πώς μπορώ να κάνω upgrade σε Enterprise;',
        answer: 'Επικοινωνήστε στο noreply@performanceplus.gr για εταιρική ένταξη. Η αναβάθμιση ενεργοποιεί αυτόματα το Procurement module και τους enterprise triggers.'
      },
      {
        question: 'Μπορώ να δοκιμάσω το Enterprise;',
        answer: 'Ναι, μπορείτε να ζητήσετε δοκιμαστική περίοδο Enterprise μέσω email ή demo request.'
      }
    ]
  },
  // ── Connectors & E-commerce ──────────────────────────────────────────
  {
    id: 'connectors-overview',
    category: 'connectors',
    title: 'Connectors — Επισκόπηση',
    description: 'Πώς να συνδέσετε τα ad accounts, analytics και e-shop σας.',
    content: `# Connectors — Επισκόπηση

Η σελίδα Συνδέσεις → Connectors σας επιτρέπει να συνδέσετε εξωτερικές πλατφόρμες για αυτόματο sync δεδομένων.

## Υποστηριζόμενοι Connectors

### Διαφημιστικά (OAuth)
- **Google Ads** — Campaigns, spend, conversions, ROAS
- **Meta (Facebook/Instagram)** — Campaigns, spend, purchases

### Analytics (OAuth)
- **GA4 (Google Analytics 4)** — Sessions, users, conversions, traffic sources, top pages

### E-commerce
- **Shopify** (OAuth) — Παραγγελίες, προϊόντα (τελευταίες 90 ημέρες)
- **WooCommerce** (API Key) — Παραγγελίες, προϊόντα
- **OpenCart** (API Key) — Παραγγελίες, προϊόντα
- **Magento** (Access Token) — Παραγγελίες, προϊόντα

### Ανταγωνισμός (OAuth)
- **Merchant Center** — Price benchmarking

## Τύποι Σύνδεσης

### OAuth (Google Ads, Meta, GA4, Shopify)
1. Κλικ "Σύνδεση" → ανοίγει OAuth παράθυρο
2. Συνδεθείτε με τον λογαριασμό σας
3. Εγκρίνετε πρόσβαση
4. Αυτόματη επιστροφή στο Performance+

### API Key (WooCommerce, OpenCart, Magento)
1. Κλικ "Σύνδεση" → εμφανίζεται modal
2. Εισάγετε e-shop URL + API credentials
3. Κλικ "Σύνδεση" — γίνεται test σε πραγματικό χρόνο

## Sync
- **Αυτόματο**: Καθημερινό sync (06:00)
- **Χειροκίνητο**: Κλικ "Sync τώρα" ανά connector
- **Τελευταίο sync**: Εμφανίζεται κάτω από κάθε connector`,
    tags: ['connectors', 'oauth', 'api', 'shopify', 'woocommerce', 'opencart', 'magento', 'ga4', 'google ads', 'meta', 'sync'],
    related: ['ecommerce-explorer', 'ga4-connector', 'ecommerce-shopify', 'ecommerce-woo'],
    steps: [
      'Μεταβείτε στις Συνδέσεις από το sidebar',
      'Επιλέξτε τον connector που θέλετε (π.χ. Shopify)',
      'Κλικ "Σύνδεση" και ολοκληρώστε τη ροή OAuth ή API Key',
      'Μετά τη σύνδεση, κλικ "Sync τώρα" για πρώτο sync',
      'Τα δεδομένα εμφανίζονται στις αντίστοιχες σελίδες'
    ],
    faq: [
      {
        question: 'Μπορώ να αποσυνδέσω κάποιον connector;',
        answer: 'Ναι, κλικ "Αποσύνδεση" στον connector. Τα credentials διαγράφονται αμέσως. Τα ήδη synced δεδομένα παραμένουν.'
      },
      {
        question: 'Τι δεδομένα αποθηκεύονται;',
        answer: 'Μόνο εμπορικά δεδομένα (παραγγελίες, προϊόντα, campaigns). Δεν αποθηκεύονται προσωπικά δεδομένα πελατών (email, τηλέφωνο κλπ).'
      },
      {
        question: 'Πόσο συχνά γίνεται sync;',
        answer: 'Αυτόματα κάθε μέρα. Μπορείτε επίσης να κάνετε χειροκίνητο sync οποιαδήποτε στιγμή.'
      }
    ]
  },
  {
    id: 'ecommerce-shopify',
    category: 'connectors',
    title: 'Shopify Connector',
    description: 'Σύνδεση Shopify e-shop για παραγγελίες και προϊόντα.',
    content: `# Shopify Connector

## Σύνδεση
1. Κλικ "Σύνδεση" στον Shopify connector
2. Εισάγετε το Shopify domain σας (π.χ. myshop.myshopify.com)
3. Ανοίγει OAuth παράθυρο — εγκρίνετε πρόσβαση
4. Αυτόματη επιστροφή στο Performance+

## Τι συγχρονίζεται
- **Παραγγελίες** (τελευταίες 90 ημέρες): order ID, ημερομηνία, ποσό, status, line items, νόμισμα
- **Προϊόντα**: τίτλος, handle, vendor, κατάσταση, variants, τιμές

## Πού εμφανίζονται τα δεδομένα
- **E-commerce Explorer** (#ecommerce): Έσοδα, παραγγελίες, AOV, top products
- **Dashboard**: E-commerce summary card
- **ROI Attribution**: e-shop Revenue, True ROAS

## Σημειώσεις
- Δεν αποθηκεύονται PII (email, τηλέφωνο πελατών)
- Τα δεδομένα ανανεώνονται αυτόματα καθημερινά
- Υποστηρίζονται μόνο Shopify e-shops (όχι Shopify POS)`,
    tags: ['shopify', 'ecommerce', 'connector', 'orders', 'products'],
    related: ['connectors-overview', 'ecommerce-explorer']
  },
  {
    id: 'ecommerce-woo',
    category: 'connectors',
    title: 'WooCommerce / OpenCart / Magento',
    description: 'Σύνδεση WooCommerce, OpenCart ή Magento με API credentials.',
    content: `# WooCommerce / OpenCart / Magento Connectors

Αυτοί οι connectors χρησιμοποιούν API Key αντί για OAuth.

## WooCommerce
- **Credentials**: e-shop URL, Consumer Key, Consumer Secret
- **Πού τα βρίσκετε**: WooCommerce → Settings → Advanced → REST API → Add Key
- **Δικαιώματα**: Read access αρκεί

## OpenCart
- **Credentials**: e-shop URL, API Username, API Key
- **Πού τα βρίσκετε**: System → Users → API → Add New
- **Υποστηρίζει**: Native OpenCart API (3.x+) και REST extensions

## Magento
- **Credentials**: e-shop URL, Access Token (Bearer)
- **Πού το βρίσκετε**: System → Integrations → Add New → Activate → Access Token
- **Δικαιώματα**: Sales (read), Catalog (read)

## Κοινά χαρακτηριστικά
- Παραγγελίες τελευταίων 90 ημερών
- Κατάλογος προϊόντων
- Καθημερινό αυτόματο sync
- Δεδομένα εμφανίζονται στο E-commerce Explorer, Dashboard και ROI`,
    tags: ['woocommerce', 'opencart', 'magento', 'ecommerce', 'connector', 'api key'],
    related: ['connectors-overview', 'ecommerce-explorer'],
    faq: [
      {
        question: 'Χρειάζεται SSL (https) στο e-shop μου;',
        answer: 'Ναι, συνιστάται ισχυρά. Η σύνδεση γίνεται μέσω HTTPS. Αν δεν έχετε SSL, ορισμένοι connectors ενδέχεται να μη λειτουργήσουν.'
      },
      {
        question: 'Τι γίνεται αν αλλάξω τα API credentials στο store;',
        answer: 'Θα χρειαστεί να αποσυνδέσετε και να ξανασυνδέσετε τον connector με τα νέα credentials.'
      }
    ]
  },
  {
    id: 'ga4-connector',
    category: 'connectors',
    title: 'GA4 (Google Analytics 4)',
    description: 'Σύνδεση GA4 για traffic analytics, sessions, conversions.',
    content: `# GA4 Connector

## Σύνδεση
1. Κλικ "Σύνδεση" στον GA4 connector
2. Εγκρίνετε πρόσβαση μέσω Google OAuth
3. Επιλέξτε το GA4 Property που θέλετε
4. Κλικ "Σύνδεση"

## Τι συγχρονίζεται (τελευταίες 90 ημέρες)
- **Daily Metrics**: Sessions, users, new users, page views, bounce rate, avg session duration, conversions, event count
- **Traffic Sources**: Κανάλια (Organic Search, Paid Search, Direct, Social κλπ) με sessions, users, conversions
- **Top Pages**: Σελίδες με page views, sessions, bounce rate

## Πού εμφανίζονται τα δεδομένα
- **Web Analytics** (#analytics): Πλήρης dashboard με KPIs, charts, πίνακες
- **Dashboard**: GA4 summary card
- **AI Briefing**: Traffic insights στο morning briefing

## Σημειώσεις
- Χρειάζεται τουλάχιστον Viewer access στο GA4 property
- Η πρώτη σύνδεση ζητά επιλογή property αν έχετε πολλαπλά
- Τα δεδομένα ανανεώνονται καθημερινά`,
    tags: ['ga4', 'analytics', 'google analytics', 'traffic', 'sessions', 'conversions', 'connector'],
    related: ['connectors-overview', 'dashboard-overview']
  },
  {
    id: 'ecommerce-explorer',
    category: 'connectors',
    title: 'E-commerce Explorer',
    description: 'Η σελίδα E-commerce: έσοδα, παραγγελίες, προϊόντα, platform breakdown.',
    content: `# E-commerce Explorer

Η σελίδα E-commerce (#ecommerce) δίνει ενοποιημένη εικόνα των e-shop δεδομένων σας από όλες τις συνδεδεμένες πλατφόρμες.

## Προϋπόθεση
Τουλάχιστον ένας e-commerce connector (Shopify, WooCommerce, OpenCart ή Magento) πρέπει να είναι συνδεδεμένος και synced.

## Τι βλέπετε

### KPI Cards (κορυφή)
- **e-shop Revenue**: Σύνολο εσόδων τελευταίων 90 ημερών
- **Παραγγελίες**: Αριθμός παραγγελιών
- **AOV**: Average Order Value (μέσο ποσό ανά παραγγελία)
- **Platforms**: Αριθμός συνδεδεμένων e-shop

### Revenue Chart
Area chart με ημερήσια έσοδα (90 ημέρες). Hover για ακριβή ποσά.

### Platform Breakdown
Horizontal bar chart + progress bars που δείχνουν πόσα έσοδα και παραγγελίες αντιστοιχούν σε κάθε πλατφόρμα.

### Top Products
Πίνακας με top προϊόντα κατά έσοδα. Sortable κατά έσοδα ή ποσότητα, με:
- Search (όνομα/SKU)
- Rows per page (10/20/50/100/All)
- Pagination και "Προβολή όλων"
- Inline bars για οπτική σύγκριση

### Πρόσφατες Παραγγελίες
Πίνακας παραγγελιών με:
- Search (order/status/platform)
- Filters ανά platform και status
- Rows per page + pagination + "Προβολή όλων"
- Sortable κατά ημ/νία, total ή platform
- Color-coded status badges:
- Πράσινο: paid, completed, fulfilled
- Κίτρινο: pending, on-hold
- Κόκκινο: refunded, cancelled

## Πώς υπολογίζονται τα δεδομένα
Τα aggregated metrics (revenue, AOV, top products) υπολογίζονται server-side κατά το sync και αποθηκεύονται σε ένα summary document. Αυτό εξασφαλίζει γρήγορη φόρτωση χωρίς heavy client-side queries.

**Καταστάσεις παραγγελιών:** το ημερήσιο έσοδο αθροίζει το αποθηκευμένο total κάθε παραγγελίας στο εύρος sync — χωρίς ξεχωριστό φιλτράρισμα «μόνο επιβεβαιωμένες». Για ακυρώσεις, το ποσό εξαρτάται από το τι επιστρέφει το API της πλατφόρμας (π.χ. Magento \`grand_total\`).`,
    tags: ['ecommerce', 'explorer', 'revenue', 'orders', 'products', 'aov', 'dashboard'],
    related: ['connectors-overview', 'ecommerce-shopify', 'ecommerce-woo', 'store-revenue-vs-attributed'],
    tips: [
      'Χρησιμοποιήστε search + platform/status filters για γρήγορο drill-down',
      'Αλλάξτε rows-per-page ή επιλέξτε "Προβολή όλων" για full list',
      'Κάντε κλικ στις κεφαλίδες στηλών για sorting',
      'Αν δεν εμφανίζονται δεδομένα, ελέγξτε ότι έχετε κάνει Sync στον connector',
      'Τα δεδομένα ανανεώνονται αυτόματα μετά από κάθε sync',
      'Κάντε hover στα labels για tooltip εξήγηση KPI (e-shop Revenue, Orders, AOV)'
    ]
  },
  {
    id: 'store-revenue-vs-attributed',
    category: 'connectors',
    title: 'e-shop Revenue vs Campaigns Revenue',
    description: 'Τι σημαίνει e-shop Revenue, True ROAS και Revenue Gap στο ROI.',
    content: `# e-shop Revenue vs Campaigns Revenue

## Ορισμοί

### e-shop Revenue
Τα **έσοδα από παραγγελίες** όπως τα συγχρονίζουμε από το e-shop (Shopify, WooCommerce, Magento κ.λπ.): άθροισμα του αποθηκευμένου total ανά παραγγελία, κατά **ημερομηνία δημιουργίας** παραγγελίας. **Δεν** φιλτράρουμε εκ των υστέρων κατάσταση (π.χ. ακύρωση): αν η πλατφόρμα αφήνει μη μηδενικό total για ακυρωμένη παραγγελία, αυτό μετράει· αν το μηδενίζει, μετράει 0.

### Campaigns Revenue (έσοδα από πλατφόρμες διαφημίσεων)
Το **conversion value** που αναφέρουν Google Ads / Meta (και ισοδύναμα) για τις καμπάνιες — **όχι** ταμειακός τζίρος καταστήματος και **όχι** «πόσο απομένει» μετά τον τζίρο e-shop. Μπορεί να διαφέρει από τον τζίρο λόγω attribution, ημερομηνίας conversion vs ημερομηνίας παραγγελίας, και άλλων καναλιών.

### Γιατί η καμπύλη διαφημίσεων μπορεί να είναι πιο ψηλή από τον τζίρο e-shop;
Οι δύο σειρές **δεν** είναι δύο κομμάτια του ίδιου ταμειακού συνόλου την ίδια μέρα. Σε κάποιες ημέρες το conversion value των πλατφορμών μπορεί να **ξεπερνά** τον ημερήσιο τζίρο e-shop (διαφορετική ημέρα αναφοράς, ζώνη ώρας, μοντέλα μέτρησης, πωλήσεις που δεν εμφανίζονται ως παραγγελία e-shop εκείνη τη μέρα).

### True ROAS
\`e-shop Revenue ÷ Ad Spend\`

Πόσα πραγματικά κέρδισε το e-shop σας για κάθε €1 σε διαφήμιση. Πιο αξιόπιστο από τον Campaigns ROAS (έσοδα καμπανιών ÷ spend).

### Revenue Gap
\`e-shop Revenue − Campaigns Revenue\`

- **Θετικό**: Πουλάτε περισσότερα από ό,τι δείχνουν τα ad platforms (π.χ. word-of-mouth, repeat purchases)
- **Αρνητικό**: Τα ad platforms over-report conversions (common σε cross-platform attribution)

## Πού εμφανίζεται
Στο **ROI Attribution** (#roi), εμφανίζεται μόνο όταν υπάρχουν e-commerce δεδομένα:
- 4 MetricCards: e-shop Revenue, Campaigns Revenue, True ROAS, Revenue Gap
- Γραμμή e-shop Revenue (πράσινη) στο monthly trend chart
- Επεξηγηματικό κείμενο κάτω από τα cards
- Tooltips στα metric labels για γρήγορη κατανόηση ορισμών

## Γιατί είναι σημαντικό
Ο Campaigns ROAS βασίζεται σε attribution models που μπορεί να μετράνε duplicates (ένα conversion σε Google + Meta). Ο True ROAS χρησιμοποιεί πραγματικά δεδομένα παραγγελιών, δίνοντας πιο ρεαλιστική εικόνα.`,
    tags: ['e-shop revenue', 'campaigns revenue', 'true roas', 'revenue gap', 'roi', 'ecommerce'],
    related: ['roi-attribution-basics', 'ecommerce-explorer', 'understanding-financial-kpis'],
    faq: [
      {
        question: 'Γιατί διαφέρει το e-shop Revenue από το Campaigns Revenue;',
        answer: 'Ο τζίρος e-shop προέρχεται από παραγγελίες στο κατάστημα. Τα έσοδα καμπανιών είναι conversion value που αναφέρουν οι πλατφόρμες διαφημίσεων — διαφορετικός ορισμός και ημερομηνία, όχι «δεύτερο κομμάτι» του ίδιου ταμείου.'
      },
      {
        question: 'Γιατί βλέπω ημέρα που οι διαφημίσεις «δείχνουν» περισσότερα από τον τζίρο e-shop;',
        answer: 'Είναι δυνατό: οι πλατφόρμες μετρούν conversion value με δικό τους τρόπο και ημερομηνία, ενώ ο τζίρος e-shop είναι άθροισμα παραγγελιών. Δεν σημαίνει αυτόματα λάθος στα δεδομένα — σημαίνει ότι δεν συγκρίνεις δύο ίδιες ποσότητες.'
      },
      {
        question: 'Ποιο ROAS πρέπει να χρησιμοποιώ;',
        answer: 'Χρησιμοποιήστε τον True ROAS για business decisions. Ο Campaigns ROAS είναι χρήσιμος για optimization ανά campaign αλλά δεν δείχνει τη συνολική πραγματικότητα.'
      }
    ]
  },

  // ── Competitive Intelligence ──
  {
    id: 'price-benchmarking',
    title: 'Price Benchmarking (Google Merchant Center)',
    description: 'Σύγκριση τιμών σας vs μέση τιμή αγοράς ανά SKU',
    category: 'competitive',
    content: `# Price Benchmarking

## Τι είναι
Χρησιμοποιεί το Google Merchant Center (Content API — PriceCompetitivenessProductView) για να ανακτήσει τη μέση τιμή αγοράς ανά GTIN/SKU.

## Πώς λειτουργεί
1. Συνδέστε τον λογαριασμό Merchant Center μέσω Συνδέσεις → Connectors
2. Πατήστε "Sync τώρα" για εισαγωγή benchmarks
3. Στο Product Intelligence εμφανίζεται η στήλη vs Market (ποσοστιαία απόκλιση)

## Τι βλέπετε
- Πράσινο — η τιμή σας είναι χαμηλότερη από την αγορά
- Κόκκινο — η τιμή σας είναι υψηλότερη
- Summary strip: Σύνολο SKU με benchmark, πόσα πάνω/κάτω, μέση απόκλιση

## Automation trigger
Ενεργοποιήστε τον trigger "Τιμή πάνω από αγορά" στις Ρυθμίσεις Αυτοματισμών για να ειδοποιείστε αυτόματα.`,
    tags: ['price', 'benchmark', 'merchant center', 'gmc', 'vs market', 'sku'],
    related: ['automation-triggers', 'competitor-monitoring'],
    faq: [
      {
        question: 'Χρειάζομαι Google Merchant Center;',
        answer: 'Ναι, πρέπει να έχετε ενεργό GMC account με δημοσιευμένα προϊόντα (Shopping feed) ώστε να υπάρχουν benchmark data.'
      },
      {
        question: 'Πόσο συχνά ανανεώνονται οι τιμές;',
        answer: 'Αυτόματα κάθε μέρα στις 06:00 μέσω scheduled sync. Μπορείτε επίσης να πατήσετε "Sync τώρα" χειροκίνητα.'
      }
    ]
  },
  {
    id: 'competitor-monitoring',
    title: 'Competitor Monitoring (Meta Ad Library)',
    description: 'Παρακολούθηση διαφημίσεων ανταγωνιστών μέσω Meta Ad Library',
    category: 'competitive',
    content: `# Competitor Monitoring

## Τι είναι
Χρησιμοποιεί το Meta Ad Library API για να εντοπίσει ενεργές και ιστορικές διαφημίσεις ανταγωνιστών στα Meta (Facebook/Instagram).

## Πώς λειτουργεί
1. Μεταβείτε στο Competitive Intel από το μενού
2. Προσθέστε ανταγωνιστές (Facebook Page ID + όνομα)
3. Πατήστε "Scan τώρα" για εισαγωγή δεδομένων

## Τι βλέπετε
- KPIs: Αριθμός ανταγωνιστών, ενεργές ads, σύνολο ads, τελευταίο scan
- Λίστα ads: Κείμενο ad, ημερομηνίες, πλατφόρμες, ημέρες λειτουργίας, κατάσταση
- Φίλτρα: Αναζήτηση ανά ανταγωνιστή ή κείμενο

## Automation trigger
Ενεργοποιήστε τον trigger "Νέες ads ανταγωνιστών" για αυτόματη ειδοποίηση όταν εντοπίζονται νέες διαφημίσεις.

## Πώς βρίσκω το Page ID;
- Μεταβείτε στη σελίδα του ανταγωνιστή στο Facebook
- Κάντε κλικ στο "About" / "Πληροφορίες"
- Κάτω-κάτω αναγράφεται το Page ID
- Εναλλακτικά: graph.facebook.com/{page_username}`,
    tags: ['competitor', 'ads', 'meta', 'ad library', 'monitoring', 'facebook'],
    related: ['price-benchmarking', 'automation-triggers'],
    faq: [
      {
        question: 'Χρειάζεται σύνδεση Meta;',
        answer: 'Όχι, το Ad Library API χρησιμοποιεί App Access Token (app_id|app_secret) — δεν απαιτείται user login.'
      },
      {
        question: 'Μπορώ να δω ads ανταγωνιστών σε Google;',
        answer: 'Προς το παρόν η λειτουργία καλύπτει μόνο Meta platforms. Google Ads Transparency Center δεν παρέχει ακόμα programmatic API.'
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
