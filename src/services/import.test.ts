/**
 * Unit tests for the product-feed import pipeline in `import.ts`, focused on the
 * XML FEED PARSERS and ROUTING — the part that turns a vendor's raw feed file
 * into validated `Product` rows.
 *
 * What is under test here (and why it matters):
 *  - The exported seam `previewFileForProducts(file, feedSourceType)` is the only
 *    public entry that drives the (module-private) Skroutz / Google XML parsers,
 *    the feed→app column mapper, and product validation. We assert on its
 *    observable output (validCount, mappedSample) rather than on private helpers.
 *  - ROUTING: a `.xml` file must be handed to the XML parser, NOT shredded by the
 *    CSV parser (the real regression fixed in commit baaab06 — "no more shredded
 *    feeds"). With `feedSourceType === 'skroutz'` the Skroutz `<product>` parser
 *    must win; otherwise the generic Google/Atom `<entry>` parser is used.
 *  - PRICE_WITH_VAT alias: the real-world "mousoulis" feed publishes a
 *    `<price_with_vat>` tag EXCLUSIVELY (no plain `<price>`). A product must still
 *    end up with a non-zero price — the Skroutz parser lists `price_with_vat`
 *    among the aliases that feed the `price` field.
 *
 * Environment note: these run under the Node Vitest config (no DOM). The two
 * production parsers call the browser `DOMParser` API, so we install a small,
 * faithful `DOMParser` polyfill (backed by `fast-xml-parser`, already a repo dep)
 * that implements ONLY the DOM surface the parsers use: getElementsByTagName,
 * getElementsByTagNameNS, `.children`, `.tagName`, `.textContent`, and a
 * `querySelector('parsererror')` that surfaces malformed XML. The PARSER LOGIC
 * being exercised is the production code's; the polyfill is just the DOM
 * substrate a browser would otherwise supply.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { previewFileForProducts, isCustomerLevelData, parseCSV, detectDelimiter, isHeaderlessStatSheet, validateProduct } from './import';
import { makeProduct } from '../test/helpers';

// ── Minimal DOMParser polyfill (DOM surface used by the two XML parsers) ──────

interface PNode {
  /** Qualified tag name as written, e.g. `g:id`, `title`, `price_with_vat`. */
  tagName: string;
  /** Resolved namespace URI for this element (inherited via xmlns:* decls). */
  namespaceURI: string | null;
  /** Local name (qualified name with any prefix stripped). */
  localName: string;
  children: PNode[];
  textContent: string;
  getElementsByTagName(name: string): PNode[];
  getElementsByTagNameNS(ns: string, local: string): PNode[];
}

const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** Collect a node's text, descending into CDATA (`__cdata`) and child text. */
function collectText(raw: Record<string, unknown>[]): string {
  let out = '';
  for (const part of raw) {
    if ('#text' in part) {
      out += String((part as { '#text': unknown })['#text'] ?? '');
    } else if ('__cdata' in part) {
      out += collectText((part as { __cdata: Record<string, unknown>[] }).__cdata);
    }
  }
  return out;
}

