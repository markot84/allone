# Firebase Setup - Step by Step

## Βήμα 1: Firebase Login

Άνοιξε Terminal/PowerShell και τρέξε:

```bash
firebase login
```

Αυτό θα ανοίξει browser. Κάνε login με το Google account σου.

## Βήμα 2: Create Firebase Project

### Επιλογή Α: Από Firebase Console (Recommended)

1. Πήγαινε στο [Firebase Console](https://console.firebase.google.com/)
2. Κάνε κλικ "Add project" ή "Create a project"
3. Project name: `performance-plus`
4. Disable Google Analytics (ή enable αν θέλεις)
5. Κάνε κλικ "Create project"
6. Περίμενε να ολοκληρωθεί το setup

### Επιλογή Β: Από CLI

```bash
firebase projects:create performance-plus
```

## Βήμα 3: Initialize Firebase Hosting

Τρέξε στο project folder:

```bash
firebase init hosting
```

Επέλεξε:
- **Use an existing project** → `performance-plus`
- **What do you want to use as your public directory?** → `dist` (ή Enter για default)
- **Configure as a single-page app?** → `Yes`
- **Set up automatic builds and deploys with GitHub?** → `No` (για τώρα)

## Βήμα 4: Verify Configuration

Ελέγξε ότι τα files είναι σωστά:

**`.firebaserc`** πρέπει να έχει:
```json
{
  "projects": {
    "default": "performance-plus"
  }
}
```

**`firebase.json`** πρέπει να έχει hosting configuration (ήδη υπάρχει).

## Βήμα 5: Build & Deploy

```bash
# Build
npm run build

# Deploy
firebase deploy --only hosting
```

## Βήμα 6: Verify

Μετά το deploy θα δεις:
```
✔  Deploy complete!

Hosting URL: https://performance-plus.web.app
```

Άνοιξε το URL στον browser για να δεις την εφαρμογή!

---

## Troubleshooting

### Αν το project name υπάρχει ήδη:
- Χρησιμοποίησε άλλο όνομα στο `.firebaserc`
- Ή delete το υπάρχον project από Firebase Console

### Αν βλέπεις authentication error:
```bash
firebase login --reauth
```

### Αν θέλεις να δεις local preview:
```bash
npm run build
firebase serve
```
