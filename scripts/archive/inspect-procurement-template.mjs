import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const path = resolve(process.env.USERPROFILE || '', 'Downloads', 'PROCUREMENT_TEMPLATE.xlsx');
try {
  const buf = readFileSync(path);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const result = { sheetNames: wb.SheetNames, sheets: {} };
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    result.sheets[name] = {
      rowCount: rows.length,
      headers: rows[0],
      sampleRow: rows[1],
    };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error('Error:', e.message);
}