function buildNode(
  tagName: string,
  childArray: Record<string, unknown>[],
  attrs: Record<string, string>,
  inheritedNs: Map<string, string>,
): PNode {
  // Extend the prefix→namespace map with this element's own xmlns:* decls.
  const nsMap = new Map(inheritedNs);
  let defaultNs = inheritedNs.get('') ?? '';
  for (const [k, v] of Object.entries(attrs)) {
    if (k === '@_xmlns') defaultNs = v;
    else if (k.startsWith('@_xmlns:')) nsMap.set(k.slice('@_xmlns:'.length), v);
  }
  nsMap.set('', defaultNs);

  const prefix = tagName.includes(':') ? tagName.slice(0, tagName.indexOf(':')) : '';
  const localName = tagName.replace(/^.*:/, '');
  const namespaceURI = (prefix ? nsMap.get(prefix) : defaultNs) || null;

  const children: PNode[] = [];
  const textParts: Record<string, unknown>[] = [];

  for (const entry of childArray) {
    // Each entry is `{ tagName: [..children..], ':@': {attrs} }` OR a text/cdata node.
    const childAttrs = (entry[':@'] as Record<string, string> | undefined) ?? {};
    const tag = Object.keys(entry).find((k) => k !== ':@');
    if (!tag) continue;
    if (tag === '#text' || tag === '__cdata') {
      textParts.push(entry as Record<string, unknown>);
      continue;
    }
    const grandChildren = entry[tag] as Record<string, unknown>[];
    children.push(buildNode(tag, grandChildren, childAttrs, nsMap));
  }

  const node: PNode = {
    tagName,
    namespaceURI,
    localName,
    children,
    get textContent() {
      // Direct text plus all descendant text — matches DOM `.textContent`.
      let t = collectText(textParts);
      for (const c of children) t += c.textContent;
      return t;
    },
    getElementsByTagName(name: string): PNode[] {
      const acc: PNode[] = [];
      const walk = (n: PNode) => {
        for (const c of n.children) {
          if (name === '*' || c.tagName === name) acc.push(c);
          walk(c);
        }
      };
      walk(node);
      return acc;
    },
    getElementsByTagNameNS(ns: string, local: string): PNode[] {
      const acc: PNode[] = [];
      const walk = (n: PNode) => {
        for (const c of n.children) {
          if ((ns === '*' || c.namespaceURI === ns) && (local === '*' || c.localName === local)) {
            acc.push(c);
          }
          walk(c);
        }
      };
      walk(node);
      return acc;
    },
  };
  return node;
}

class PolyfillDocument {
  private root: PNode;
  private parseError: string | null;
  constructor(root: PNode, parseError: string | null) {
    this.root = root;
    this.parseError = parseError;
  }
  getElementsByTagName(name: string): PNode[] {
    if (this.root.tagName === name) return [this.root, ...this.root.getElementsByTagName(name)];
    return this.root.getElementsByTagName(name);
  }
  querySelector(sel: string): { textContent: string } | null {
    if (sel === 'parsererror' && this.parseError) return { textContent: this.parseError };
    return null;
  }
}

class PolyfillDOMParser {
  parseFromString(xml: string, _type: string): PolyfillDocument {
    void _type;
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      trimValues: true,
      cdataPropName: '__cdata',
      // Mirror entity decoding a browser DOMParser performs.
      processEntities: true,
      htmlEntities: false,
    });
    let tree: Record<string, unknown>[];
    try {
      tree = parser.parse(xml) as Record<string, unknown>[];
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // Surface a parser-error document so callers' `querySelector('parsererror')` fires.
      return new PolyfillDocument(buildNode('#document', [], {}, new Map()), err);
    }
    // Find the document element (first non-declaration entry).
    const docEl = tree.find((e) => {
      const tag = Object.keys(e).find((k) => k !== ':@' && k !== '?xml');
      return !!tag;
    });
    if (!docEl) {
      return new PolyfillDocument(buildNode('#document', [], {}, new Map()), 'no root element');
    }
    const tag = Object.keys(docEl).find((k) => k !== ':@' && k !== '?xml')!;
    const attrs = (docEl[':@'] as Record<string, string> | undefined) ?? {};
    const root = buildNode(tag, docEl[tag] as Record<string, unknown>[], attrs, new Map());
    return new PolyfillDocument(root, null);
  }
}

void XMLNS; // documented constant; not needed by the parsers under test

// ── Fixtures (shaped after the real skroutz-cartcatalyst / mousoulis exports) ─

/** Skroutz-style catalog: `<product>` nodes, plain `<price>` present. */
const SKROUTZ_FEED_XML = `<?xml version="1.0" encoding="utf-8"?>
<mywebstore>
  <created_at>2026-06-03 10:45:07</created_at>
  <products>
    <product>
      <sku>DJI-POCKET-3</sku>
      <name>DJI Pocket 3 Gimbal</name>
      <UniqueId>DJI-POCKET-3</UniqueId>
      <price>451.62</price>
      <availability>Διαθέσιμο από 4 έως 6 ημέρες</availability>
      <category>Action Camera</category>
      <manufacturer>DJI</manufacturer>
      <ean>6941565969873</ean>
      <link>https://example.gr/dji-pocket-3</link>
    </product>
    <product>
      <sku>SONY-A7</sku>
      <name>Sony A7 IV</name>
      <UniqueId>SONY-A7</UniqueId>
      <price>2199.00</price>
      <category>Cameras</category>
      <manufacturer>Sony</manufacturer>
    </product>
  </products>
</mywebstore>`;

