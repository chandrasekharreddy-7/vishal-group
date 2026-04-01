# KisanKart v4 — seller KYC, approval workflow, invoice download, live map

## What's new
- richer seller profile with business, license, GST, UPI, service area, bank details, and document URL
- admin approval / rejection workflow for seller KYC
- free live map panel using OpenStreetMap + Leaflet
- invoice download endpoint per order
- stronger delivery flow with rider assignment, pickup acceptance, live tracking, and delivery updates
- manual-ready payment handoff for COD, UPI, and Scan & Pay

## Run locally
1. Create PostgreSQL database `agri_marketplace`
2. Copy `.env.example` to `.env`
3. Fill PostgreSQL credentials
4. Run:
   ```bash
   npm install
   npm run dev
   ```
5. Open `http://localhost:4000`

## Demo accounts
- seller@example.com / password123
- farmer@example.com / password123
- delivery@example.com / password123
- admin@example.com / password123

## Provider files to customize
- `paymentProvider.js`
- `mapsProvider.js`
- `pushProvider.js`

## Notes
- Leaflet + OpenStreetMap is enabled for the web tracking board
- invoice downloads are JSON for now; upgrade this to PDF later if needed
- UPI / QR payload is returned from the backend, but you still need a real provider for live settlement


## v5 animated map panel
- OpenStreetMap + Leaflet animated rider marker
- pulsing live rider chip
- trail line from recent tracking points
- live ETA / pace / last-update overlay card
- no paid map key required
