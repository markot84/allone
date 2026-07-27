/** Seed a full demo brand then trigger production aggregators. Idempotent (deterministic ids + fixed RNG seed). Service account needed for server-only collections. Usage: node scripts/seed-demo-brand.mjs <serviceAccountKey.json> --email=you@example.com [--apiKey=WEB_API_KEY] [--no-refresh] [--brand=sportflow-demo]
 * Env: GOOGLE_APPLICATION_CREDENTIALS (key path), VITE_FIREBASE_API_KEY (Web API key for the refresh token exchange). */
import { createHash } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Config ───────────────────────────────────────────────────────────────────
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'allone-9e685';
const FUNCTIONS_REGION = 'europe-west1';
const VAT = 0.24;

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const keyPath = args.find((a) => !a.startsWith('--')) || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const adminEmail = (flags.email || process.env.SEED_ADMIN_EMAIL || '').toString().toLowerCase();
const webApiKey = (flags.apiKey || process.env.VITE_FIREBASE_API_KEY || '').toString();
const doRefresh = !flags['no-refresh'];

const BRAND_ID = (flags.brand || 'sportflow-demo').toString();
const BRAND_NAME = 'SportFlow';

// Volume scaling for a viable €2M+/year B2C e-shop: CUSTOMER_SCALE drives orders → revenue
// (base ≈ €87k × 24 ≈ €2.1M); traffic + paid spend scale separately to keep CVR/ROAS realistic.
const CUSTOMER_SCALE = Number(flags.scale ?? 26) || 26;
const GA4_TRAFFIC_SCALE = 3;
const CAMPAIGN_SCALE = 6;

if (!adminEmail) {
  console.error('Missing --email=<super-admin email>. Needed for brand ownership + refresh token.');
  process.exit(1);
}

const app = keyPath
  ? initializeApp({ credential: cert(keyPath), projectId: PROJECT_ID })
  : initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

// ── Deterministic RNG (mulberry32) ───────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260530);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;
const chance = (p) => rand() < p;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const isoDay = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);
const ym = (ts) => new Date(ts).toISOString().slice(0, 7);

// Seasonality multiplier by month (Greek retail: peaks Nov/Dec + summer sales)
const MONTH_WEIGHT = { 0: 0.95, 1: 0.85, 2: 0.95, 3: 1.0, 4: 1.1, 5: 1.15, 6: 1.2, 7: 0.7, 8: 1.05, 9: 1.1, 10: 1.35, 11: 1.6 };
const seasonalFactor = (ts) => MONTH_WEIGHT[new Date(ts).getMonth()] ?? 1;

// ── Batched writer ────────────────────────────────────────────────────────────
const pending = [];
function queue(ref, data) {
  pending.push({ ref, data });
}
async function flush() {
  let written = 0;
  for (let i = 0; i < pending.length; i += 450) {
    const batch = db.batch();
    for (const { ref, data } of pending.slice(i, i + 450)) {
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
    written += Math.min(450, pending.length - i);
    process.stdout.write(`\r  wrote ${written}/${pending.length} docs`);
  }
  console.log('');
  pending.length = 0;
}

/** Delete all docs in a top-level collection for this brand (cleanup of legacy platform data). */
async function deleteBrandDocs(collection) {
  let total = 0;
  for (;;) {
    const snap = await db.collection(collection).where('brandId', '==', BRAND_ID).limit(450).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 450) break;
  }
  if (total) console.log(`  cleaned ${total} old docs from ${collection}`);
}

// ── 1. Catalog (sports goods) ─────────────────────────────────────────────────
const SUPPLIERS = [
  { id: 'sup_velocita', name: 'Velocita Athletics', tod: 45, lead_time: 21, contact: 'orders@velocita.example' },
  { id: 'sup_apex', name: 'Apex Sportswear', tod: 60, lead_time: 30, contact: 'b2b@apex.example' },
  { id: 'sup_kinetix', name: 'Kinetix Distribution', tod: 30, lead_time: 14, contact: 'sales@kinetix.example' },
  { id: 'sup_aquaforce', name: 'AquaForce Imports', tod: 75, lead_time: 40, contact: 'hello@aquaforce.example' },
  { id: 'sup_purefuel', name: 'PureFuel Nutrition', tod: 25, lead_time: 10, contact: 'wholesale@purefuel.example' },
];

// category → { sub, brands[], priceRange[min,max], seasonality }
const CATALOG_DEFS = [
  { cat: 'Running', subs: ['Παπούτσια', 'Ρούχα', 'Αξεσουάρ'], brands: ['Velocita', 'StridePro'], price: [29, 169], season: 'spring_summer', supplier: 'Velocita Athletics' },
  { cat: 'Football', subs: ['Παπούτσια', 'Μπάλες', 'Ρούχα'], brands: ['Apex', 'Velocita'], price: [19, 139], season: 'autumn_winter', supplier: 'Apex Sportswear' },
  { cat: 'Basketball', subs: ['Παπούτσια', 'Μπάλες', 'Ρούχα'], brands: ['CourtKing', 'Apex'], price: [24, 159], season: 'all', supplier: 'Apex Sportswear' },
  { cat: 'Fitness', subs: ['Βάρη', 'Εξοπλισμός', 'Ρούχα'], brands: ['Kinetix', 'Apex'], price: [12, 249], season: 'q1_resolution', supplier: 'Kinetix Distribution' },
  { cat: 'Swimming', subs: ['Μαγιό', 'Αξεσουάρ', 'Γυαλιά'], brands: ['AquaForce'], price: [9, 89], season: 'summer', supplier: 'AquaForce Imports' },
  { cat: 'Outdoor', subs: ['Παπούτσια', 'Σακίδια', 'Ρούχα'], brands: ['TrailEdge', 'Kinetix'], price: [29, 219], season: 'spring_autumn', supplier: 'Kinetix Distribution' },
  { cat: 'Tennis', subs: ['Ρακέτες', 'Παπούτσια', 'Αξεσουάρ'], brands: ['CourtKing'], price: [19, 199], season: 'spring_summer', supplier: 'Apex Sportswear' },
  { cat: 'Apparel', subs: ['T-shirts', 'Φόρμες', 'Κάλτσες'], brands: ['Apex', 'Velocita', 'Kinetix'], price: [9, 79], season: 'all', supplier: 'Apex Sportswear' },
  { cat: 'Accessories', subs: ['Τσάντες', 'Καπέλα', 'Γάντια'], brands: ['Kinetix', 'TrailEdge'], price: [7, 59], season: 'all', supplier: 'Kinetix Distribution' },
  { cat: 'Nutrition', subs: ['Πρωτεΐνη', 'Βιταμίνες', 'Ενυδάτωση'], brands: ['PureFuel'], price: [9, 69], season: 'q1_resolution', supplier: 'PureFuel Nutrition' },
];

