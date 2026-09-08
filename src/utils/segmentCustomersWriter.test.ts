/** The customer export took every `segment_customers` row for a segment id, whichever writer had
 * produced it. For e-tennis that meant 35K rows for five segments whose cards summed to 6.9K:
 * the e-shop analysis and the ERP RFM both write «champions». These lock the writer rule. */
import { describe, expect, it } from 'vitest';
import { isSegmentCustomersDocFrom, segmentCustomersWriterFor } from './segmentCustomersWriter';

const analysisDoc = { source: 'data_analysis_rfm' };
const erpDoc = { source: 'megaventory_rfm' };
const manualDoc = {}; // the manual import writes no source field
const nullDoc = { source: null };

describe('segmentCustomersWriterFor', () => {
  it('server aggregate segments read the aggregator rows', () => {
    expect(segmentCustomersWriterFor('ecommerce')).toBe('data_analysis_rfm');
  });

  it('imported segments read the ERP / manual rows', () => {
    expect(segmentCustomersWriterFor('import')).toBe('imported');
  });

  it('no segments, no writer', () => {
    expect(segmentCustomersWriterFor('none')).toBeNull();
    expect(segmentCustomersWriterFor(null)).toBeNull();
    expect(segmentCustomersWriterFor(undefined)).toBeNull();
  });
});

describe('isSegmentCustomersDocFrom', () => {
  it('the analysis export never contains an ERP account', () => {
    expect(isSegmentCustomersDocFrom('data_analysis_rfm', analysisDoc)).toBe(true);
    expect(isSegmentCustomersDocFrom('data_analysis_rfm', erpDoc)).toBe(false);
    expect(isSegmentCustomersDocFrom('data_analysis_rfm', manualDoc)).toBe(false);
    expect(isSegmentCustomersDocFrom('data_analysis_rfm', nullDoc)).toBe(false);
  });

  it('the imported export keeps ERP and manual rows and drops the analysis', () => {
    expect(isSegmentCustomersDocFrom('imported', erpDoc)).toBe(true);
    expect(isSegmentCustomersDocFrom('imported', manualDoc)).toBe(true);
    expect(isSegmentCustomersDocFrom('imported', nullDoc)).toBe(true);
    expect(isSegmentCustomersDocFrom('imported', analysisDoc)).toBe(false);
  });
});
