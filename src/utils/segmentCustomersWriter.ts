/** A brand can carry `segment_customers` rows from more than one RFM writer at once — the server
 * Data Analysis aggregator (`source: 'data_analysis_rfm'`) and the Megaventory ERP writer
 * (`source: 'megaventory_rfm'`), or a manual import (no `source` field) — all keyed by the same
 * segment ids. The aggregator deliberately stamps its rows so the two can coexist; the customer
 * exports then have to pick the writer that produced the segments the page is showing, otherwise
 * «Champions» exports the union of two universes: 2.074 e-shop customers plus 9.750 ERP accounts. */

export type SegmentCustomersWriter = 'data_analysis_rfm' | 'imported';

export const DATA_ANALYSIS_SEGMENT_CUSTOMERS_SOURCE = 'data_analysis_rfm';

/** Which writer produced the segments a page displays, from `useSegments().dataSource`.
 * `'ecommerce'` is the server aggregate (or a client-side RFM whose segments carry their own
 * customers and never reach Firestore); `'import'` is the imported `segments` collection, whose
 * customers come from the ERP writer or a manual import. Anything else has no segments to export. */
export function segmentCustomersWriterFor(dataSource: string | null | undefined): SegmentCustomersWriter | null {
  if (dataSource === 'ecommerce') return 'data_analysis_rfm';
  if (dataSource === 'import') return 'imported';
  return null;
}

/** Whether a `segment_customers` document belongs to the given writer. A manual import writes no
 * `source` at all, so "imported" means "anything the aggregator did not write". */
export function isSegmentCustomersDocFrom(writer: SegmentCustomersWriter, doc: { source?: string | null }): boolean {
  const source = doc.source ?? null;
  return writer === 'data_analysis_rfm'
    ? source === DATA_ANALYSIS_SEGMENT_CUSTOMERS_SOURCE
    : source !== DATA_ANALYSIS_SEGMENT_CUSTOMERS_SOURCE;
}