const PRODUCT_NOUNS = {
  'Παπούτσια': ['Aero', 'Glide', 'Sprint', 'Trail', 'Court', 'Boost'],
  'Ρούχα': ['Dry', 'Flex', 'Thermo', 'Active', 'Pro'],
  'Μπάλες': ['Match', 'Pro', 'Street', 'Club'],
  'Βάρη': ['Iron', 'Power', 'Core'],
  'Εξοπλισμός': ['Home', 'Studio', 'Power'],
  'Μαγιό': ['Hydro', 'Race', 'Splash'],
  'Γυαλιά': ['Vision', 'Hydro'],
  'Σακίδια': ['Summit', 'Day', 'Expedition'],
  'Ρακέτες': ['Ace', 'Spin', 'Power'],
  'T-shirts': ['Core', 'Dry', 'Logo'],
  'Φόρμες': ['Comfort', 'Tech', 'Travel'],
  'Κάλτσες': ['Cushion', 'Run', 'Ankle'],
  'Τσάντες': ['Gym', 'Sport', 'Travel'],
  'Καπέλα': ['Run', 'Sun', 'Club'],
  'Γάντια': ['Grip', 'Winter', 'Pro'],
  'Πρωτεΐνη': ['Whey', 'Vegan', 'Iso'],
  'Βιταμίνες': ['Daily', 'Immune', 'Energy'],
  'Ενυδάτωση': ['Electro', 'Hydro', 'Recovery'],
  'Αξεσουάρ': ['Pro', 'Sport', 'Active'],
};

const products = [];
let skuCounter = 1000;
for (const def of CATALOG_DEFS) {
  const count = randInt(5, 6);
  for (let i = 0; i < count; i++) {
    const sub = pick(def.subs);
    const brand = pick(def.brands);
    const noun = pick(PRODUCT_NOUNS[sub] || ['Pro']);
    const sku = `${def.cat.slice(0, 3).toUpperCase()}-${skuCounter++}`;
    const priceExFactor = def.price[0] + rand() * (def.price[1] - def.price[0]);
    const price = round2(priceExFactor * 1.24); // retail incl VAT, ends loosely
    const priceExVat = round2(price / 1.24);
    const marginPct = randInt(28, 62);
    const cost = round2(priceExVat * (1 - marginPct / 100));
    const marginTier = marginPct >= 50 ? 'high' : marginPct >= 38 ? 'medium' : 'low';

    // Stock health distribution
    const roll = rand();
    let stock, qtyPeriod, qtyLifetime, lastSaleDaysAgo, bucket;
    if (roll < 0.12) { bucket = 'no_stock'; stock = 0; qtyPeriod = randInt(0, 6); }
    else if (roll < 0.28) { bucket = 'low'; stock = randInt(1, 8); qtyPeriod = randInt(8, 40); }
    else if (roll < 0.46) { bucket = 'excess'; stock = randInt(180, 600); qtyPeriod = randInt(0, 12); }
    else if (roll < 0.60) { bucket = 'dead'; stock = randInt(60, 240); qtyPeriod = randInt(0, 3); }
    else { bucket = 'healthy'; stock = randInt(20, 140); qtyPeriod = randInt(25, 180); }
    qtyLifetime = qtyPeriod + randInt(0, 400);
    lastSaleDaysAgo = bucket === 'dead' || bucket === 'no_stock' ? randInt(70, 240) : randInt(0, 35);
    const firstAvailDays = randInt(40, 700);

    products.push({
      id: sku,
      sku,
      name: `${brand} ${noun} ${sub} ${def.cat}`,
      category: def.cat,
      subcategory: sub,
      brand,
      margin_tier: marginTier,
      margin_percentage: marginPct,
      price,
      compare_at_price: chance(0.3) ? round2(price * 1.15) : undefined,
      list_price: round2(price * 1.1),
      cost_price: cost,
      stock_level: stock,
      stock_capacity: Math.max(stock + 40, Math.round(stock * 1.4) + 20),
      stock_on_hand: stock,
      available_stock: Math.max(0, stock - randInt(0, 4)),
      priority_tag: bucket,
      qty_sold_period: qtyPeriod,
      qty_sold_last_7d: Math.round(qtyPeriod * 0.08),
      qty_sold_last_30d: Math.round(qtyPeriod * 0.3),
      qty_sold_last_90d: Math.round(qtyPeriod * 0.7),
      qty_sold_lifetime: qtyLifetime,
      revenue_period: round2(qtyPeriod * priceExVat),
      last_sale_at: isoDay(lastSaleDaysAgo),
      first_available_date: isoDay(firstAvailDays),
      supplier: def.supplier,
      barcode: `52${randInt(10000000000, 99999999999)}`,
      gtin: `52${randInt(10000000000, 99999999999)}`,
      status: bucket === 'no_stock' ? 'inactive' : 'active',
      abc_class: marginTier === 'high' ? 'A' : marginTier === 'medium' ? 'B' : 'C',
      flow_group: bucket === 'healthy' ? 'Υψηλή' : bucket === 'excess' || bucket === 'dead' ? 'Χαμηλή' : 'Μέτρια',
      seasonality_tag: def.season,
      reorder_point: randInt(5, 25),
      reorder_qty: randInt(20, 120),
      source: 'erp',
      brandId: BRAND_ID,
      createdAt: isoDay(firstAvailDays),
    });
  }
}
console.log(`Catalog: ${products.length} SKUs`);

// ── 2. Customers + Orders (drives e-commerce summary + RFM) ───────────────────
const GREEK_FIRST = ['Γιώργος', 'Μαρία', 'Νίκος', 'Ελένη', 'Δημήτρης', 'Κατερίνα', 'Κώστας', 'Σοφία', 'Γιάννης', 'Αναστασία', 'Παναγιώτης', 'Χριστίνα', 'Βασίλης', 'Ιωάννα', 'Θανάσης', 'Δέσποινα'];
const GREEK_LAST = ['Παπαδόπουλος', 'Νικολάου', 'Γεωργίου', 'Δημητρίου', 'Αντωνίου', 'Βασιλείου', 'Ιωάννου', 'Κωνσταντίνου', 'Παππάς', 'Οικονόμου', 'Μακρής', 'Σταυρόπουλος'];
const CITIES = ['Αθήνα', 'Θεσσαλονίκη', 'Πάτρα', 'Ηράκλειο', 'Λάρισα', 'Βόλος', 'Ιωάννινα', 'Χανιά', 'Καβάλα', 'Ρόδος'];

