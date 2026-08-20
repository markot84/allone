import type { Scenario, WeightFactor, ChannelRecommendation } from '../types';

export const scenarios: Scenario[] = [
  { 
    id: 'profit_max', 
    name: 'Profit Maximization', 
    icon: '',
    description: 'Έμφαση σε προϊόντα και ενέργειες με ισχυρότερο περιθώριο κέρδους.',
    weights: { profit: 40, stock: 15, strategic: 15, revenue: 10, fit: 20 },
    duration: 'ongoing' as const
  },
  { 
    id: 'stock_clearance', 
    name: 'Stock Clearance', 
    icon: '',
    description: 'Προτεραιότητα σε προϊόντα με υψηλή δέσμευση αποθέματος ή περιορισμένη κυκλοφορία.',
    weights: { profit: 15, stock: 45, strategic: 10, revenue: 10, fit: 20 },
    duration: 30
  },
  { 
    id: 'brand_launch', 
    name: 'Brand Launch', 
    icon: '',
    description: 'Υποστήριξη νέας εμπορικής εισόδου με αυξημένο στρατηγικό βάρος.',
    weights: { profit: 10, stock: 10, strategic: 50, revenue: 10, fit: 20 },
    duration: 60
  },
  { 
    id: 'revenue_push', 
    name: 'Revenue Push', 
    icon: '',
    description: 'Προτεραιότητα σε ενέργειες που επιδιώκουν ταχύτερη αύξηση πωλήσεων.',
    weights: { profit: 15, stock: 15, strategic: 15, revenue: 35, fit: 20 },
    duration: 90
  },
  {
    id: 'sales_base',
    name: 'Sales Optimization',
    icon: '',
    description:
      'Επιλογή προϊόντων με βάση τον ρυθμό πωλήσεων, τα πρόσφατα παράθυρα 7/30/90 ημερών, το ιστορικό πωλήσεων και την τελευταία πώληση. Μετά την επιλογή, ορίζεται η διάρκεια εφαρμογής της στρατηγικής.',
    cardHint: 'Ρυθμός πωλήσεων και απόθεμα',
    weights: { profit: 14, stock: 28, strategic: 10, revenue: 20, fit: 28 },
    duration: 'ongoing' as const,
  },
  {
    id: 'price_benchmark',
    name: 'Price Benchmarking',
    icon: '',
    description:
      'Εντοπισμός SKU με ανταγωνιστικό πλεονέκτημα τιμής έναντι της αγοράς, με φίλτρα μάρκας, κατηγορίας και επιλογής προϊόντων. Απαιτούνται συγχρονισμένα δεδομένα Merchant Center.',
    cardHint: 'Έναντι αγοράς (GMC)',
    weights: { profit: 22, stock: 18, strategic: 12, revenue: 26, fit: 22 },
    duration: 'ongoing' as const,
  },
  { 
    id: 'mixed', 
    name: 'Μικτή Στρατηγική', 
    icon: '',
    description: 'Συνδυασμός δύο στρατηγικών με επιμερισμό βαρών.',
    weights: null,
    duration: 'ongoing' as const
  },
  { 
    id: 'seasonal_discount', 
    name: 'Εποχιακή / Εκπτωτική', 
    icon: '',
    description: 'Εφαρμογή περιόδων προσφορών και εκπτώσεων σε επιλεγμένα προϊόντα.',
    weights: null,
    duration: 30
  },
];

export const defaultWeights: Record<string, number> = {
  profit: 20,
  stock: 20,
  strategic: 20,
  revenue: 20,
  fit: 20
};

export const weightFactors: Omit<WeightFactor, 'value'>[] = [
  { 
    id: 'profit', 
    name: 'Κερδοφορία', 
    icon: '',
    tooltip: 'Περιθώριο κέρδους ανά προϊόν',
    color: 'var(--factor-profit)'
  },
  { 
    id: 'stock', 
    name: 'Βελτιστοποίηση αποθέματος', 
    icon: '',
    tooltip: 'Επίπεδο αποθέματος, παλαιότητα και πλεονάζουσα ποσότητα',
    color: 'var(--factor-stock)'
  },
  { 
    id: 'strategic', 
    name: 'Στρατηγική προτεραιότητα', 
    icon: '',
    tooltip: 'Νέα λανσαρίσματα, στρατηγικές συμφωνίες και εμπορικές προτεραιότητες',
    color: 'var(--factor-strategic)'
  },
  { 
    id: 'revenue', 
    name: 'Στόχος εσόδων', 
    icon: '',
    tooltip: 'Στόχοι όγκου και εσόδων ανά κατηγορία',
    color: 'var(--factor-revenue)'
  },
  { 
    id: 'fit', 
    name: 'Συνάφεια πελάτη', 
    icon: '',
    tooltip: 'Συνάφεια με το segment και ιστορικό αγορών',
    color: 'var(--factor-fit)'
  }
];