/**
 * "mousoulis" real-world shape: `<product>` nodes that publish `price_with_vat`
 * EXCLUSIVELY — there is no plain `<price>` tag anywhere.
 */
const MOUSOULIS_FEED_XML = `<?xml version="1.0" encoding="utf-8"?>
<mousoulis>
  <created_at>2026-06-03 09:45:00 UTC</created_at>
  <products>
    <product>
      <name>Lacoste Polo Μπλούζα Πικέ L.13.12</name>
      <price_with_vat>84.00</price_with_vat>
      <vat>24.0</vat>
      <mpn>L1312-166</mpn>
      <ean>3570670000732</ean>
      <availability>Άμεσα Διαθέσιμο</availability>
      <manufacturer>Lacoste</manufacturer>
      <UniqueId>L1312-166</UniqueId>
      <quantity>5</quantity>
      <link><![CDATA[https://www.mousoulis.gr/p?wid=1&cid=EUR]]></link>
      <category><![CDATA[Clothing & Accessories > Clothing > Shirts]]></category>
    </product>
  </products>
</mousoulis>`;

/** Google Merchant / Atom feed: `<entry>` nodes with `g:`-namespaced fields. */
const GOOGLE_FEED_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">
  <title>Acme Store</title>
  <entry>
    <g:id>SKU-001</g:id>
    <title>Acme Widget</title>
    <g:price>24.00 EUR</g:price>
    <g:availability>in stock</g:availability>
    <g:brand>Acme</g:brand>
    <g:product_type>Widgets</g:product_type>
  </entry>
  <entry>
    <g:id>SKU-002</g:id>
    <title>Acme Gadget</title>
    <g:price>49.90 EUR</g:price>
    <g:availability>out of stock</g:availability>
  </entry>