const PROFILES = [
  { key: 'champion', n: 12, orders: [8, 14], lastMax: 18, spanMax: 320, basket: [2, 4] },
  { key: 'loyal', n: 25, orders: [4, 7], lastMax: 45, spanMax: 260, basket: [1, 3] },
  { key: 'potential', n: 30, orders: [2, 3], lastMax: 70, spanMax: 150, basket: [1, 2] },
  { key: 'new', n: 22, orders: [1, 1], lastMax: 25, spanMax: 25, basket: [1, 2] },
  { key: 'at_risk', n: 28, orders: [2, 4], lastMin: 95, lastMax: 165, spanMax: 330, basket: [1, 3] },
  { key: 'lost', n: 23, orders: [1, 2], lastMin: 200, lastMax: 340, spanMax: 360, basket: [1, 2] },
];

const categories = [...new Set(products.map((p) => p.category))];
// Keep the dead / no-stock cohort genuinely unsold for a credible Product Intelligence
// dead-stock story (else the scaled order volume "sells" every SKU).
const sellable = products.filter((p) => p.priority_tag !== 'dead' && p.priority_tag !== 'no_stock');
const sellableByCat = Object.fromEntries(
  categories.map((c) => {
    const list = sellable.filter((p) => p.category === c);
    return [c, list.length ? list : sellable];
  })
);

let custId = 5000;
let orderId = 900000;
const orders = [];
for (const prof of PROFILES) {
  for (let i = 0; i < prof.n * CUSTOMER_SCALE; i++) {
    const first = pick(GREEK_FIRST);
    const last = pick(GREEK_LAST);
    const cid = String(custId++);
    const email = `${transliterate(first)}.${transliterate(last)}${randInt(1, 99)}@example.com`.toLowerCase();
    const emailHash = createHash('sha256').update(email).digest('hex');
    const name = `${first} ${last}`;
    const city = pick(CITIES);
    const affinityCat = pick(categories);
    const nOrders = randInt(prof.orders[0], prof.orders[1]);

    for (let o = 0; o < nOrders; o++) {
      // Newest order respects lastMax; older orders spread back over span
      let daysAgo;
      if (o === 0) daysAgo = randInt(prof.lastMin ?? 1, prof.lastMax);
      else daysAgo = randInt((prof.lastMin ?? 1) + 10, prof.spanMax);
      const ts = NOW - daysAgo * DAY;

      const oid = String(orderId++);
      const basketSize = randInt(prof.basket[0], prof.basket[1]);
      const lineItems = [];
      let baseSubtotal = 0;
      for (let l = 0; l < basketSize; l++) {
        const pool = chance(0.7) ? sellableByCat[affinityCat] : sellable;
        const prod = pick(pool);
        const qty = chance(0.8) ? 1 : 2;
        // Magento REST item price = unit ex-tax; seasonal discount nudges value
        const unitEx = round2((prod.price / (1 + VAT)) * (0.92 + rand() * 0.16));
        const rowTotal = round2(unitEx * qty);
        baseSubtotal += rowTotal;
        lineItems.push({ sku: prod.sku, title: prod.name, name: prod.name, quantity: qty, price: unitEx, rowTotal, productType: 'simple', itemId: `${oid}_${l}`, parentItemId: null });
      }
      baseSubtotal = round2(baseSubtotal);
      const taxAmount = round2(baseSubtotal * VAT);
      const grandTotal = round2(baseSubtotal + taxAmount);
      // Magento statuses: 'pending'/'canceled'/'refunded' are EXCLUDED by the aggregators → keep mostly 'complete'
      const sRoll = rand();
      const status = sRoll < 0.88 ? 'complete' : sRoll < 0.96 ? 'processing' : chance(0.5) ? 'canceled' : 'refunded';
      orders.push({
        id: `magento_${oid}`,
        data: {
          orderId: oid,
          incrementId: oid,
          orderName: `#${oid}`,
          orderNumber: oid,
          customerId: cid,
          customerEmail: email,
          customerEmailHash: emailHash,
          customerName: name,
          createdAt: new Date(ts).toISOString(),
          updatedAt: new Date(ts).toISOString(),
          status,
          grandTotal,
          baseGrandTotal: grandTotal,
          subtotal: baseSubtotal,
          baseSubtotal,
          taxAmount,
          discountAmount: 0,
          baseDiscountAmount: 0,
          totalPrice: grandTotal,
          currency: 'EUR',
          baseCurrencyCode: 'EUR',
          magentoStoreId: 1,
          orderStoreDomain: 'sportflow.example',
          paymentMethod: pick(['checkmo', 'card', 'paypal_express', 'cashondelivery']),
          shippingMethod: pick(['flatrate_flatrate', 'freeshipping_freeshipping', 'tablerate_bestway']),
          lineItemCount: lineItems.length,
          lineItems,
          shippingCity: city,
          shippingCountry: 'GR',
          tags: prof.key,
          source: 'magento_api',
          brandId: BRAND_ID,
        },
      });
    }
  }
}
// Apply a light seasonal duplication: clone a few orders into Nov/Dec peak if their month is low
console.log(`Customers: ${custId - 5000}, Orders: ${orders.length}`);

function transliterate(s) {
  const map = { ά: 'a', α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z', η: 'i', ή: 'i', θ: 'th', ι: 'i', ί: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o', ώ: 'o' };
  return s.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9.]/g, '');
}

// ── 3. RFM Segments (import-style, for the segments collection) ────────────────
const SEGMENT_DEFS = [
  { id: 'seg_champions', name: 'Champions', rfm_score: '555', count: 12, percentage: 8.6, revenue_share: 34, color: '#22C55E', icon: 'crown', description: 'Πελάτες υψηλής αξίας με πρόσφατες & συχνές αγορές.', persona: 'Loyal high-spender', churn: 8, ltv: 1450 },
  { id: 'seg_loyal', name: 'Loyal Customers', rfm_score: '454', count: 25, percentage: 17.9, revenue_share: 26, color: '#3B82F6', icon: 'heart', description: 'Σταθερές επαναλαμβανόμενες αγορές.', persona: 'Repeat buyer', churn: 18, ltv: 720 },
  { id: 'seg_potential', name: 'Potential Loyalist', rfm_score: '344', count: 30, percentage: 21.4, revenue_share: 16, color: '#8B5CF6', icon: 'trending-up', description: 'Πρόσφατοι πελάτες με αυξανόμενη συχνότητα.', persona: 'Emerging', churn: 28, ltv: 340 },
  { id: 'seg_new', name: 'New Customers', rfm_score: '511', count: 22, percentage: 15.7, revenue_share: 9, color: '#06B6D4', icon: 'sparkles', description: 'Πρόσφατη πρώτη αγορά — ευκαιρία onboarding.', persona: 'First-timer', churn: 35, ltv: 180 },
  { id: 'seg_at_risk', name: 'At Risk', rfm_score: '244', count: 28, percentage: 20.0, revenue_share: 11, color: '#F59E0B', icon: 'alert-triangle', description: 'Καλοί πελάτες που δεν αγόρασαν πρόσφατα.', persona: 'Fading loyal', churn: 64, ltv: 410 },
  { id: 'seg_lost', name: 'Hibernating', rfm_score: '122', count: 23, percentage: 16.4, revenue_share: 4, color: '#EF4444', icon: 'moon', description: 'Ανενεργοί — χρειάζονται win-back.', persona: 'Dormant', churn: 86, ltv: 95 },
];
const CHANNELS = ['Email', 'Google Shopping', 'Meta Ads', 'Remarketing', 'SMS'];