export const channelRecommendations: Record<string, Record<string, ChannelRecommendation>> = {
  profit_max: {
    champions: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Dynamic Remarketing'],
      secondary: ['Email Marketing', 'Google Search Ads'],
      budget_allocation: { google_shopping: 35, meta: 30, remarketing: 20, google_search: 15 },
      rationale: 'Πελάτες: Οι «Champions» είναι οι πιο κερδοφόροι πελάτες με υψηλή πρόθεση αγοράς. || Κανάλια: Google Shopping και Meta Ads για conversion σε high-intent κοινό, Dynamic Remarketing για κλείσιμο κύκλου αγοράς, Email Marketing για cross-sell (owned, χωρίς ad spend). || Αποτέλεσμα: Αύξηση AOV και ROAS μέσω στόχευσης σε πελάτες υψηλής αξίας.'
    },
    loyal: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Google Remarketing'],
      secondary: ['Email Marketing', 'Content Marketing'],
      budget_allocation: { google_shopping: 35, meta: 35, remarketing: 30 },
      rationale: 'Πελάτες: Οι «Loyal Customers» αγοράζουν σταθερά και εμπιστεύονται το brand. || Κανάλια: Google Shopping και Meta Ads για νέα προϊόντα, Remarketing για category expansion, Email (owned) για personalized cross-sell. || Αποτέλεσμα: Αύξηση LTV μέσω category expansion και cross-selling.'
    },
    potential: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Google Search Ads', 'Email Marketing'],
      budget_allocation: { google_shopping: 40, meta: 40, google_search: 20 },
      rationale: 'Πελάτες: Οι «Potential» δείχνουν ενδιαφέρον αλλά δεν έχουν μετατραπεί σε τακτικούς αγοραστές. || Κανάλια: Google Shopping για high-intent αναζητήσεις, Meta Ads για targeted offers με social proof, Email nurture (owned). || Αποτέλεσμα: Conversion σε τακτικούς πελάτες μέσω στοχευμένων προσφορών.'
    },
    at_risk: {
      primary: ['Dynamic Remarketing', 'Meta Retargeting', 'Google Remarketing'],
      secondary: ['Email Marketing', 'SMS Marketing'],
      budget_allocation: { remarketing: 40, meta_retargeting: 35, google_remarketing: 25 },
      rationale: 'Πελάτες: Οι «At Risk» απομακρύνονται, χρειάζονται επανενεργοποίηση. || Κανάλια: Remarketing σε όλες τις πλατφόρμες για επαναστόχευση θερμού κοινού, Email και SMS (owned) για time-sensitive offers. || Αποτέλεσμα: Επανενεργοποίηση πελατών πριν χαθούν οριστικά.'
    },
    lost: {
      primary: ['Meta Ads (Facebook/Instagram)', 'Google Display Network'],
      secondary: ['Google Search Ads', 'Email Marketing'],
      budget_allocation: { meta: 45, display: 35, google_search: 20 },
      rationale: 'Πελάτες: Οι «Lost» χρειάζονται awareness-level προσέγγιση. || Κανάλια: Meta Ads για broad reach, Google Display για brand recall, Search Ads για intent-based catch. || Αποτέλεσμα: Low-cost awareness με ελάχιστη επένδυση.'
    }
  },
  stock_clearance: {
    champions: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Dynamic Remarketing'],
      secondary: ['Email Marketing', 'SMS Marketing'],
      budget_allocation: { google_shopping: 35, meta: 35, remarketing: 30 },
      rationale: 'Πελάτες: Οι «Champions» αγοράζουν γρήγορα, ιδανικοί για εκκαθάριση. || Κανάλια: Google Shopping και Meta Ads με aggressive pricing, Remarketing για επαναστόχευση, Email/SMS (owned) για flash sales. || Αποτέλεσμα: Γρήγορη μείωση αποθέματος μέσω πιστών πελατών.'
    },
    loyal: {
      primary: ['Meta Ads (Facebook/Instagram)', 'Google Shopping'],
      secondary: ['Dynamic Remarketing', 'Email Marketing'],
      budget_allocation: { meta: 40, google_shopping: 35, remarketing: 25 },
      rationale: 'Πελάτες: Οι «Loyal» ανταποκρίνονται θετικά σε προνομιακή και έγκαιρη πρόσβαση σε προσφορές. || Κανάλια: Meta Ads και Google Shopping για προβολή εκπτωτικών επιλογών, Email Marketing για έγκαιρη ενημέρωση του υφιστάμενου κοινού. || Αποτέλεσμα: Βελτίωση του ποσοστού μετατροπής μέσω στοχευμένης και ελεγχόμενης ενεργοποίησης.'
    },
    potential: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Google Search Ads', 'Email Marketing'],
      budget_allocation: { google_shopping: 40, meta: 35, google_search: 25 },
      rationale: 'Πελάτες: Οι «Potential» προσελκύονται από χαμηλές τιμές. || Κανάλια: Google Shopping για price-sensitive αναζητήσεις, Meta Ads για value messaging. || Αποτέλεσμα: Acquisition μέσω value-driven offers.'
    },
    at_risk: {
      primary: ['Dynamic Remarketing', 'Meta Retargeting', 'Marketplace Ads (Skroutz, Amazon)'],
      secondary: ['Email Marketing', 'SMS Marketing'],
      budget_allocation: { remarketing: 35, meta_retargeting: 30, skroutz: 35 },
      rationale: 'Πελάτες: Οι «At Risk» χρειάζονται ελκυστικές τιμές για επιστροφή. || Κανάλια: Remarketing με deep discounts, Skroutz για price-sensitive κοινό, Email/SMS (owned) για flash deals. || Αποτέλεσμα: Επανενεργοποίηση με aggressive pricing.'
    },
    lost: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Google Display Network'],
      secondary: ['Email Marketing'],
      budget_allocation: { google_shopping: 40, meta: 35, display: 25 },
      rationale: 'Πελάτες: Οι «Lost» μπορούν να προσελκυστούν ξανά με aggressive deals. || Κανάλια: Broad paid reach με εκπτωτικό μήνυμα. || Αποτέλεσμα: Volume sales σε χαμηλό κόστος.'
    }
  },
  brand_launch: {
    champions: {
      primary: ['Meta Ads (Facebook/Instagram)', 'YouTube Ads', 'Google Display Network'],
      secondary: ['Email Marketing', 'Influencer Marketing'],
      budget_allocation: { meta: 40, youtube: 35, display: 25 },
      rationale: 'Πελάτες: Οι «Champions» λειτουργούν ως ισχυρό κοινό αποδοχής και πρώιμης διάδοσης του νέου brand. || Κανάλια: Meta και YouTube για αναγνωρισιμότητα, Display για διεύρυνση κάλυψης, Email Marketing για προνομιακή πρώτη ενημέρωση. || Αποτέλεσμα: Ενίσχυση αρχικής αναγνωρισιμότητας και ταχύτερη διάχυση ενδιαφέροντος στο κατάλληλο κοινό.'
    },
    loyal: {
      primary: ['Meta Ads (Facebook/Instagram)', 'YouTube Ads'],
      secondary: ['Google Display Network', 'Email Marketing'],
      budget_allocation: { meta: 45, youtube: 35, display: 20 },
      rationale: 'Πελάτες: Οι «Loyal» δημιουργούν buzz γύρω από νέα brands. || Κανάλια: Meta και YouTube για teaser campaigns, Email (owned) για launch announcements. || Αποτέλεσμα: Brand awareness στη βάση πελατών.'
    },
    potential: {
      primary: ['Meta Ads (Facebook/Instagram)', 'YouTube Ads', 'Google Display Network'],
      secondary: ['TikTok Ads', 'Content Marketing'],
      budget_allocation: { meta: 40, youtube: 30, display: 20, tiktok: 10 },
      rationale: 'Πελάτες: Οι «Potential» χρειάζονται broad awareness. || Κανάλια: Full awareness stack, Meta, YouTube, Display για maximum reach, TikTok για νεανικά κοινά. || Αποτέλεσμα: Ευρεία αναγνωρισιμότητα σε νέα κοινά.'
    },
    at_risk: {
      primary: ['Meta Ads (Facebook/Instagram)', 'Dynamic Remarketing'],
      secondary: ['Google Display Network', 'Email Marketing'],
      budget_allocation: { meta: 45, remarketing: 30, display: 25 },
      rationale: 'Πελάτες: Νέο brand ως ευκαιρία re-engagement. || Κανάλια: Meta για fresh positioning, Remarketing για υπενθύμιση. || Αποτέλεσμα: Re-engagement μέσω brand refresh.'
    },
    lost: {
      primary: ['Google Display Network', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['YouTube Ads', 'Email Marketing'],
      budget_allocation: { display: 45, meta: 35, youtube: 20 },
      rationale: 'Πελάτες: Brand refresh ως ευκαιρία επανασύνδεσης. || Κανάλια: Display και Meta για broad awareness. || Αποτέλεσμα: Brand recall σε χαμηλό κόστος.'
    }
  },
  revenue_push: {
    champions: {
      primary: ['Google Shopping', 'Google Search Ads', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Dynamic Remarketing', 'Email Marketing'],
      budget_allocation: { google_shopping: 35, google_search: 25, meta: 25, remarketing: 15 },
      rationale: 'Πελάτες: Οι «Champions» εμφανίζουν υψηλή αξία καλαθιού και είναι κατάλληλοι για αναβάθμιση πωλήσεων σε προϊοντικές προτάσεις υψηλότερης αξίας. || Κανάλια: Google Shopping και Search για ζήτηση υψηλής πρόθεσης, Meta για διεύρυνση σε συναφή κοινά, Remarketing για επαναγορές, Email Marketing για προτάσεις συνδυαστικών αγορών. || Αποτέλεσμα: Ενίσχυση εσόδων από πελάτες υψηλής αξίας με καλύτερη αξιοποίηση της πρόθεσης αγοράς.'
    },
    loyal: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Google Search Ads', 'Email Marketing'],
      budget_allocation: { google_shopping: 40, meta: 35, google_search: 25 },
      rationale: 'Πελάτες: Οι «Loyal» αγοράζουν σταθερά, ιδανικοί για volume push. || Κανάλια: Google Shopping και Meta για category expansion, Email (owned) για cross-sell. || Αποτέλεσμα: Volume push μέσω category expansion.'
    },
    potential: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Google Search Ads'],
      secondary: ['Email Marketing', 'Content Marketing'],
      budget_allocation: { google_shopping: 40, meta: 35, google_search: 25 },
      rationale: 'Πελάτες: Οι «Potential» αποτελούν acquisition target. || Κανάλια: Aggressive paid mix, Google Shopping, Meta, Search για volume. || Αποτέλεσμα: Aggressive acquisition για revenue goals.'
    },
    at_risk: {
      primary: ['Dynamic Remarketing', 'Meta Retargeting', 'Google Remarketing'],
      secondary: ['Email Marketing', 'SMS Marketing'],
      budget_allocation: { remarketing: 40, meta_retargeting: 35, google_remarketing: 25 },
      rationale: 'Πελάτες: Οι «At Risk» χρειάζονται incentive-driven reactivation. || Κανάλια: Full remarketing stack με personalized offers, Email/SMS (owned) για flash deals. || Αποτέλεσμα: Quick revenue μέσω reactivation.'
    },
    lost: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Google Display Network'],
      secondary: ['Google Search Ads', 'Email Marketing'],
      budget_allocation: { google_shopping: 40, meta: 35, display: 25 },
      rationale: 'Πελάτες: Volume-focused broad targeting. || Κανάλια: Paid channels για broad reach με aggressive offers. || Αποτέλεσμα: Volume sales μέσω ευρείας στόχευσης.'
    }
  },
  sales_base: {
    champions: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Email Marketing'],
      secondary: ['Dynamic Remarketing', 'SMS Marketing'],
      budget_allocation: { google_shopping: 35, meta: 30, remarketing: 20, email: 15 },
      rationale: 'Πελάτες: Champions — αξιοποιήστε τους για τα SKU του επιλεγμένου σεναρίου (επανενεργοποίηση στάσιμων ή ενίσχυση ταχυκίνητων) με bundled offers & VIP early access. || Κανάλια: Shopping/Meta για visibility, email/SMS για owned push. || Αποτέλεσμα: Γρήγορη δοκιμή τιμής/προσφοράς στα SKU του σεναρίου.'
    },
    loyal: {
      primary: ['Email Marketing', 'Google Shopping', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Dynamic Remarketing', 'Content Marketing'],
      budget_allocation: { email: 35, google_shopping: 35, meta: 30 },
      rationale: 'Πελάτες: Loyal — ενημερώστε για SKU που «κόπηκαν» σε πωλήσεις τελευταίας περιόδου. || Κανάλια: Email-first για κατάλογο/εκκαθάριση, paid για retarget. || Αποτέλεσμα: Ανακύκλωση προσοχής σε slow movers χωρίς χαμένο audience.'
    },
    potential: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Google Search Ads'],
      secondary: ['Email Marketing', 'YouTube Ads'],
      budget_allocation: { google_shopping: 40, meta: 35, google_search: 25 },
      rationale: 'Πελάτες: Potential — δοκιμή νέων hooks (τιμή, bundle) σε SKU χωρίς πρόσφατες πωλήσεις. || Κανάλια: High-intent search/shopping + social proof στο Meta. || Αποτέλεσμα: Μετατροπή trial σε πρώτη πώληση για «σιωπηλά» SKU.'
    },
    at_risk: {
      primary: ['Dynamic Remarketing', 'Meta Retargeting', 'Email Marketing'],
      secondary: ['SMS Marketing', 'Google Shopping'],
      budget_allocation: { remarketing: 40, meta: 35, email: 25 },
      rationale: 'Πελάτες: At Risk — στοχεύστε επαναστόχευση σε όσους αγόρασαν παλιά slow SKUs. || Κανάλια: Remarketing + owned για time-boxed promos. || Αποτέλεσμα: Καθαρίζει απόθεμα πριν χαθεί το ενδιαφέρον.'
    },
    lost: {
      primary: ['Google Display Network', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Google Shopping', 'Email Marketing'],
      budget_allocation: { display: 45, meta: 35, google_shopping: 20 },
      rationale: 'Πελάτες: Για ευρύ ή ανενεργό κοινό, απαιτείται προσεκτική επαναεισαγωγή του προϊόντος με ανταγωνιστική αρχική τιμή. || Κανάλια: Display και Meta για ευρεία κάλυψη, Shopping για απορρόφηση ζήτησης όταν εκδηλωθεί πρόθεση αγοράς. || Αποτέλεσμα: Δοκιμή αποδοχής προϊόντος στην αγορά με ελεγχόμενο κόστος προσέγγισης.'
    }
  },
  price_benchmark: {
    champions: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Email Marketing'],
      secondary: ['Dynamic Remarketing', 'SMS Marketing'],
      budget_allocation: { google_shopping: 38, meta: 32, remarketing: 18, email: 12 },
      rationale:
        'Πελάτες: Champions — highlight SKU με τιμή κάτω από αγορά (value story, bundles). || Κανάλια: Shopping/Meta για price-led messaging, email για VIP lists. || Αποτέλεσμα: Μεγιστοποίηση μετατροπής όταν το προϊόν είναι ήδη ανταγωνιστικό στην τιμή.',
    },
    loyal: {
      primary: ['Email Marketing', 'Google Shopping', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['Dynamic Remarketing', 'Content Marketing'],
      budget_allocation: { email: 32, google_shopping: 38, meta: 30 },
      rationale:
        'Πελάτες: Loyal — ενημέρωση για «καλές τιμές» vs αγορά σε επιλεγμένα SKU. || Κανάλια: Email-first + paid για social proof. || Αποτέλεσμα: Ενίσχυση επαναλαμβανόμενων αγορών χωρίς race-to-bottom.',
    },
    potential: {
      primary: ['Google Shopping', 'Google Search Ads', 'Meta Ads (Facebook/Instagram)'],
      secondary: ['YouTube Ads', 'Email Marketing'],
      budget_allocation: { google_shopping: 42, google_search: 28, meta: 30 },
      rationale:
        'Πελάτες: Potential — acquisition με ισχυρό price advantage έναντι benchmark. || Κανάλια: High-intent search/shopping + Meta value angles. || Αποτέλεσμα: Μετατροπή trial με βάση την τιμή έναντι ανταγωνισμού.',
    },
    at_risk: {
      primary: ['Dynamic Remarketing', 'Meta Retargeting', 'Google Shopping'],
      secondary: ['Email Marketing', 'SMS Marketing'],
      budget_allocation: { remarketing: 38, meta: 32, google_shopping: 30 },
      rationale:
        'Πελάτες: At Risk — υπενθύμιση value (κάτω από αγορά) πριν χαθεί το ενδιαφέρον. || Κανάλια: Remarketing + owned με time-boxed προσφορές. || Αποτέλεσμα: Επανενεργοποίηση με βάση την τιμή.',
    },
    lost: {
      primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Google Display Network'],
      secondary: ['Email Marketing'],
      budget_allocation: { google_shopping: 40, meta: 35, display: 25 },
      rationale:
        'Πελάτες: Lost/broad — δοκιμή entry με ισχυρό price vs market. || Κανάλια: Display/Meta reach + shopping για intent. || Αποτέλεσμα: Δοκιμή PMF με ανταγωνιστική τιμή.',
    },
  },
};

export const approvalStatuses = {
  draft: { label: 'Προσχέδιο', color: 'gray', icon: '📝' },
  pending_review: { label: 'Υπό αξιολόγηση', color: 'orange', icon: '⏳' },
  approved: { label: 'Εγκεκριμένο', color: 'green', icon: '✅' },
  implementing: { label: 'Σε εφαρμογή', color: 'blue', icon: '🚀' }
};
