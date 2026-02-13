const XLSX = require('xlsx');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, Timestamp } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

// Firebase config - update with your config
const firebaseConfig = {
  // Add your Firebase config here
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper function to pick value from object with multiple possible keys
function pick(obj, ...keys) {
  for (const key of keys) {
    const value = obj[key.toLowerCase()] || obj[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

// Sanitize Firestore document ID
function sanitizeDocId(value) {
  return String(value)
    .replace(/[\/\\]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 100);
}

// Parse date string to ISO format
function parseDate(dateStr) {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString().split('T')[0];
}

// Validate and transform campaign row
function validateCampaignRow(row, index, channel) {
  const name = pick(row, 'campaign name', 'campaign', 'name', 'campaign_name');
  const period = pick(row, 'month', 'period', 'date range');
  const status = pick(row, 'status', 'campaign status', 'campaign_status', 'state');
  const budget = pick(row, 'budget', 'budget_amount', 'daily_budget');
  const amountSpent = pick(row, 'amount spent (eur)', 'cost', 'spend', 'amount_spent', 'total_cost');
  const impressions = pick(row, 'impressions', 'impr.', 'impr', 'imp');
  const clicks = pick(row, 'clicks (all)', 'clicks', 'click');
  const ctr = pick(row, 'ctr (all)', 'ctr', 'click_through_rate');
  const cpc = pick(row, 'cpc (all)', 'avg. cpc', 'cpc', 'cost_per_click', 'avg cpc');
  const cpm = pick(row, 'cpm (cost per 1,000 impressions)', 'cpm', 'cost_per_mille');
  const conversions = pick(row, 'conversions', 'purchases', 'purchase');
  const conversionValue = pick(row, 'conv. value', 'purchases conversion value', 'conversion_value', 'purchase_value');
  const roas = pick(row, 'conv. value / cost', 'purchase roas (return on ad spend)', 'roas', 'return_on_ad_spend');
  const costPerConversion = pick(row, 'cost / conv.', 'cost per result', 'cost_per_conversion', 'cost_per_result');
  const conversionRate = pick(row, 'conv. rate', 'conversion_rate', 'conversion rate');
  const currencyCode = pick(row, 'currency code', 'currency', 'currency_code');
  const bidStrategyType = pick(row, 'bid strategy type', 'bid_strategy_type', 'bidding_strategy');
  const resultType = pick(row, 'result type', 'result_type');
  const reportingStarts = pick(row, 'reporting starts', 'reporting_starts', 'start_date', 'start date');
  const reportingEnds = pick(row, 'reporting ends', 'reporting_ends', 'end_date', 'end date');

  if (!name) {
    return { valid: false, error: `Row ${index + 1}: Missing campaign name` };
  }

  let startDate = parseDate(reportingStarts);
  let endDate = parseDate(reportingEnds);

  // Try to parse period if dates not available
  if (!startDate && period) {
    const dateRangeMatch = period.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
    if (dateRangeMatch) {
      startDate = dateRangeMatch[1];
      endDate = dateRangeMatch[2];
    } else {
      const monthMatch = period.match(/(\w+)\s+(\d{4})/);
      if (monthMatch) {
        const monthNames = {
          january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
          july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
        };
        const month = monthNames[monthMatch[1].toLowerCase()];
        if (month) {
          startDate = `${monthMatch[2]}-${month}-01`;
          const lastDay = new Date(parseInt(monthMatch[2]), parseInt(month), 0).getDate();
          endDate = `${monthMatch[2]}-${month}-${lastDay}`;
        }
      }
    }
  }

  const campaign = {
    name: name.trim(),
    channel,
    ...(period ? { period: period.trim() } : {}),
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
    ...(status ? { status: status.trim().toLowerCase() } : {}),
    ...(budget ? { budget: parseFloat(budget) || 0 } : {}),
    ...(amountSpent ? { amount_spent: parseFloat(amountSpent) || 0 } : {}),
    ...(impressions ? { impressions: parseInt(impressions, 10) || 0 } : {}),
    ...(clicks ? { clicks: parseInt(clicks, 10) || 0 } : {}),
    ...(ctr ? { ctr: parseFloat(ctr) || 0 } : {}),
    ...(cpc ? { cpc: parseFloat(cpc) || 0 } : {}),
    ...(cpm ? { cpm: parseFloat(cpm) || 0 } : {}),
    ...(conversions ? { conversions: parseInt(conversions, 10) || 0 } : {}),
    ...(conversionValue ? { conversion_value: parseFloat(conversionValue) || 0 } : {}),
    ...(roas ? { roas: parseFloat(roas) || 0 } : {}),
    ...(costPerConversion ? { cost_per_conversion: parseFloat(costPerConversion) || 0 } : {}),
    ...(conversionRate ? { conversion_rate: parseFloat(conversionRate) || 0 } : {}),
    ...(currencyCode ? { currency_code: currencyCode.trim().toUpperCase() } : {}),
    ...(bidStrategyType ? { bid_strategy_type: bidStrategyType.trim() } : {}),
    ...(resultType ? { result_type: resultType.trim() } : {}),
    importedAt: Timestamp.now(),
  };

  return { valid: true, data: campaign };
}

// Read Excel file and extract campaign data
async function readCampaignsFromExcel(filePath, channel, brandId) {
  const wb = XLSX.readFile(filePath);
  
  // Try to find the right sheet
  let sheetName = wb.SheetNames.find(name => 
    name.toLowerCase().includes('raw') || 
    name.toLowerCase().includes('data') ||
    name.toLowerCase().includes('sheet')
  ) || wb.SheetNames[0];
  
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  // Find header row (look for campaign-related keywords)
  let headerRowIndex = 0;
  const headerKeywords = ['campaign', 'month', 'impressions', 'clicks', 'cost'];
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rowText = rows[i].join(' ').toLowerCase();
    if (headerKeywords.some(keyword => rowText.includes(keyword))) {
      headerRowIndex = i;
      break;
    }
  }
  
  const headers = rows[headerRowIndex].map(h => String(h).trim().toLowerCase());
  const dataRows = rows.slice(headerRowIndex + 1);
  
  // Convert to objects
  const objects = dataRows
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = String(row[index] || '').trim();
      });
      return obj;
    });
  
  // Validate and import
  const campaigns = [];
  for (let i = 0; i < objects.length; i++) {
    const validation = validateCampaignRow(objects[i], i, channel);
    if (validation.valid && validation.data) {
      campaigns.push({
        ...validation.data,
        brandId,
        id: sanitizeDocId(`campaign-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`),
      });
    }
  }
  
  return campaigns;
}