// ── 4. Campaigns (Google Ads + Meta) + Organic revenue ────────────────────────
const CAMPAIGN_DEFS = [
  { name: 'Search — Brand', channel: 'Google Ads', budget: 1200, roas: 8.5, cpc: 0.28 },
  { name: 'Search — Generic Running', channel: 'Google Ads', budget: 2600, roas: 3.1, cpc: 0.62 },
  { name: 'Shopping — All Products', channel: 'Google Ads', budget: 4200, roas: 4.4, cpc: 0.41 },
  { name: 'Performance Max — Q4', channel: 'Google Ads', budget: 3800, roas: 5.2, cpc: 0.37 },
  { name: 'Prospecting — Lookalike', channel: 'Meta', budget: 3100, roas: 2.4, cpc: 0.33 },
  { name: 'Retargeting — Cart Abandoners', channel: 'Meta', budget: 1500, roas: 6.8, cpc: 0.21 },
  { name: 'Awareness — Video', channel: 'Meta', budget: 1800, roas: 1.6, cpc: 0.09 },
];
const GEO = { GR: 0.78, CY: 0.08, DE: 0.06, GB: 0.05, US: 0.03 };

// ── 5. GA4 daily metrics (last 180 days) ──────────────────────────────────────
const GA4_DAYS = 180;
const GA4_CHANNELS = ['Organic Search', 'Direct', 'Paid Search', 'Paid Social', 'Referral', 'Email', 'Organic Social'];
const CHANNEL_MIX = { 'Organic Search': 0.30, Direct: 0.18, 'Paid Search': 0.16, 'Paid Social': 0.14, Referral: 0.08, Email: 0.08, 'Organic Social': 0.06 };

// ── Builders ───────────────────────────────────────────────────────────────────
function buildGA4() {
  const dailyMetrics = {};
  const dailyTrafficByChannel = {};
  const organicRevenueByDay = {};
  const trafficSources = {};
  for (const ch of GA4_CHANNELS) trafficSources[ch] = { sessions: 0, users: 0, newUsers: 0, conversions: 0, totalRevenue: 0 };

  for (let d = GA4_DAYS; d >= 0; d--) {
    const ts = NOW - d * DAY;
    const date = ymd(ts);
    const dow = new Date(ts).getDay();
    const weekend = dow === 0 || dow === 6 ? 0.82 : 1;
    const base = 420 * GA4_TRAFFIC_SCALE * seasonalFactor(ts) * weekend * (0.85 + rand() * 0.3);
    const sessions = Math.round(base);
    const totalUsers = Math.round(sessions * (0.82 + rand() * 0.08));
    const newUsers = Math.round(totalUsers * (0.55 + rand() * 0.12));
    const cvr = 0.018 + rand() * 0.016;
    const conversions = Math.round(sessions * cvr);
    const revenue = round2(conversions * (52 + rand() * 28));
    dailyMetrics[date] = {
      sessions,
      totalUsers,
      newUsers,
      pageViews: Math.round(sessions * (3.2 + rand() * 1.4)),
      bounceRate: round2(0.38 + rand() * 0.18),
      avgSessionDuration: round2(95 + rand() * 70),
      conversions,
      eventCount: Math.round(sessions * (6 + rand() * 3)),
      addToCarts: Math.round(sessions * (0.06 + rand() * 0.05)),
    };
    dailyTrafficByChannel[date] = {};
    for (const ch of GA4_CHANNELS) {
      const share = CHANNEL_MIX[ch];
      const s = Math.round(sessions * share * (0.85 + rand() * 0.3));
      const u = Math.round(s * 0.85);
      const nu = Math.round(u * 0.6);
      const c = Math.round(s * cvr * (ch.includes('Paid') ? 1.2 : ch === 'Email' ? 1.4 : 0.9));
      const rev = round2(c * (52 + rand() * 28));
      dailyTrafficByChannel[date][ch] = { sessions: s, users: u, newUsers: nu, conversions: c, totalRevenue: rev };
      trafficSources[ch].sessions += s;
      trafficSources[ch].users += u;
      trafficSources[ch].newUsers += nu;
      trafficSources[ch].conversions += c;
      trafficSources[ch].totalRevenue = round2(trafficSources[ch].totalRevenue + rev);
      if (ch.toLowerCase().includes('organic')) {
        organicRevenueByDay[date] = round2((organicRevenueByDay[date] || 0) + rev);
      }
    }
  }
  const sc = GA4_TRAFFIC_SCALE;
  const topPages = [
    { path: '/', pageViews: 48200 * sc, sessions: 31200 * sc, newUsers: 14100 * sc, bounceRate: 0.36 },
    { path: '/collections/running', pageViews: 21800 * sc, sessions: 14600 * sc, newUsers: 6200 * sc, bounceRate: 0.41 },
    { path: '/collections/fitness', pageViews: 16400 * sc, sessions: 10900 * sc, newUsers: 4800 * sc, bounceRate: 0.44 },
    { path: '/products/velocita-aero-running', pageViews: 12900 * sc, sessions: 9100 * sc, newUsers: 5200 * sc, bounceRate: 0.48 },
    { path: '/collections/sale', pageViews: 11200 * sc, sessions: 8200 * sc, newUsers: 3100 * sc, bounceRate: 0.39 },
    { path: '/pages/size-guide', pageViews: 6400 * sc, sessions: 4900 * sc, newUsers: 1900 * sc, bounceRate: 0.52 },
  ];
  return {
    propertyId: '480123456',
    propertyName: 'SportFlow — Web',
    dailyMetrics,
    trafficSources,
    organicRevenueByDay,
    topPages,
    syncedAt: FieldValue.serverTimestamp(),
    dateRange: { start: ymd(NOW - GA4_DAYS * DAY), end: ymd(NOW) },
    dailyTrafficByChannel,
  };
}

