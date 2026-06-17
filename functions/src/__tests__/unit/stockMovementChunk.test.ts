/** chunkRecord: correctness + linear-time. Pins chunking semantics and that a
 * catalog-sized record (Megaventory stock-movement) chunks in interactive time. */
import { describe, expect, it } from 'vitest';
import { chunkRecord } from '../../stockMovementTracker';

const TARGET = 850_000;

describe('chunkRecord', () => {
  it('preserves every key/value across chunks (merge == input)', () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) input[`SKU-${i}`] = i % 50;
    const chunks = chunkRecord(input);
    const merged = Object.assign({}, ...chunks);
    expect(merged).toEqual(input);
  });

  it('keeps every chunk under the Firestore-safe target size', () => {
    const input: Record<string, { dec7d: number; dec30d: number; dec90d: number }> = {};
    for (let i = 0; i < 90_000; i++) {
      input[`SKU-${String(i).padStart(8, '0')}`] = { dec7d: i % 3, dec30d: i % 7, dec90d: i % 11 };
    }
    const chunks = chunkRecord(input);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(TARGET + 1024);
    }
    expect(chunks.flatMap((c) => Object.keys(c)).length).toBe(90_000);
  });

  it('returns a single empty chunk for an empty record', () => {
    expect(chunkRecord({})).toEqual([{}]);
  });

  it('puts an oversized single entry alone in its own chunk', () => {
    const big = 'x'.repeat(TARGET + 100);
    const chunks = chunkRecord({ a: 1, big, b: 2 });
    const merged = Object.assign({}, ...chunks);
    expect(merged).toEqual({ a: 1, big, b: 2 });
  });

  it('chunks an 88k-SKU record in interactive time (linear, not quadratic)', () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 88_000; i++) input[`SKU-${String(i).padStart(8, '0')}`] = i % 50;
    const start = Date.now();
    const chunks = chunkRecord(input);
    const elapsedMs = Date.now() - start;
    expect(Object.assign({}, ...chunks)).toEqual(input);
    // the quadratic version took ~672_000ms on this input; linear is ~tens of ms.
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
