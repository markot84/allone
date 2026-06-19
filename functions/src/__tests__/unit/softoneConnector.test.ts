/** decodeSoftOneBody must read SoftOne's Windows-1253 (Greek ANSI) bytes correctly — decoding as
 * UTF-8 (the fetch default) corrupts Greek into U+FFFD. */
import { describe, it, expect } from 'vitest';
import {
  decodeSoftOneBody,
  fieldGroupsFromBrowserInfo,
  assembleBrowserRows,
  isRetryableSoftOneStatus,
  planSoftOneRetry,
  parseSoftOneSalesLines,
} from '../../softoneConnector';

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

const F = (...names: string[]) => ({ fields: names.map((n) => ({ name: n })) });

describe('fieldGroupsFromBrowserInfo', () => {
  it('one group when ZOOMINFO appears once (single-section browser)', () => {
    expect(fieldGroupsFromBrowserInfo(F('ZOOMINFO', 'FLD-1', 'SALDOC.TRNDATE'))).toEqual([
      ['ZOOMINFO', 'FLD-1', 'SALDOC.TRNDATE'],
    ]);
  });

  it('splits into one group per ZOOMINFO (multi-section browser)', () => {
    const g = fieldGroupsFromBrowserInfo(
      F('ZOOMINFO', 'FLD-1', 'ITEM.CODE', 'ITEM.PRICEW', 'ZOOMINFO', 'FLD-1', 'ITEM.CODE', 'ITEM.MTRL_ITEMTRDATA_QTY1'),
    );
    expect(g.length).toBe(2);
    expect(g[1]).toEqual(['ZOOMINFO', 'FLD-1', 'ITEM.CODE', 'ITEM.MTRL_ITEMTRDATA_QTY1']);
  });

  it('uses the first field name as the section marker (generalizes beyond ZOOMINFO)', () => {
    expect(fieldGroupsFromBrowserInfo(F('KEYCOL', 'N', 'A', 'KEYCOL', 'N', 'B'))).toEqual([
      ['KEYCOL', 'N', 'A'],
      ['KEYCOL', 'N', 'B'],
    ]);
  });

  it('falls back to a single group from columns when no fields', () => {
    expect(fieldGroupsFromBrowserInfo({ columns: [{ dataIndex: 'A' }, { dataIndex: 'B' }] })).toEqual([['A', 'B']]);
  });
});

describe('assembleBrowserRows', () => {
  it('single group maps rows by fields incl. the leading ZOOMINFO cell (fixes the off-by-one)', () => {
    const groups = [['ZOOMINFO', 'FLD-1', 'SALDOC.TRNDATE', 'SALDOC.FINCODE']];
    const rows = [['01351;127510', '1', '2026-06-19 00:00:00', 'ΤΔΑΜ000323']];
    const out = assembleBrowserRows(groups, rows, 1, 'SALDOC');
    expect(out[0]['ZOOMINFO']).toBe('01351;127510');
    expect(out[0]['FLD-1']).toBe('1');
    expect(out[0]['SALDOC.TRNDATE']).toBe('2026-06-19 00:00:00'); // not the row number '1'
  });

  it('multi-section: merges the 3 projections per ZOOMINFO and captures the balance', () => {
    const groups = [
      ['ZOOMINFO', 'FLD-1', 'ITEM.CODE', 'ITEM.NAME', 'ITEM.MTRUNIT1', 'ITEM.PRICEW'],
      ['ZOOMINFO', 'FLD-1', 'ITEM.CODE', 'ITEM.NAME', 'ITEM.VAT', 'ITEM.MTRL_ITEMTRDATA_QTY1'],
      ['ZOOMINFO', 'FLD-1', 'ITEM.CODE', 'ITEM.NAME', 'ITEM.MTRL_ITEMTRDATA_QTY1', 'ITEM.SoOrdered'],
    ];
    const raw = [
      ['ITEM;100', '1', 'CODE-A', 'ΟΝΟΜΑ Α', 'τεμ', '5.00'], // s1 item1
      ['ITEM;200', '2', 'CODE-B', 'ΟΝΟΜΑ Β', 'κιλ', ''], // s1 item2
      ['ITEM;100', '1', 'CODE-A', 'ΟΝΟΜΑ Α', 'ΦΠΑ', '51.50'], // s2 item1
      ['ITEM;200', '2', 'CODE-B', 'ΟΝΟΜΑ Β', 'ΦΠΑ', ''], // s2 item2
      ['ITEM;100', '1', 'CODE-A', 'ΟΝΟΜΑ Α', '51.50', '3'], // s3 item1
      ['ITEM;200', '2', 'CODE-B', 'ΟΝΟΜΑ Β', '', ''], // s3 item2
    ];
    const out = assembleBrowserRows(groups, raw, 6, 'ITEM');
    expect(out.length).toBe(2);
    const a = out.find((r) => r.ZOOMINFO === 'ITEM;100')!;
    expect(a['ITEM.CODE']).toBe('CODE-A');
    expect(a['ITEM.NAME']).toBe('ΟΝΟΜΑ Α');
    expect(a['ITEM.PRICEW']).toBe('5.00'); // from section 1
    expect(a['ITEM.MTRL_ITEMTRDATA_QTY1']).toBe('51.50'); // balance from sections 2/3
    expect(a['ITEM.SoOrdered']).toBe('3'); // from section 3
  });

  it('first non-blank wins: a later section blank OR literal 0 never clobbers an earlier value', () => {
    const groups = [
      ['ZOOMINFO', 'FLD-1', 'QTY'],
      ['ZOOMINFO', 'FLD-1', 'QTY'],
    ];
    const out = assembleBrowserRows(groups, [['ITEM;1', '1', '51.50'], ['ITEM;1', '1', '0']], 2, 'ITEM');
    expect(out.length).toBe(1);
    expect(out[0]['QTY']).toBe('51.50'); // not clobbered by the trailing '0'
  });

  it('detects sections structurally — a ragged/short stock section stays aligned', () => {
    const groups = [
      ['ZOOMINFO', 'FLD-1', 'PRICE'],
      ['ZOOMINFO', 'FLD-1', 'QTY'],
    ];
    const raw = [
      ['ITEM;1', '1', '10'], // s1
      ['ITEM;2', '2', '20'], // s1
      ['ITEM;3', '3', '30'], // s1
      ['ITEM;1', '1', '7'], // s2 restart — QTY, not PRICE
      ['ITEM;2', '2', '8'], // s2 (item 3 has no stock row)
    ];
    const out = assembleBrowserRows(groups, raw, 6, 'ITEM');
    expect(out.length).toBe(3);
    const a = out.find((r) => r.ZOOMINFO === 'ITEM;1')!;
    expect(a['PRICE']).toBe('10');
    expect(a['QTY']).toBe('7');
    const c = out.find((r) => r.ZOOMINFO === 'ITEM;3')!;
    expect(c['PRICE']).toBe('30');
    expect(c['QTY']).toBeUndefined(); // no false stock for the item missing from section 2
  });

  it('blank leading key: falls back to the row counter so the catalog does NOT collapse', () => {
    const groups = [
      ['ZOOMINFO', 'FLD-1', 'PRICE'],
      ['ZOOMINFO', 'FLD-1', 'QTY'],
    ];
    const raw = [
      ['', '1', 'p1'], ['', '2', 'p2'], // s1
      ['', '1', 'q1'], ['', '2', 'q2'], // s2 (counter restarts to '1')
    ];
    const out = assembleBrowserRows(groups, raw, 4, 'ITEM');
    expect(out.length).toBe(2); // NOT collapsed to a single record
    const a = out.find((r) => r['FLD-1'] === '1')!;
    expect(a['PRICE']).toBe('p1');
    expect(a['QTY']).toBe('q1');
  });

  it('k>1 but no section restart ⇒ rows treated as distinct items (no false merge)', () => {
    const groups = [['ZOOMINFO', 'A'], ['ZOOMINFO', 'B']];
    const out = assembleBrowserRows(groups, [['x', '1'], ['y', '2'], ['z', '3']], 3, 'X');
    expect(out.length).toBe(3);
  });
});

