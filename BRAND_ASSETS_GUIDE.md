# Brand Assets Guide

## Πώς να ανεβάσετε Brand Assets

### 1. Κατά τη Δημιουργία Brand

Όταν δημιουργείτε ένα νέο brand:
1. Συμπληρώστε το όνομα και τον τύπο (B2B/B2C)
2. Κάντε κλικ στο "Ανέβασμα" για το Logo
3. Επιλέξτε αρχείο (JPEG, PNG, SVG, WebP, GIF - μέχρι 5MB)
4. Το logo θα ανέβει αυτόματα στο Firebase Storage
5. Το logo θα είναι διαθέσιμο και στο localhost και στο production

### 2. Αρχεία που Ανέβηκαν

Τα assets αποθηκεύονται στο Firebase Storage με το path:
```
brands/{brandId}/assets/{assetType}/{timestamp}-{filename}
```

**Παράδειγμα:**
```
brands/my_store/assets/logo/1705123456789-logo.png
```

### 3. Πρόσβαση στα Assets

Τα assets είναι διαθέσιμα:
- **Στο localhost**: Μέσω Firebase Storage URLs
- **Στο production**: Με τα ίδια URLs (Firebase Storage)

Το `getAssetUrl()` helper function διασφαλίζει ότι τα URLs λειτουργούν και στα δύο environments.

### 4. Τύποι Assets

- **Logo**: Brand logo (εμφανίζεται στο BrandsPage και Header)
- **Image**: Γενικές εικόνες για το brand
- **Document**: Έγγραφα (future feature)

### 5. Firebase Storage Setup

**Βήμα 1: Enable Firebase Storage**
1. Πήγαινε στο Firebase Console → Storage
2. Κάνε κλικ "Get started"
3. Επέλεξε "Start in production mode" ή "Start in test mode"
4. Επέλεξε location (π.χ. europe-west1)

**Βήμα 2: Deploy Storage Rules**
```bash
firebase deploy --only storage
```

**Βήμα 3: Verify**
- Τα rules επιτρέπουν authenticated users να upload/read assets
- Μέγιστο μέγεθος: 5MB
- Μόνο image types επιτρέπονται

### 6. Χρήση στο Code

```typescript
import { uploadBrandAsset, getAssetUrl } from '../services/storage';

// Upload asset
const url = await uploadBrandAsset(file, brandId, 'logo');

// Get asset URL (works in both localhost and production)
const displayUrl = getAssetUrl(brand.logoUrl);
```

### 7. Troubleshooting

**Το asset δεν εμφανίζεται:**
- Ελέγξτε ότι το Firebase Storage είναι enabled
- Ελέγξτε τα storage rules: `firebase deploy --only storage`
- Ελέγξτε το browser console για errors

**Upload fails:**
- Ελέγξτε το μέγεθος αρχείου (max 5MB)
- Ελέγξτε τον τύπο αρχείου (μόνο images)
- Ελέγξτε ότι είστε authenticated

**Assets δεν φαίνονται στο production:**
- Τα assets είναι στο Firebase Storage, όχι στο public folder
- Τα URLs είναι τα ίδια και στο localhost και στο production
- Ελέγξτε ότι το Firebase Storage bucket είναι σωστά configured

### 8. Best Practices

1. **Ονόματα αρχείων**: Χρησιμοποιήστε descriptive names (π.χ. `logo-primary.png`)
2. **Μέγεθος**: Optimize images πριν το upload (χρησιμοποιήστε tools όπως TinyPNG)
3. **Format**: Προτιμήστε PNG για logos με transparency, SVG για scalable logos
4. **Backup**: Κρατήστε backups των assets σας

### 9. Storage Structure

```
Firebase Storage:
├── brands/
│   ├── brand1/
│   │   └── assets/
│   │       ├── logo/
│   │       │   └── 1705123456789-logo.png
│   │       ├── image/
│   │       │   └── 1705123456790-hero.jpg
│   │       └── document/
│   └── brand2/
│       └── assets/
│           └── logo/
│               └── 1705123456791-logo.svg
```

### 10. Security

- Μόνο authenticated users μπορούν να upload assets
- Κάθε brand έχει isolated storage path
- File size και type validation στο client και server
- Storage rules επιτρέπουν read/write μόνο για authenticated users
