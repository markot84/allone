# Firebase Setup Guide

## 1. Install Firebase CLI

```bash
npm install -g firebase-tools
```

## 2. Login to Firebase

```bash
firebase login
```

## 3. Initialize Firebase Project

```bash
firebase init
```

Επέλεξε:
- **Hosting**: Configure files for Firebase Hosting
- **Firestore**: Configure security rules and indexes files
- **Use an existing project**: Select your Firebase project (ή create new)

## 4. Configure Firebase Project

Αν χρειάζεται να αλλάξεις το project ID, επεξεργάσου το `.firebaserc`:

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  }
}
```

## 5. Set Environment Variables

Δημιούργησε ένα `.env` file (copy από `.env.example`):

```bash
cp .env.example .env
```

Επεξεργάσου το `.env` με τα πραγματικά Firebase credentials από το Firebase Console:
- Firebase Console → Project Settings → General → Your apps → Web app

## 6. Install Dependencies

```bash
npm install
```

## 7. Build and Deploy

```bash
# Build only
npm run build

# Deploy to Firebase Hosting
npm run firebase:deploy

# Or use Firebase CLI directly
firebase deploy --only hosting
```

## 8. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## 9. Firebase Console Setup

### Firestore Database:
1. Πήγαινε στο Firebase Console → Firestore Database
2. Create database → Start in production mode (ή test mode για development)
3. Choose location (π.χ. europe-west1)

### Collections Structure:
- `products` - Product data
- `segments` - RFM segments
- `campaigns` - Marketing campaigns
- `content` - Content calendar items
- `analytics` - Analytics data
- `users` - User data

## 10. Update Firestore Rules (if needed)

Επεξεργάσου το `firestore.rules` ανάλογα με τις ανάγκες σου.

## 11. Environment Variables in Firebase Hosting

Για production, μπορείς να ορίσεις environment variables στο Firebase Console:
- Firebase Console → Hosting → Environment variables

Ή να χρησιμοποιήσεις Firebase Functions για secrets management.

## Useful Commands

```bash
# Serve locally
npm run firebase:serve

# Deploy only hosting
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Deploy everything
firebase deploy

# View logs
firebase functions:log
```

## Migration from Mock Data

Για να μεταφέρεις τα mock data στο Firestore:

1. Create a migration script in `scripts/migrate-to-firestore.ts`
2. Use the FirestoreService to upload data
3. Run: `npm run migrate` (after creating the script)