function buildCampaigns() {
  const list = [];
  for (let i = 0; i < CAMPAIGN_DEFS.length; i++) {
    const def = CAMPAIGN_DEFS[i];
    const days = 90;
    const dailyMetrics = {};
    let spend = 0, impressions = 0, clicks = 0, conversions = 0, convValue = 0;
    const geoByCountry = {};
    for (const [cc] of Object.entries(GEO)) geoByCountry[cc] = { impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, amount_spent: 0 };

    for (let d = days; d >= 0; d--) {
      const ts = NOW - d * DAY;
      const date = ymd(ts);
      const daySpend = round2((def.budget * CAMPAIGN_SCALE / 30) * seasonalFactor(ts) * (0.7 + rand() * 0.6));
      const dClicks = Math.round(daySpend / def.cpc);
      const dImpr = Math.round(dClicks / (0.012 + rand() * 0.03));
      const dConv = Math.round(dClicks * (0.03 + rand() * 0.04));
      const dVal = round2(daySpend * def.roas * (0.8 + rand() * 0.4));
      dailyMetrics[date] = {
        impressions: dImpr, clicks: dClicks, conversions: dConv,
        amount_spent: daySpend, conversion_value: dVal,
        purchase_conversions: dConv, purchase_conversion_value: dVal,
      };
      spend += daySpend; impressions += dImpr; clicks += dClicks; conversions += dConv; convValue += dVal;
      for (const [cc, w] of Object.entries(GEO)) {
        geoByCountry[cc].impressions += Math.round(dImpr * w);
        geoByCountry[cc].clicks += Math.round(dClicks * w);
        geoByCountry[cc].conversions += Math.round(dConv * w);
        geoByCountry[cc].conversion_value = round2(geoByCountry[cc].conversion_value + dVal * w);
        geoByCountry[cc].amount_spent = round2(geoByCountry[cc].amount_spent + daySpend * w);
      }
    }
    spend = round2(spend); convValue = round2(convValue);
    list.push({
      id: `cmp_${BRAND_ID}_${i}`,
      data: {
        id: `cmp_${BRAND_ID}_${i}`,
        name: def.name,
        channel: def.channel,
        period: ym(NOW),
        start_date: ymd(NOW - days * DAY),
        end_date: ymd(NOW),
        status: 'active',
        is_active: true,
        budget: def.budget * CAMPAIGN_SCALE,
        amount_spent: spend,
        impressions, clicks,
        ctr: round2((clicks / impressions) * 100),
        cpc: round2(spend / clicks),
        cpm: round2((spend / impressions) * 1000),
        conversions,
        conversion_value: convValue,
        purchase_conversions: conversions,
        purchase_conversion_value: convValue,
        roas: round2(convValue / spend),
        cost_per_conversion: round2(spend / Math.max(1, conversions)),
        conversion_rate: round2((conversions / clicks) * 100),
        currency_code: 'EUR',
        bid_strategy_type: def.channel === 'Google Ads' ? 'MAXIMIZE_CONVERSION_VALUE' : undefined,
        result_type: def.channel === 'Meta' ? 'Purchases' : undefined,
        brandId: BRAND_ID,
        source: 'seed_demo',
        createdAt: isoDay(0),
        importedAt: isoDay(0),
        dailyMetrics,
        geo: { byCountry: geoByCountry },
      },
    });
  }
  return list;
}

function buildChannelRecommendation() {
  return {
    primary: ['Google Shopping', 'Meta Ads (Facebook/Instagram)', 'Dynamic Remarketing'],
    secondary: ['Email Marketing', 'Google Search Ads'],
    budget_allocation: { google_shopping: 35, meta: 30, remarketing: 20, google_search: 15 },
    rationale: 'Πελάτες: Έμφαση σε Champions & Loyal για μεγιστοποίηση margin. || Κανάλια: Shopping + Meta για high-intent conversion, Remarketing για κλείσιμο κύκλου, Email για cross-sell χωρίς ad spend. || Αποτέλεσμα: Αύξηση AOV & True ROAS με επένδυση στα πιο κερδοφόρα segments.',
    targetSegments: [
      { name: 'Champions', fit: 'ideal', rationale: 'Υψηλότερο margin & συχνότητα — ιδανικοί για bundles υψηλής αξίας.' },
      { name: 'Loyal Customers', fit: 'ideal', rationale: 'Σταθερές αγορές — category expansion & cross-sell.' },
      { name: 'Potential Loyalist', fit: 'good', rationale: 'Conversion σε τακτικούς με στοχευμένες προσφορές.' },
    ],
    channelPlaybook: [
      { segment: 'Champions', channel: 'Google Shopping', message: 'VIP early access σε νέες σειρές Running.', marketingBrief: 'tROAS bidding, audience: purchasers 180d, priority high-margin SKUs.', priority: 'primary', budgetSharePct: 40 },
      { segment: 'Loyal Customers', channel: 'Email Marketing', message: 'Personalized cross-sell βάσει κατηγορίας.', marketingBrief: 'Flow: post-purchase 14d, dynamic product blocks ανά category affinity.', priority: 'primary', budgetSharePct: 35 },
      { segment: 'Potential Loyalist', channel: 'Meta Ads', message: 'Social proof + first-repeat incentive.', marketingBrief: 'Lookalike 1% off purchasers, DPA retarget viewers 30d.', priority: 'secondary', budgetSharePct: 25 },
    ],
  };
}