describe('isRetryableSoftOneStatus', () => {
  it('retries network reset (0), rate-limit (429) and 5xx', () => {
    for (const s of [0, 429, 500, 502, 503]) expect(isRetryableSoftOneStatus(s)).toBe(true);
  });
  it('does not retry success or 4xx (auth/bad-request are permanent)', () => {
    for (const s of [200, 400, 401, 403, 404]) expect(isRetryableSoftOneStatus(s)).toBe(false);
  });
});

describe('planSoftOneRetry', () => {
  it('retries a thrown network error with exponential backoff until the cap', () => {
    expect(planSoftOneRetry({ attempt: 1, status: 0, threw: true })).toEqual({ retry: true, delayMs: 800 });
    expect(planSoftOneRetry({ attempt: 2, status: 0, threw: true })).toEqual({ retry: true, delayMs: 1600 });
    expect(planSoftOneRetry({ attempt: 3, status: 0, threw: true })).toEqual({ retry: false, delayMs: 0 }); // cap
  });
  it('retries a transient status but not a permanent one', () => {
    expect(planSoftOneRetry({ attempt: 1, status: 503, threw: false }).retry).toBe(true);
    expect(planSoftOneRetry({ attempt: 1, status: 400, threw: false }).retry).toBe(false);
    expect(planSoftOneRetry({ attempt: 1, status: 200, threw: false }).retry).toBe(false);
  });
});

describe('parseSoftOneSalesLines', () => {
  it('extracts sku/qty/price/value from a getData SALDOC ITELINES grid', () => {
    const resp = {
      success: true,
      data: {
        ITELINES: [
          { MTRL: '2546', MTRL_ITEM_CODE: 'RS10164-45', MTRL_ITEM_NAME: 'BOOT 45', QTY1: '2', PRICE: '120.16', NETLINEVAL: '102.14' },
          { MTRL_ITEM_CODE: 'X-1', QTY1: '1', NETLINEVAL: '10' },
        ],
      },
    };
    const lines = parseSoftOneSalesLines(resp);
    expect(lines.length).toBe(2);
    expect(lines[0]).toEqual({ sku: 'RS10164-45', name: 'BOOT 45', quantity: 2, price: 120.16, rowTotal: 102.14 });
    expect(lines[1].sku).toBe('X-1');
  });

  it('falls back to MTRLINES, skips lines with no item code, tolerates null/empty', () => {
    expect(parseSoftOneSalesLines(null)).toEqual([]);
    expect(parseSoftOneSalesLines({ data: {} })).toEqual([]);
    const r = parseSoftOneSalesLines({ data: { MTRLINES: [{ MTRL_MTRL_CODE: 'M1', QTY: '4' }, { QTY: '9' }] } });
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ sku: 'M1', quantity: 4 });
  });
});
