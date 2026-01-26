# Performance+ Enterprise Dashboard

A modern, enterprise-grade dashboard application for marketing performance management and customer segmentation.

## Features

- **Strategy Weights Configurator**: Configure product prioritization factors
- **RFM Analysis**: Customer segmentation insights
- **Product Intelligence**: Inventory & product performance
- **Channel Activation**: AI-powered channel recommendations
- **Content Strategy**: Align content with commercial strategy
- **ROI Attribution**: Measure Performance+ impact
- **AI Insights**: Actionable recommendations

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Recharts
- Framer Motion
- Primer React (GitHub Design System)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

### Firebase Hosting

The application is deployed to Firebase Hosting with Firestore database.

**Setup:**
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init` (select Hosting and Firestore)
4. Configure `.env` file with your Firebase credentials (see `.env.example`)
5. Deploy: `npm run firebase:deploy`

**See `FIREBASE_SETUP.md` for detailed instructions.**

**Live URL:** https://performance-plus-4a5b2.web.app