// ── Assemble all writes ─────────────────────────────────────────────────────────
async function seed() {
  // Resolve super-admin uid
  let uid;
  try {
    uid = (await auth.getUserByEmail(adminEmail)).uid;
  } catch {
    console.error(`User not found in Auth: ${adminEmail}. Log into the app once, then re-run.`);
    process.exit(1);
  }
  console.log(`Owner uid: ${uid}`);

  // Cleanup legacy Shopify data from earlier seed runs (demo now uses Magento as the single source).
  await deleteBrandDocs('shopify_orders');
  await deleteBrandDocs('shopify_products');

  const nowIso = isoDay(0);

  // Brand
  queue(db.doc(`brands/${BRAND_ID}`), {
    id: BRAND_ID,
    name: BRAND_NAME,
    type: 'B2C',
    plan: 'growth',
    revenueSourceMode: 'eshop_all',
    createdAt: nowIso,
    createdBy: uid,
    enterpriseTurnoverEUR: null,
  });
  // Membership + user access
  queue(db.doc(`brands/${BRAND_ID}/members/${uid}`), {
    id: uid, userId: uid, uid, email: adminEmail, displayName: 'Demo Owner',
    role: 'owner', department: 'management', departmentLabel: 'Διοίκηση', joinedAt: nowIso,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const userSnap = await db.doc(`users/${uid}`).get();
  const brandIds = new Set(userSnap.exists ? userSnap.data()?.brandIds ?? [] : []);
  brandIds.add(BRAND_ID);
  queue(db.doc(`users/${uid}`), {
    email: adminEmail, brandIds: [...brandIds],
    defaultBrandId: userSnap.data()?.defaultBrandId || BRAND_ID,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Connectors (drive aggregator + connected UI states)
  queue(db.doc(`connectors/${BRAND_ID}`), {
    shopify: FieldValue.delete(),
    magento: { connected: true, baseUrl: 'https://sportflow.example', storeId: 1, connectedAt: nowIso },
    ga4: { connected: true, propertyId: '480123456', connectedAt: nowIso },
    google_ads: { connected: true, customerId: '123-456-7890', connectedAt: nowIso },
    meta: { connected: true, adAccountId: 'act_1234567890', connectedAt: nowIso },
    merchant: { connected: true, merchantId: '5551234', connectedAt: nowIso },
    search_console: { connected: true, siteUrl: 'https://sportflow.example/', connectedAt: nowIso },
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Suppliers
  for (const s of SUPPLIERS) queue(db.doc(`suppliers/${BRAND_ID}_${s.id}`), { ...s, brandId: BRAND_ID });

  // Products (ERP) + shopify_products mirror (for platform stock reads)
  for (const p of products) {
    const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
    queue(db.doc(`products/${BRAND_ID}_${p.sku}`), clean);
    queue(db.doc(`magento_products/${BRAND_ID}_${p.sku}`), {
      sku: p.sku,
      name: p.name,
      title: p.name,
      category: p.category,
      subcategory: p.subcategory,
      brand: p.brand,
      manufacturer: p.brand,
      price: p.price,
      stockQuantity: p.stock_level,
      stock_on_hand: p.stock_level,
      qty_sold_period: p.qty_sold_period,
      status: p.status,
      brandId: BRAND_ID,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // Orders
  for (const o of orders) queue(db.doc(`magento_orders/${o.id}`), o.data);

  // Segments
  for (const s of SEGMENT_DEFS) {
    const segCount = s.count * CUSTOMER_SCALE;
    queue(db.doc(`segments/${BRAND_ID}_${s.id}`), {
      id: s.id, name: s.name, rfm_score: s.rfm_score, count: segCount, percentage: s.percentage,
      revenue_share: s.revenue_share, color: s.color, icon: s.icon, description: s.description,
      behavioral: {
        preferred_channels: CHANNELS.slice(0, 3),
        purchase_frequency: s.name === 'Champions' ? 'monthly' : s.name === 'Hibernating' ? 'rare' : 'quarterly',
        avg_basket_size: round2(2 + rand() * 2),
        peak_hours: ['19:00-22:00'], peak_days: ['Σάββατο', 'Κυριακή'],
        payment_method: 'Κάρτα', device_preference: 'mobile',
        category_affinity: categories.slice(0, 3).map((c) => ({ name: c, affinity: randInt(40, 95), avg_order: randInt(45, 120) })),
        upsell_score: randInt(40, 90), cross_sell_score: randInt(40, 90),
        price_sensitivity: s.name === 'Hibernating' ? 'high' : 'medium',
        engagement_score: 100 - s.churn, persona: s.persona,
        lifecycle_stage: s.name === 'Champions' ? 'loyal' : s.name === 'New Customers' ? 'new' : s.name === 'Hibernating' ? 'dormant' : s.name === 'At Risk' ? 'declining' : 'active',
        communication_preferences: [{ channel: 'Email', frequency: 'weekly', best_time: '19:00' }],
      },
      predictive: {
        estimated_ltv: s.ltv, ltv_confidence: 0.78, churn_risk: s.churn / 100,
        churn_risk_label: s.churn > 70 ? 'high' : s.churn > 40 ? 'medium' : 'low',
        next_purchase_probability: round2((100 - s.churn) / 100), days_to_next_purchase: randInt(10, 90),
        predicted_next_order_value: round2(s.ltv / 6), revenue_forecast_30d: round2(s.ltv * segCount * 0.08),
        revenue_forecast_90d: round2(s.ltv * segCount * 0.2),
        demand_trend: s.name === 'Champions' || s.name === 'Potential Loyalist' ? 'growing' : s.name === 'Hibernating' || s.name === 'At Risk' ? 'declining' : 'stable',
        retention_score: 100 - s.churn,
      },
      brandId: BRAND_ID,
    });
  }

  // Campaigns + organic
  for (const c of buildCampaigns()) queue(db.doc(`campaigns/${c.id}`), c.data);
  for (let m = 11; m >= 0; m--) {
    const ts = NOW - m * 30 * DAY;
    const monthKey = ym(ts);
    queue(db.doc(`organic/${BRAND_ID}_${monthKey}`), {
      id: `${BRAND_ID}_${monthKey}`, period: monthKey,
      organic_revenue: round2(38000 * seasonalFactor(ts) * (0.85 + rand() * 0.3)),
      brandId: BRAND_ID, source: 'seed_demo', createdAt: new Date(ts).toISOString(),
    });
  }

  // GA4 (main doc + dailyTraffic chunk as json string)
  const ga4 = buildGA4();
  const { dailyTrafficByChannel, ...ga4Main } = ga4;
  queue(db.doc(`ga4_data/${BRAND_ID}`), ga4Main);
  queue(db.doc(`ga4_data/${BRAND_ID}/chunks/dailyTraffic`), { json: JSON.stringify(dailyTrafficByChannel), updatedAt: FieldValue.serverTimestamp() });
  // Search Console
  const gscRows = [];
  for (const q of ['sportflow', 'παπουτσια running', 'αθλητικα παπουτσια', 'μπαλα ποδοσφαιρου', 'βαρακια γυμναστικης', 'μαγιο κολυμβησης', 'ρακετα τενις', 'πρωτεινη whey']) {
    gscRows.push({ date: ymd(NOW - randInt(1, 28) * DAY), query: q, clicks: randInt(20, 480), impressions: randInt(800, 18000), ctr: round2(0.02 + rand() * 0.08), position: round2(1.5 + rand() * 12) });
  }
  queue(db.doc(`search_console_data/${BRAND_ID}`), {
    siteUrl: 'https://sportflow.example/', siteName: 'SportFlow', queryRows: gscRows,
    syncedAt: FieldValue.serverTimestamp(), dateRange: { start: ymd(NOW - 28 * DAY), end: ymd(NOW) },
  });

  // Active strategy
  queue(db.doc(`active_strategies/strategy_${BRAND_ID}`), {
    id: `strategy_${BRAND_ID}`, brandId: BRAND_ID, scenarioId: 'profit_max',
    weights: { profit: 40, stock: 15, strategic: 15, revenue: 10, fit: 20 },
    duration: 'ongoing', approvalStatus: 'implementing', approvedAt: nowIso, approvedBy: uid, implementedAt: nowIso,
    monthlyBudget: 12000,
    marketingCostLines: [
      { id: 'mc_agency', label: 'Agency retainer', kind: 'fixed_monthly', amountEUR: 1500 },
      { id: 'mc_tools', label: 'Martech tools', kind: 'fixed_monthly', amountEUR: 350 },
      { id: 'mc_fee', label: 'Management fee', kind: 'percent_of_budget', percent: 8 },
    ],
    costCategories: [
      { id: 'cc_fixed', name: 'Σταθερά κόστη', lines: [{ id: 'l_rent', label: 'Ενοίκιο αποθήκης', amountEUR: 2200 }, { id: 'l_payroll', label: 'Μισθοδοσία', amountEUR: 9800 }] },
      { id: 'cc_logistics', name: 'Logistics', lines: [{ id: 'l_ship', label: 'Μεταφορικά', amountEUR: 3100 }, { id: 'l_pack', label: 'Συσκευασία', amountEUR: 640 }] },
    ],
    channelRecommendation: buildChannelRecommendation(),
    activationRecommendation: buildChannelRecommendation(),
    createdAt: nowIso, updatedAt: nowIso,
  });

  // Content calendar
  const CONTENT = [
    { week: 1, topic: 'Οδηγός επιλογής παπουτσιών Running', formats: ['Blog', 'Instagram Reel'], target_segments: ['Potential Loyalist', 'New Customers'], products_featured: ['RUN-1000'], status: 'published', performance: { views: 8400, engagement: '4.2%', conversions: 62 } },
    { week: 2, topic: 'Black Friday Teaser — Fitness', formats: ['Email', 'Meta Ad'], target_segments: ['Champions', 'Loyal Customers'], products_featured: ['FIT-1015'], status: 'scheduled' },
    { week: 3, topic: 'Win-back: Σε χάσαμε;', formats: ['Email', 'SMS'], target_segments: ['Hibernating', 'At Risk'], products_featured: [], status: 'in_production' },
    { week: 4, topic: 'Χριστουγεννιάτικος Οδηγός Δώρων', formats: ['Blog', 'Newsletter', 'Meta Ad'], target_segments: ['New Customers', 'Potential Loyalist'], products_featured: [], status: 'draft' },
  ];
  for (const c of CONTENT) queue(db.doc(`content/${BRAND_ID}_w${c.week}`), { ...c, brandId: BRAND_ID, createdAt: nowIso });

  // Coordination: decisions + tasks
  const DECISIONS = [
    { id: 'dec_bf', title: 'Έγκριση Black Friday προσφορών', description: 'Έκπτωση 25% σε excess/dead stock Running & Fitness για εκκαθάριση Q4.', category: 'promotion', priority: 'high', status: 'active', targetDepartments: ['marketing', 'commercial'] },
    { id: 'dec_price', title: 'Αναπροσαρμογή τιμών below-market SKUs', description: 'Αύξηση τιμής σε SKUs >15% κάτω από benchmark αγοράς (GMC).', category: 'pricing', priority: 'medium', status: 'proposal', targetDepartments: ['commercial'] },
    { id: 'dec_winback', title: 'Καμπάνια win-back Hibernating', description: 'Email + SMS flow με incentive για 23 ανενεργούς πελάτες.', category: 'marketing', priority: 'medium', status: 'draft', targetDepartments: ['marketing'] },
  ];
  for (const d of DECISIONS) {
    queue(db.doc(`decisions/${BRAND_ID}_${d.id}`), {
      ...d, id: `${BRAND_ID}_${d.id}`, brandId: BRAND_ID, createdBy: uid, createdByName: 'Demo Owner',
      createdAt: isoDay(randInt(2, 20)), updatedAt: isoDay(randInt(0, 2)), commentCount: randInt(0, 4), taskCount: randInt(1, 3),
    });
  }
  const TASKS = [
    { id: 'tsk_creative', title: 'Δημιουργικά Black Friday', status: 'in_progress', priority: 'high', dept: 'marketing', dec: 'dec_bf' },
    { id: 'tsk_pricing', title: 'Λίστα SKUs προς αναπροσαρμογή', status: 'pending', priority: 'medium', dept: 'commercial', dec: 'dec_price' },
    { id: 'tsk_flow', title: 'Στήσιμο win-back flow', status: 'pending', priority: 'medium', dept: 'marketing', dec: 'dec_winback' },
    { id: 'tsk_stock', title: 'Επιβεβαίωση αποθέματος για προσφορές', status: 'done', priority: 'high', dept: 'commercial', dec: 'dec_bf' },
  ];
  for (const t of TASKS) {
    queue(db.doc(`tasks/${BRAND_ID}_${t.id}`), {
      id: `${BRAND_ID}_${t.id}`, brandId: BRAND_ID, title: t.title, status: t.status, priority: t.priority,
      assignedTo: uid, assignedToName: 'Demo Owner', assignedDepartment: t.dept,
      linkedDecisionId: `${BRAND_ID}_${t.dec}`, dueDate: isoDay(-randInt(2, 14)),
      createdBy: uid, createdByName: 'Demo Owner', createdAt: isoDay(randInt(1, 15)), updatedAt: isoDay(randInt(0, 1)), commentCount: 0,
    });
  }

  // Automation: enable a few growth triggers + sample alerts
  const ENABLED = {
    dead_stock_alert: 15, excess_stock_alert: 10000, low_stock_critical: 5,
    campaign_high_roas: 4, campaign_underperform: 1, segment_churn_risk: 20,
    organic_traffic_spike: 20, price_above_benchmark: 10,
  };
  const triggers = {};
  for (const [id, threshold] of Object.entries(ENABLED)) {
    triggers[id] = { enabled: true, threshold, checkIntervalDays: 7, autoBriefing: id === 'dead_stock_alert', lastCheckedAt: isoDay(1) };
  }
  queue(db.doc(`automation_settings/${BRAND_ID}`), { triggers, updatedAt: nowIso });
  const ALERTS = [
    { id: 'al_dead', triggerId: 'dead_stock_alert', triggerLabel: 'Dead stock', triggerGroup: 'inventory', severity: 'warning', title: 'Dead stock 18% — πάνω από κατώφλι 15%', description: 'Εντοπίστηκαν SKUs χωρίς πωλήσεις >70 ημέρες. Προτείνεται εκκαθάριση.', suggestions: ['Έκπτωση 25% σε dead stock', 'Bundle με best sellers', 'Στόχευση Champions με VIP offer'], status: 'new' },
    { id: 'al_roas', triggerId: 'campaign_high_roas', triggerLabel: 'Υψηλή απόδοση campaign', triggerGroup: 'campaigns', severity: 'info', title: 'Retargeting — Cart Abandoners: ROAS 6.8x', description: 'Καμπάνια ξεπέρασε το κατώφλι ROAS 4x. Σκεφτείτε αύξηση budget.', suggestions: ['Αύξηση budget +30%', 'Επέκταση audience'], status: 'acknowledged' },
    { id: 'al_churn', triggerId: 'segment_churn_risk', triggerLabel: 'Αύξηση churn risk', triggerGroup: 'customers', severity: 'critical', title: 'At Risk segment στο 20%', description: '28 πελάτες υψηλής αξίας κινδυνεύουν με churn.', suggestions: ['Win-back email flow', 'Προσωποποιημένο incentive'], status: 'new' },
  ];
  for (const a of ALERTS) {
    queue(db.doc(`automation_alerts/${BRAND_ID}_${a.id}`), { ...a, id: `${BRAND_ID}_${a.id}`, brandId: BRAND_ID, data: {}, createdAt: isoDay(randInt(0, 4)) });
  }

  // Competitive: settings + ads + price benchmarks + price insights
  queue(db.doc(`competitor_settings/${BRAND_ID}`), {
    competitors: [
      { pageId: '111111111111111', name: 'RunZone GR', platform: 'meta' },
      { pageId: '222222222222222', name: 'FitMarket', platform: 'meta' },
      { pageId: '333333333333333', name: 'SportArena', platform: 'meta' },
    ],
    reachedCountries: ['GR', 'CY'],
    lastSyncAt: isoDay(1),
  });
  const COMPETITORS = [['RunZone GR', '111111111111111'], ['FitMarket', '222222222222222'], ['SportArena', '333333333333333']];
  const AD_TEXTS = ['Νέα σειρά running — έως -30%', 'Black Friday Fitness deals', 'Δωρεάν μεταφορικά άνω των 40€', 'Νέα παραλαβή ποδοσφαίρου', '2+1 σε αξεσουάρ γυμναστικής', 'Χειμερινή συλλογή outdoor'];
  for (let i = 0; i < 14; i++) {
    const [cn, pid] = pick(COMPETITORS);
    const start = randInt(2, 40);
    const adId = `ad_${1000 + i}`;
    queue(db.doc(`competitor_ads/${BRAND_ID}/ads/${adId}`), {
      adId, competitorName: cn, competitorPageId: pid, adText: pick(AD_TEXTS),
      startDate: ymd(NOW - start * DAY), platforms: ['facebook', 'instagram'],
      isActive: chance(0.7), daysRunning: start, firstSeenAt: isoDay(start), lastSeenAt: isoDay(randInt(0, 2)),
    });
  }
  // Price benchmarks for ~half the catalog (GMC)
  for (const p of products) {
    if (!chance(0.55)) continue;
    const benchmark = round2(p.price * (0.85 + rand() * 0.35));
    queue(db.doc(`price_benchmarks/${BRAND_ID}/skus/${p.sku}`), {
      productId: p.sku, title: p.name, brand: p.brand, gtin: p.gtin,
      yourPrice: p.price, benchmarkPrice: benchmark, priceDiff: round2(((p.price - benchmark) / benchmark) * 100),
      currency: 'EUR', country: 'GR', updatedAt: isoDay(randInt(0, 3)),
    });
  }
  const insightItems = products.filter(() => chance(0.25)).slice(0, 12).map((p) => {
    const suggested = round2(p.price * (0.9 + rand() * 0.08));
    return { productId: p.sku, title: p.name, brand: p.brand, currentPrice: p.price, suggestedPrice: suggested, priceDiffPercent: round2(((suggested - p.price) / p.price) * 100), predictedImpressions: randInt(2000, 18000), predictedClicks: randInt(80, 900), country: 'GR', currency: 'EUR' };
  });
  queue(db.doc(`price_insights/${BRAND_ID}`), { items: insightItems, updatedAt: isoDay(1), country: 'GR' });

  // Import jobs (sync history for ConnectorsPanel / E-commerce)
  const JOBS = [
    { type: 'magento_orders', source: 'magento', imported: orders.length },
    { type: 'ga4_data', source: 'ga4', imported: GA4_DAYS },
    { type: 'campaigns', source: 'google_ads', imported: 4 },
    { type: 'campaigns', source: 'meta', imported: 3 },
    { type: 'price_benchmarks', source: 'merchant_center', imported: 28 },
  ];
  for (let i = 0; i < JOBS.length; i++) {
    queue(db.collection('import_jobs').doc(`${BRAND_ID}_seed_${i}`), {
      brandId: BRAND_ID, ...JOBS[i], status: 'completed',
      startedAt: isoDay(1), completedAt: isoDay(1), createdAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`Flushing ${pending.length} documents…`);
  await flush();
  console.log('✓ Raw data written.');
  return uid;
}

// ── Trigger production aggregators ──────────────────────────────────────────────
async function refreshAggregations(uid) {
  if (!doRefresh) { console.log('Skipping refresh (--no-refresh).'); return; }
  if (!webApiKey) {
    console.log('\n⚠ No Web API key (--apiKey / VITE_FIREBASE_API_KEY). Skipping auto-refresh.');
    console.log('  Aggregations (e-commerce summary, product intelligence, RFM) will build on next');
    console.log('  scheduled sync, OR open the app as super-admin and hit "Refresh" on the pages.');
    return;
  }
  console.log('\nTriggering production aggregators…');
  const customToken = await auth.createCustomToken(uid);
  const exch = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webApiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!exch.ok) { console.error('Token exchange failed:', await exch.text()); return; }
  const { idToken } = await exch.json();

  const base = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;
  const call = async (fn, body) => {
    try {
      const res = await fetch(`${base}/${fn}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      console.log(`  ${fn}: ${res.status} ${text.slice(0, 120)}`);
    } catch (e) { console.warn(`  ${fn} failed:`, e.message); }
  };
  await call('refreshAggregates', { brandId: BRAND_ID });
  await call('refreshProductIntelligence', { brandId: BRAND_ID });
  await call('refreshDataAnalysisRfm', { brandId: BRAND_ID, action: 'run' });
  console.log('✓ Aggregation refresh requested.');
}

(async () => {
  console.log(`\n=== Seeding demo brand "${BRAND_NAME}" (${BRAND_ID}) — growth / B2C ===\n`);
  const uid = await seed();
  await refreshAggregations(uid);
  console.log('\n✅ Done. Open the app, switch to the SportFlow brand, and present.\n');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
