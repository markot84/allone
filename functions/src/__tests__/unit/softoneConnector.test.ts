/** decodeSoftOneBody must read SoftOne's Windows-1253 (Greek ANSI) bytes correctly — decoding as
 * UTF-8 (the fetch default) corrupts Greek into U+FFFD. */
import { describe, it, expect } from 'vitest';
import { decodeSoftOneBody } from '../../softoneConnector';

const ab = (bytes: number[]): ArrayBuffer => Uint8Array.from(bytes).buffer;

describe('decodeSoftOneBody', () => {
  it('decodes Windows-1253 Greek bytes (default, no charset header)', () => {
    // ΑΠΟΘΗΚΗ in win-1253: Α=0xC1 Π=0xD0 Ο=0xCF Θ=0xC8 Η=0xC7 Κ=0xCA Η=0xC7
    expect(decodeSoftOneBody(ab([0xc1, 0xd0, 0xcf, 0xc8, 0xc7, 0xca, 0xc7]))).toBe('ΑΠΟΘΗΚΗ');
  });

  it('keeps ASCII (codes/SKUs) intact and decodes embedded Greek', () => {
    // "00505-ΜΠ-2XL": Μ=0xCC Π=0xD0
    expect(
      decodeSoftOneBody(ab([0x30, 0x30, 0x35, 0x30, 0x35, 0x2d, 0xcc, 0xd0, 0x2d, 0x32, 0x58, 0x4c]))
    ).toBe('00505-ΜΠ-2XL');
  });

  it('produces no U+FFFD replacement chars for Greek (the bug symptom)', () => {
    expect(decodeSoftOneBody(ab([0xc1, 0xd0, 0xcf, 0xc8, 0xc7, 0xca, 0xc7]))).not.toContain('�');
  });

  it('round-trips a JSON body with Greek values', () => {
    // {"name":"ΜΠ"} with ΜΠ as win-1253 bytes
    const buf = ab([0x7b, 0x22, 0x6e, 0x61, 0x6d, 0x65, 0x22, 0x3a, 0x22, 0xcc, 0xd0, 0x22, 0x7d]);
    expect(JSON.parse(decodeSoftOneBody(buf))).toEqual({ name: 'ΜΠ' });
  });

  it('honors an explicit UTF-8 charset declaration', () => {
    const utf8 = Uint8Array.from(Buffer.from('Δοκιμή', 'utf8')).buffer;
    expect(decodeSoftOneBody(utf8, 'application/json; charset=utf-8')).toBe('Δοκιμή');
  });

  it('defaults to win-1253 when charset is absent or unrelated', () => {
    expect(decodeSoftOneBody(ab([0xc4]), 'application/json')).toBe('Δ');
  });
});
