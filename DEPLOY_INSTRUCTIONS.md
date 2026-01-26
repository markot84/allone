# Firebase Deploy Instructions

## Βήμα 1: Firebase Login

Ανοίγεις terminal και τρέχεις:

```bash
firebase login
```

Αυτό θα ανοίξει browser για authentication.

## Βήμα 2: Verify Project

Ελέγχεις ότι είσαι στο σωστό project:

```bash
firebase use performance-plus
```

## Βήμα 3: Build & Deploy

```bash
npm run firebase:deploy
```

Ή αν θέλεις να κάνεις build και deploy χωριστά:

```bash
# Build
npm run build

# Deploy
firebase deploy --only hosting
```

## Βήμα 4: Verify Deployment

Μετά το deploy, θα δεις ένα URL όπως:
```
✔  Deploy complete!

Project Console: https://console.firebase.google.com/project/performance-plus/overview
Hosting URL: https://performance-plus.web.app
```

## Troubleshooting

### Αν βλέπεις authentication error:
```bash
firebase login --reauth
```

### Αν το project δεν υπάρχει:
1. Πήγαινε στο [Firebase Console](https://console.firebase.google.com/)
2. Create new project με όνομα `performance-plus`
3. Enable Hosting από το menu
4. Τρέξε: `firebase init hosting` (αν χρειάζεται)

### Αν θέλεις να δεις local preview:
```bash
npm run firebase:serve
```