</feed>`;

function xmlFile(content: string, name = 'feed.xml'): File {
  return new File([content], name, { type: 'text/xml' });
}

describe('import.ts — product feed parsing & routing (previewFileForProducts)', () => {
  beforeEach(() => {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = PolyfillDOMParser;
  });
  afterEach(() => {
    delete (globalThis as unknown as { DOMParser?: unknown }).DOMParser;
  });

  describe('Skroutz XML parser', () => {
    it('parses <product> entries into rows with name, price and sku', async () => {
      const result = await previewFileForProducts(xmlFile(SKROUTZ_FEED_XML), 'skroutz');

      // Both products are valid (each has a name + sku/unique_id).
      expect(result.totalRows).toBe(2);
      expect(result.validCount).toBe(2);
      expect(result.errorCount).toBe(0);

      // The RAW parsed row (what the Skroutz parser is responsible for) carries
      // the canonical identity fields straight off the <product> node.
      const raw = result.sampleRows[0];
      expect(raw.name).toBe('DJI Pocket 3 Gimbal');
      expect(raw.unique_id).toBe('DJI-POCKET-3'); // <sku>/<UniqueId> → unique_id
      expect(parseFloat(raw.price)).toBeCloseTo(451.62); // <price>

      // The MAPPED (feed→app) row still carries name + a non-empty sku + price.
      const mapped = result.mappedSample[0];
      expect(mapped.name).toBe('DJI Pocket 3 Gimbal');
      expect(mapped.sku).toBeTruthy();
      // price is mapped & currency-stripped to a parseable string.
      expect(parseFloat(mapped.price)).toBeCloseTo(451.62);
    });

    // PER-100: `ean → sku` is the last Skroutz alias, so with first-non-empty-wins
    // the canonical unique_id wins and EAN stays a fallback when unique_id is absent.
    it('prefers unique_id over ean for the mapped sku (PER-100)', async () => {
      const result = await previewFileForProducts(xmlFile(SKROUTZ_FEED_XML), 'skroutz');
      // Intended: the stable merchant id wins over the barcode.
      expect(result.mappedSample[0].sku).toBe('DJI-POCKET-3');
    });

    it('maps Skroutz availability text to a stock_level flag', async () => {
      // The Greek availability string does not contain "in stock", so the
      // feed→app mapper must resolve it to the out-of-stock flag ('0').
      const result = await previewFileForProducts(xmlFile(SKROUTZ_FEED_XML), 'skroutz');
      expect(result.mappedSample[0].stock_level).toBe('0');
    });

    it('uses the Skroutz <product> parser (not the Google <entry> parser) for this feed', async () => {
      // A Skroutz feed has zero <entry> nodes; if it were misrouted to the
      // Google parser it would yield 0 rows. Getting 2 rows proves Skroutz won.
      const result = await previewFileForProducts(xmlFile(SKROUTZ_FEED_XML), 'skroutz');
      expect(result.totalRows).toBe(2);
    });
  });

  describe('price_with_vat alias (real-world "mousoulis" feed)', () => {
    it('honors <price_with_vat> when a plain <price> tag is absent', async () => {
      const result = await previewFileForProducts(xmlFile(MOUSOULIS_FEED_XML), 'skroutz');

      expect(result.totalRows).toBe(1);
      expect(result.validCount).toBe(1);

      const row = result.mappedSample[0];
      // The product still gets a real, non-zero price sourced from price_with_vat.
      expect(parseFloat(row.price)).toBeCloseTo(84.0);
      expect(parseFloat(row.price)).toBeGreaterThan(0);
    });

    it('still resolves name and a unique_id for a price_with_vat-only product', async () => {
      const result = await previewFileForProducts(xmlFile(MOUSOULIS_FEED_XML), 'skroutz');
      // The parser resolves unique_id from <UniqueId>/<mpn> on the raw row.
      const raw = result.sampleRows[0];
      expect(raw.name).toBe('Lacoste Polo Μπλούζα Πικέ L.13.12');
      expect(raw.unique_id).toBe('L1312-166');
      // The mapped row still has a non-empty sku and the same name.
      const mapped = result.mappedSample[0];
      expect(mapped.name).toBe('Lacoste Polo Μπλούζα Πικέ L.13.12');
      expect(mapped.sku).toBeTruthy();
    });
  });

  describe('Google / generic XML parser', () => {
    it('parses g:-namespaced <entry> fields into name/sku/price', async () => {
      // No explicit feedSourceType → defaults to the Google/Merchant parser.
      const result = await previewFileForProducts(xmlFile(GOOGLE_FEED_XML));

      expect(result.totalRows).toBe(2);
      expect(result.validCount).toBe(2);

      const first = result.mappedSample[0];
      expect(first.name).toBe('Acme Widget');
      expect(first.sku).toBe('SKU-001');
      expect(parseFloat(first.price)).toBeCloseTo(24.0);
    });

    it('maps Google availability "in stock"/"out of stock" to stock_level flags', async () => {
      const result = await previewFileForProducts(xmlFile(GOOGLE_FEED_XML));
      expect(result.mappedSample[0].stock_level).toBe('1'); // "in stock"
      expect(result.mappedSample[1].stock_level).toBe('0'); // "out of stock"
    });
  });

  describe('routing: XML content goes to the XML parser, not the CSV shredder', () => {
    it('does not shred a .xml feed into garbage CSV rows', async () => {
      // Regression guard (commit baaab06). If the .xml extension were ignored and
      // the file fell through to parseCSV/csvToObjects, the angle-bracket markup
      // would be split on commas/newlines into many bogus rows — never the exact
      // 2 clean products the XML parser yields.
      const result = await previewFileForProducts(xmlFile(SKROUTZ_FEED_XML), 'skroutz');

      expect(result.totalRows).toBe(2);
      // Headers come from the parsed product object keys, not from a CSV header
      // row of XML tag soup — so real field names are present.
      expect(result.headers).toContain('name');
      expect(result.headers).toContain('price');
      // None of the "headers" should look like raw XML markup.
      expect(result.headers.some((h) => h.includes('<') || h.includes('>'))).toBe(false);
    });

    it('Skroutz vs Google routing is selected by feedSourceType for the same file', async () => {
      // The SAME Atom feed parsed as 'skroutz' has no <product> nodes → 0 rows,
      // but parsed with the default Google parser yields its 2 <entry> products.
      // This isolates the parser-selection branch in getObjectsFromXmlFile.
      const asSkroutz = await previewFileForProducts(xmlFile(GOOGLE_FEED_XML), 'skroutz');
      const asGoogle = await previewFileForProducts(xmlFile(GOOGLE_FEED_XML));

      expect(asGoogle.totalRows).toBe(2);
      expect(asSkroutz.totalRows).toBe(0);
    });
  });

  describe('validation of parsed feed rows', () => {
    it('rejects a product entry that has neither sku nor name', async () => {
      const xml = `<?xml version="1.0"?>
        <mywebstore><products>
          <product><price>10.00</price><category>Misc</category></product>
        </products></mywebstore>`;
      const result = await previewFileForProducts(xmlFile(xml), 'skroutz');

      expect(result.totalRows).toBe(1);
      expect(result.validCount).toBe(0);
      expect(result.errorCount).toBe(1);
      expect(result.errors[0]).toMatch(/SKU\/ID and Name/i);
    });

    it('parser output supplies the identity fields the Product factory expects', async () => {
      // Sanity-tie to the shared factory: the parser supplies exactly the
      // identity fields (name/sku/price) the Product validator needs to build a
      // record like the canonical makeProduct() shape. We compare against the
      // RAW parsed row, whose unique_id is the parser's canonical merchant id.
      const expected = makeProduct({ name: 'DJI Pocket 3 Gimbal', sku: 'DJI-POCKET-3', price: 451.62 });
      const result = await previewFileForProducts(xmlFile(SKROUTZ_FEED_XML), 'skroutz');
      const raw = result.sampleRows[0];

      expect(raw.name).toBe(expected.name);
      expect(raw.unique_id).toBe(expected.sku);
      expect(parseFloat(raw.price)).toBeCloseTo(expected.price);
    });
  });

  describe('isCustomerLevelData segment-vs-customer classification', () => {
    // A segment-SUMMARY file: one row per segment, no per-customer identifier. Must NOT be
    // treated as customer-level — otherwise each row is counted as one customer and every
    // segment collapses to a flat 1/N split (e.g. 20% across 5 segments). Regression for the
    // fuzzy-pick false positives where `id`→`customer_id` and `purchase_frequency`→`frequency`.
    const segmentSummaryRow = (id: string, name: string, count: string, pct: string) => ({
      id, name, rfm_score: '555', count, percentage: pct, revenue_share: '28.0',
      color: '#10B981', description: 'top', icon: '⭐', persona: 'Power Buyer',
      lifecycle_stage: 'loyal', purchase_frequency: 'weekly', avg_basket_size: '180',
      engagement_score: '90', price_sensitivity: 'low', device_preference: 'desktop',
      preferred_channels: 'Email;Push', estimated_ltv: '2400', churn_risk: '8', demand_trend: 'growing',
    });

    it('classifies a segment-summary CSV (with id + purchase_frequency) as segment-level', () => {
      const rows = [
        segmentSummaryRow('qa-champions', 'QA Champions', '120', '4.5'),
        segmentSummaryRow('qa-loyal', 'QA Loyal Customers', '310', '11.7'),
        segmentSummaryRow('qa-potential', 'QA Potential Loyalists', '420', '15.8'),
        segmentSummaryRow('qa-at-risk', 'QA At Risk', '265', '10.0'),
        segmentSummaryRow('qa-hibernating', 'QA Hibernating', '540', '20.4'),
      ];
      expect(isCustomerLevelData(rows)).toBe(false);
    });

    it('still classifies a true per-customer CSV (customer_id + recency/frequency/monetary) as customer-level', () => {
      const rows = [
        { customer_id: 'C1', segment: 'Champions', recency: '5', frequency: '12', monetary: '900' },
        { customer_id: 'C2', segment: 'Champions', recency: '8', frequency: '9', monetary: '600' },
        { customer_id: 'C3', segment: 'At Risk', recency: '120', frequency: '2', monetary: '80' },
      ];
      expect(isCustomerLevelData(rows)).toBe(true);
    });
  });
});

describe('parseCSV — delimiter auto-detection (Real Peach corruption, PER-277)', () => {
  it('detects semicolon delimiter (Greek/EU Excel export)', () => {
    expect(detectDelimiter('sku;name;stock\n105417;Alfa Care;12')).toBe(';');
  });

  it('defaults to comma for a plain comma CSV', () => {
    expect(detectDelimiter('sku,name,stock\nA1,Widget,5')).toBe(',');
  });

  it('semicolon file with EU-decimal commas in fields parses into aligned columns', () => {
    // The exact failure mode: comma-split shredded these rows (sku became ",105417").
    const csv = 'sku;name;price;stock\n105417;Alfa Care AC 400;198,50;12';
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual(['sku', 'name', 'price', 'stock']);
    expect(rows[1]).toEqual(['105417', 'Alfa Care AC 400', '198,50', '12']);
  });

  it('comma still works and respects quoted commas', () => {
    const rows = parseCSV('sku,name,stock\nA1,"Widget, blue",5');
    expect(rows[1]).toEqual(['A1', 'Widget, blue', '5']);
  });

  it('tab-delimited file is detected', () => {
    const rows = parseCSV('sku\tname\tstock\nA1\tWidget\t5');
    expect(rows[1]).toEqual(['A1', 'Widget', '5']);
  });
});

/** PER-186: the statistics sheet is a headerless «δείκτης | τιμή» list. detectHeaderRow scored every
 *  row identically (one text cell each), so row 0 won on order alone and was eaten as the header —
 *  naming the value column "929" and losing that metric entirely. */
describe('isHeaderlessStatSheet', () => {
  it('detects the real safeblock statistics sheet (text | number from row 0)', () => {
    expect(isHeaderlessStatSheet([
      ['ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ', '929'],
      ['ΣΥΝΟΛΙΚΗ ΑΞΙΑ ΑΠΟΘΕΜΑΤΟΣ', '307159.53'],
    ])).toBe(true);
  });

  it('leaves a real header row alone (text | text)', () => {
    expect(isHeaderlessStatSheet([
      ['ΔΕΙΚΤΗΣ', 'ΤΙΜΗ'],
      ['ΣΥΝΟΛΙΚΗ ΑΞΙΑ ΑΠΟΘΕΜΑΤΟΣ', '307159.53'],
    ])).toBe(false);
  });

  it('accepts Greek decimal values', () => {
    expect(isHeaderlessStatSheet([['ΜΕΣΗ ΒΑΘΜΟΛΟΓΙΑ', '2,21']])).toBe(true);
  });

  it('is conservative about anything that is not a 2-cell pair', () => {
    expect(isHeaderlessStatSheet([['A', 'B', 'C']])).toBe(false);
    expect(isHeaderlessStatSheet([['A']])).toBe(false);
    expect(isHeaderlessStatSheet([[]])).toBe(false);
    expect(isHeaderlessStatSheet([])).toBe(false);
  });
});

describe('Greek stock header aliases', () => {
  // Headers reach validateProduct normalized (lowercase, spaces→underscores).
  const row = (h: Record<string, string>) => validateProduct(h, 0);

  it('maps "Υπόλοιπο Φαρμακείου" to stock_level', () => {
    const r = row({ sku: 'ABC1', name: 'Test Product', 'υπόλοιπο_φαρμακείου': '12', 'τιμή_πώλησης_με_φπα': '350' });
    expect(r.valid).toBe(true);
    expect(r.data?.stock_level).toBe(12);
    expect(r.data?.price).toBe(350);
  });

  it('still maps the previously supported Greek stock headers', () => {
    expect(row({ sku: 'ABC1', name: 'Test Product', 'διαθεσιμότητα': '7' }).data?.stock_level).toBe(7);
    expect(row({ sku: 'ABC2', name: 'Test Product', 'δυναμικό_υπόλοιπο': '9' }).data?.stock_level).toBe(9);
    expect(row({ sku: 'ABC3', name: 'Test Product', 'απόθεμα': '4' }).data?.stock_level).toBe(4);
  });
});
