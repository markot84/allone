import * as XLSX from 'xlsx';

// Guard against XLSX "zip bombs": a small workbook declaring a huge cell range
// can explode memory when materialized. Reject before parsing.
const MAX_XLSX_CELLS = 2_000_000;
const MAX_XLSX_SHEETS = 100;
// Bound the read with `sheetRows` so the parser stops early (XLSX.read materializes the
// whole workbook before the cell guard fires); reject sheets that reach the cap.
const MAX_XLSX_ROWS = 500_000;

/** Reads a workbook with `sheetRows` capping rows-per-sheet to bound parse-time memory;
 *  files past the cap are rejected by assertSheetWithinLimits (truncated !ref reports cap+1). */
function readWorkbookBounded(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'buffer', sheetRows: MAX_XLSX_ROWS + 1 });
}

// Exported for unit tests: XLSX.write recomputes !ref from real cells, so tests call
// this directly with crafted ranges rather than through a written file.
export function assertSheetWithinLimits(sheet: XLSX.WorkSheet | undefined): void {
  const ref = sheet?.['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const rows = range.e.r - range.s.r + 1;
  const cols = range.e.c - range.s.c + 1;
  // A sheet that hit the sheetRows cap was truncated — reject the incomplete file.
  if (rows > MAX_XLSX_ROWS) {
    throw new Error(`Spreadsheet too large: ${rows} rows exceeds the ${MAX_XLSX_ROWS}-row limit`);
  }
  if (rows * cols > MAX_XLSX_CELLS) {
    throw new Error(`Spreadsheet too large: ${rows}×${cols} cells exceeds the ${MAX_XLSX_CELLS}-cell limit`);
  }
}

export function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (currentField || currentLine.length > 0) {
        currentLine.push(currentField.trim());
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
      }
      if (char === '\r' && nextChar === '\n') i++;
    } else {
      currentField += char;
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    lines.push(currentLine);
  }

  return lines;
}

export function parseXLSXBuffer(buffer: Buffer, type?: string): string[][] {
  const wb = readWorkbookBounded(buffer);

  let sheetName = wb.SheetNames[0];
  if (type === 'campaigns') {
    const rawDataSheet = wb.SheetNames.find(
      (name) => name.toLowerCase().includes('raw') || name.toLowerCase().includes('data')
    );
    if (rawDataSheet) sheetName = rawDataSheet;
  }

  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  assertSheetWithinLimits(sheet);
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  const cleanedRows = rows.map((row) =>
    (Array.isArray(row) ? row : [row]).map((cell) => String(cell ?? '').trim())
  );

  if (cleanedRows.length > 2) {
    const headerKeywords =
      type === 'campaigns'
        ? [
            'campaign', 'month', 'impressions', 'clicks', 'cost',
            'conversions', 'roas', 'purchases', 'spent', 'amount spent',
            'purchase roas', 'reporting starts', 'result type',
          ]
        : [
            'sku_id', 'sku', 'product_name', 'product', 'name', 'category',
            'sell_price', 'price', 'stock_on_hand', 'stock', 'cost_price',
            'cost', 'revenue', 'margin', 'quantity', 'item', 'id', 'title',
          ];

    let bestMatch = 0;
    let bestScore = 0;

    for (let i = 0; i < Math.min(10, cleanedRows.length); i++) {
      const row = cleanedRows[i];
      if (!row || row.length === 0) continue;

      const rowText = row.join(' ').toLowerCase().replace(/[_\s]/g, ' ');
      const score = headerKeywords.filter((kw) => rowText.includes(kw)).length;

      const hasLargeNumbers = row.some((cell) => {
        const num = parseFloat(String(cell).trim());
        return !isNaN(num) && num > 1000;
      });

      if (score > bestScore && !hasLargeNumbers) {
        bestScore = score;
        bestMatch = i;
      }
    }

    const minScore = type === 'campaigns' ? 3 : 2;
    if (bestScore >= minScore) {
      return cleanedRows.slice(bestMatch);
    }
  }

  return cleanedRows;
}

export function csvToObjects(csvRows: string[][], type?: string): Record<string, string>[] {
  if (csvRows.length === 0) return [];

  let headerRowIndex = 0;
  if (csvRows.length > 1) {
    const headerKeywords =
      type === 'campaigns'
        ? ['campaign', 'month', 'impressions', 'clicks', 'cost', 'conversions', 'roas', 'purchases', 'spent']
        : ['sku', 'product', 'name', 'category', 'price', 'stock', 'cost', 'revenue', 'margin', 'quantity', 'item', 'id', 'title'];

    let bestMatch = 0;
    let bestScore = 0;

    for (let i = 0; i < Math.min(10, csvRows.length); i++) {
      const row = csvRows[i];
      if (!row || row.length === 0) continue;

      const rowText = row.join(' ').toLowerCase();
      const score = headerKeywords.filter((kw) => rowText.includes(kw)).length;
      const hasNumbers = row.some((cell) => {
        const num = parseFloat(String(cell).trim());
        return !isNaN(num) && num > 100;
      });

      if (score > bestScore && !hasNumbers) {
        bestScore = score;
        bestMatch = i;
      }
    }

    const minScore = type === 'campaigns' ? 3 : 2;
    if (bestScore >= minScore) headerRowIndex = bestMatch;
  }

  const headers = csvRows[headerRowIndex].map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, '_')
  );

  const objects: Record<string, string>[] = [];
  for (let i = headerRowIndex + 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (row.length === 0 || !row.some((c) => c !== '')) continue;

    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] != null ? String(row[idx]).trim() : '';
    });
    objects.push(obj);
  }

  return objects;
}

/** Reads every sheet from an XLSX workbook into raw string rows per sheet name
 *  (used for multi-sheet imports like PROCUREMENT_TEMPLATE.xlsx). */
export function parseXLSXAllSheets(buffer: Buffer): Map<string, string[][]> {
  const wb = readWorkbookBounded(buffer);
  const result = new Map<string, string[][]>();
  if (wb.SheetNames.length > MAX_XLSX_SHEETS) {
    throw new Error(`Workbook has too many sheets (${wb.SheetNames.length} > ${MAX_XLSX_SHEETS})`);
  }
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    assertSheetWithinLimits(sheet);
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    result.set(
      sheetName,
      rows.map((row) => (Array.isArray(row) ? row : [row]).map((cell) => String(cell ?? '').trim()))
    );
  }
  return result;
}

export function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== '') return val;
  }

  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const lowerKey = k.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
    const matchingKey = rowKeys.find((rk) => {
      const nrk = rk.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
      return nrk === lowerKey || nrk.includes(lowerKey) || lowerKey.includes(nrk);
    });
    if (matchingKey) {
      const val = row[matchingKey];
      if (val !== undefined && val !== '') return val;
    }
  }

  for (const k of keys) {
    const keyWords = k.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (keyWords.length > 0) {
      const matchingKey = rowKeys.find((rk) => {
        const nrk = rk.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
        return keyWords.every((w) => nrk.includes(w));
      });
      if (matchingKey) {
        const val = row[matchingKey];
        if (val !== undefined && val !== '') return val;
      }
    }
  }

  return '';
}