// Main import function
async function importSafeblockCampaigns() {
  const brandId = 'safeblock'; // Update with actual Safeblock brand ID
  
  console.log('Starting import for Safeblock campaigns...');
  
  const metaPath = path.join(__dirname, '../c:/Users/mtseh/Downloads/Safeblock-Report-Meta-Jan-1-2025-to-Jan-31-2026 (1).xlsx');
  const googleAdsPath = path.join(__dirname, '../c:/Users/mtseh/Downloads/Google Ads Campaign report 2025 Safeblock.xlsx');
  
  try {
    // Import Meta campaigns
    console.log('Reading Meta campaigns...');
    const metaCampaigns = await readCampaignsFromExcel(metaPath, 'Meta', brandId);
    console.log(`Found ${metaCampaigns.length} Meta campaigns`);
    
    // Import Google Ads campaigns
    console.log('Reading Google Ads campaigns...');
    const googleAdsCampaigns = await readCampaignsFromExcel(googleAdsPath, 'Google Ads', brandId);
    console.log(`Found ${googleAdsCampaigns.length} Google Ads campaigns`);
    
    // Combine and import to Firestore
    const allCampaigns = [...metaCampaigns, ...googleAdsCampaigns];
    console.log(`Total campaigns to import: ${allCampaigns.length}`);
    
    // Import in batches
    const batchSize = 500;
    for (let i = 0; i < allCampaigns.length; i += batchSize) {
      const batch = allCampaigns.slice(i, i + batchSize);
      const promises = batch.map(campaign => 
        addDoc(collection(db, 'campaigns'), campaign)
      );
      await Promise.all(promises);
      console.log(`Imported batch ${Math.floor(i / batchSize) + 1} (${batch.length} campaigns)`);
    }
    
    console.log(`Successfully imported ${allCampaigns.length} campaigns!`);
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  importSafeblockCampaigns().then(() => {
    console.log('Done!');
    process.exit(0);
  }).catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = { importSafeblockCampaigns };
