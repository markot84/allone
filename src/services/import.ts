import { Timestamp } from 'firebase/firestore';
import { FirestoreService, ProductsService, SegmentsService } from './firestore';
import type { Product, RFMSegment } from '../types';

export type ImportType = 'products' | 'segments' | 'campaigns' | 'analytics' | 'custom';

export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
  warnings: string[];
}

export interface ImportJob {
  id: string;
  type: ImportType;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: ImportResult;
  createdAt: Date;
  completedAt?: Date;
}

// CSV Parser (simple implementation, can be replaced with papaparse later)
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
        i++; // Skip next quote
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
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \n after \r
      }
    } else {
      currentField += char;
    }
  }

  // Add last line
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    lines.push(currentLine);
  }

  return lines;
}

// Convert CSV rows to objects
function csvToObjects(csvRows: string[][]): Record<string, string>[] {
  if (csvRows.length === 0) return [];
  
  const headers = csvRows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const objects: Record<string, string>[] = [];

  for (let i = 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (row.length === 0) continue;
    
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index]?.trim() || '';
    });
    objects.push(obj);
  }

  return objects;
}

// Validate and transform Products
function validateProduct(row: Record<string, string>, index: number): { valid: boolean; data?: Product; error?: string } {
  const errors: string[] = [];

  if (!row.sku && !row.id) {
    errors.push('Missing SKU or ID');
  }
  if (!row.name) {
    errors.push('Missing name');
  }

  if (errors.length > 0) {
    return { valid: false, error: `Row ${index + 1}: ${errors.join(', ')}` };
  }

  const product: Product = {
    id: row.id || row.sku || `product-${Date.now()}-${index}`,
    name: row.name || '',
    sku: row.sku || row.id || '',
    category: row.category || 'Uncategorized',
    margin_tier: (row.margin_tier || 'medium') as 'high' | 'medium' | 'low',
    margin_percentage: parseFloat(row.margin_percentage || '0') || 0,
    stock_level: parseInt(row.stock_level || row.stock || '0', 10) || 0,
    stock_capacity: parseInt(row.stock_capacity || row.capacity || '0', 10) || 0,
    stock_age_days: parseInt(row.stock_age_days || row.age_days || '0', 10) || 0,
    price: parseFloat(row.price || '0') || 0,
    priority_tag: row.priority_tag || row.priority || undefined,
  };

  return { valid: true, data: product };
}

// Validate and transform Segments
function validateSegment(row: Record<string, string>, index: number): { valid: boolean; data?: RFMSegment; error?: string } {
  const errors: string[] = [];

  if (!row.name && !row.segment) {
    errors.push('Missing segment name');
  }
  if (!row.rfm_score && !row.score) {
    errors.push('Missing RFM score');
  }

  if (errors.length > 0) {
    return { valid: false, error: `Row ${index + 1}: ${errors.join(', ')}` };
  }

  const segment: RFMSegment = {
    id: row.id || `segment-${Date.now()}-${index}`,
    name: row.name || row.segment || '',
    rfm_score: row.rfm_score || row.score || '',
    count: parseInt(row.count || row.customers || '0', 10) || 0,
    percentage: parseFloat(row.percentage || '0') || 0,
    revenue_share: parseFloat(row.revenue_share || row.revenue || '0') || 0,
    color: row.color || '#6B7280',
    description: row.description || '',
    icon: row.icon || '',
  };

  return { valid: true, data: segment };
}

// Main import function
export async function importCSV(
  file: File,
  type: ImportType
): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    imported: 0,
    failed: 0,
    errors: [],
    warnings: [],
  };

  try {
    // Read file
    const text = await file.text();
    const csvRows = parseCSV(text);
    
    if (csvRows.length < 2) {
      result.success = false;
      result.errors.push('CSV file must contain at least a header row and one data row');
      return result;
    }

    const objects = csvToObjects(csvRows);
    
    if (objects.length === 0) {
      result.success = false;
      result.errors.push('No data rows found in CSV');
      return result;
    }

    // Process based on type
    switch (type) {
      case 'products': {
        const validProducts: Product[] = [];
        
        for (let i = 0; i < objects.length; i++) {
          const validation = validateProduct(objects[i], i);
          if (validation.valid && validation.data) {
            validProducts.push(validation.data);
          } else {
            result.failed++;
            if (validation.error) {
              result.errors.push(validation.error);
            }
          }
        }

        // Batch import to Firestore
        for (const product of validProducts) {
          try {
            await ProductsService.create(product.id, {
              ...product,
              createdAt: Timestamp.now(),
            });
            result.imported++;
          } catch (error) {
            result.failed++;
            result.errors.push(`Failed to import product ${product.sku}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        break;
      }

      case 'segments': {
        const validSegments: RFMSegment[] = [];
        
        for (let i = 0; i < objects.length; i++) {
          const validation = validateSegment(objects[i], i);
          if (validation.valid && validation.data) {
            validSegments.push(validation.data);
          } else {
            result.failed++;
            if (validation.error) {
              result.errors.push(validation.error);
            }
          }
        }

        // Batch import to Firestore
        for (const segment of validSegments) {
          try {
            await SegmentsService.create(segment.id, {
              ...segment,
              createdAt: Timestamp.now(),
            });
            result.imported++;
          } catch (error) {
            result.failed++;
            result.errors.push(`Failed to import segment ${segment.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        break;
      }

      case 'campaigns':
      case 'analytics':
      case 'custom':
        result.warnings.push(`${type} import is not yet fully implemented`);
        // For now, store as raw data
        for (let i = 0; i < objects.length; i++) {
          try {
            const id = `import-${Date.now()}-${i}`;
            await FirestoreService.setDocument(type, id, {
              ...objects[i],
              importedAt: Timestamp.now(),
              source: file.name,
            });
            result.imported++;
          } catch (error) {
            result.failed++;
            result.errors.push(`Failed to import row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        break;
    }

    result.success = result.failed === 0;
  } catch (error) {
    result.success = false;
    result.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

// Save import job history
export async function saveImportJob(job: Omit<ImportJob, 'id'>): Promise<string> {
  const id = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  await FirestoreService.setDocument('import_jobs', id, {
    ...job,
    createdAt: Timestamp.fromDate(job.createdAt),
    completedAt: job.completedAt ? Timestamp.fromDate(job.completedAt) : null,
  });
  return id;
}

// Get import job history
export async function getImportJobs(): Promise<ImportJob[]> {
  const jobs = await FirestoreService.getDocuments<ImportJob>('import_jobs', []);
  return jobs.map(job => ({
    ...job,
    createdAt: (job.createdAt as any)?.toDate?.() || new Date(job.createdAt as any),
    completedAt: (job.completedAt as any)?.toDate?.() || (job.completedAt ? new Date(job.completedAt as any) : undefined),
  }));
}
