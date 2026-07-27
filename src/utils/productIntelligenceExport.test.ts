import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { downloadProductIntelligenceCsv } from './productIntelligenceExport';
import type { Product } from '../types';

/**
 * End-to-end golden test for the SEC-M5 / PER-71 wiring: a real exporter must emit a
 * formula-leading product name apostrophe-prefixed, while numeric columns stay untouched.
 * The suite runs in a node environment, so the DOM bits the exporter touches are stubbed
 * and the produced CSV body is captured from the Blob.
 */
describe('downloadProductIntelligenceCsv — formula-injection neutralized (SEC-M5)', () => {
  let captured = '';

  beforeEach(() => {
    captured = '';
    class FakeBlob {
      content: string;
      constructor(parts: unknown[]) {
        this.content = parts.map((p) => String(p)).join('');
      }
      text() {
        return Promise.resolve(this.content);
      }
    }
    vi.stubGlobal('Blob', FakeBlob as unknown as typeof Blob);
    vi.stubGlobal('URL', {
      createObjectURL: (b: { content: string }) => {
        captured = b.content;
        return 'blob:x';
      },
      revokeObjectURL: () => {},
    });
    const link = { setAttribute: () => {}, click: () => {}, style: {} as Record<string, string> };
    vi.stubGlobal('document', {
      createElement: () => link,
      body: { appendChild: () => {}, removeChild: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('apostrophe-prefixes a formula in the product name and leaves numbers intact', () => {
    const product = {
      sku: 'S1',
      name: '=HYPERLINK("http://evil","x")',
      category: 'cat',
      price: 10,
      stock_level: 5,
    } as Product;

    downloadProductIntelligenceCsv([product], 'BrandA');

    // The malicious name is neutralized with a leading apostrophe (inside the CSV quotes).
    expect(captured).toContain('"\'=HYPERLINK');
    // A genuine number is not turned into a formula-escaped string.
    expect(captured).toContain('"10.00"');
    expect(captured).not.toContain("'10.00");
  });
});
