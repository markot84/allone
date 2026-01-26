# Data Import Guide

## CSV Import

Η εφαρμογή υποστηρίζει import δεδομένων από CSV αρχεία για διάφορους τύπους δεδομένων.

### Υποστηριζόμενοι Τύποι

1. **Products** - Προϊόντα (SKU, όνομα, κατηγορία, stock, τιμή, κλπ)
2. **RFM Segments** - Κατανομή πελατών σε RFM segments
3. **Campaigns** - Marketing campaigns
4. **Analytics** - Analytics και performance data
5. **Custom Data** - Προσαρμοσμένα δεδομένα

### Χρήση

1. Μεταβείτε στο **Data Import** από το navigation menu
2. Επιλέξτε τον τύπο δεδομένων που θέλετε να importάρετε
3. Κάντε κλικ στο **Download Template** για να κατεβάσετε ένα CSV template με τις σωστές στήλες
4. Συμπληρώστε το CSV με τα δεδομένα σας
5. Επιλέξτε το αρχείο και κάντε κλικ στο **Import Data**

### CSV Format Examples

#### Products Template
```csv
SKU,Name,Category,Margin Tier,Margin Percentage,Stock Level,Stock Capacity,Stock Age Days,Price,Priority Tag
PROD-001,Product Name,Electronics,high,35.5,100,500,30,99.99,featured
PROD-002,Another Product,Clothing,medium,25.0,50,200,15,49.99,
```

#### RFM Segments Template
```csv
Name,RFM Score,Count,Percentage,Revenue Share,Color,Description
Champions,555,1500,25.5,45.2,#22c55e,High value customers
Loyal,444,2000,34.0,30.1,#3b82f6,Regular customers
```

### Validation

Το σύστημα ελέγχει:
- Υποχρεωτικά πεδία (π.χ. SKU/ID για products, Name για segments)
- Τύπους δεδομένων (numbers, dates, κλπ)
- Μορφοποίηση CSV (headers, quotes, commas)

### Import History

Μπορείτε να δείτε το ιστορικό των imports:
- Status (completed, failed, processing)
- Αριθμός imported/failed records
- Errors και warnings
- Timestamp

## Επόμενα Βήματα: Automated Imports

### 1. Webhook Integration

Για αυτόματη λήψη δεδομένων μέσω webhooks:

**Προτεινόμενη Υλοποίηση:**
- Firebase Cloud Functions για webhook endpoints
- Validation και security (API keys, signatures)
- Automatic CSV parsing και import
- Notification system για import status

**Example Webhook Flow:**
```
External System → Webhook URL → Firebase Function → Parse CSV → Firestore → Notification
```

### 2. Scheduled Imports

Για προγραμματισμένα imports:

**Προτεινόμενη Υλοποίηση:**
- Firebase Cloud Functions με Cloud Scheduler
- Support για:
  - FTP/SFTP servers
  - Google Cloud Storage
  - AWS S3
  - Email attachments
  - API endpoints

**Configuration Options:**
- Frequency (hourly, daily, weekly)
- Data source (URL, file path, email)
- Data type mapping
- Error handling και retry logic

### 3. API Integration

Για direct API integration:

**Προτεινόμενη Υλοποίηση:**
- REST API endpoints για:
  - Manual trigger imports
  - Status checking
  - History retrieval
- Authentication με Firebase Auth
- Rate limiting και quotas

## Implementation Notes

### Current Architecture

- **Frontend**: React component (`DataImport.tsx`)
- **Service Layer**: `import.ts` με CSV parsing και Firestore integration
- **Storage**: Firestore collections (`products`, `segments`, `import_jobs`)

### Future Enhancements

1. **Batch Processing**: Support για μεγάλα CSV files (>10MB)
2. **Incremental Updates**: Update existing records αντί για create only
3. **Data Mapping**: UI για custom field mapping
4. **Preview**: Preview data πριν το import
5. **Rollback**: Undo imports σε περίπτωση error
6. **Export**: Export data back to CSV

## Security Considerations

- File size limits (suggested: 10MB max)
- File type validation (CSV only)
- Rate limiting για imports
- User authentication required
- Audit logging για όλα τα imports
