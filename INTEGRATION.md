# Livio Grid Integration Notes

These instructions assume the current Livio Grid app is a Next.js 14 project with App Router and Tailwind.

## 1. Copy Files Into Livio Grid

Copy these files:

```text
src/LivioLandPlotter.tsx
src/googleMapsLoader.ts
src/landPlotterTypes.ts
src/parcelGeometry.ts
src/layoutOptimizer.ts
```

Recommended destination:

```text
src/components/site-analysis/
```

Then update the imports in `LivioLandPlotter.tsx` if needed:

```ts
import { loadGoogleMaps } from './googleMapsLoader'
import type { LatLngPoint, ParcelPlot } from './landPlotterTypes'
import { buildParcelPlot, pointsToPathLiteral } from './parcelGeometry'
import { optimizeSiteLayout } from './layoutOptimizer'
```

## 2. Add Environment Variables

Install Google Maps browser types so TypeScript recognizes the `google.maps` namespace:

```bash
npm install -D @types/google.maps
```

Add to `.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
NEXT_PUBLIC_GOOGLE_MAP_ID=...
```

`NEXT_PUBLIC_GOOGLE_MAP_ID` is optional for this version.

## 3. Add It To Site Analysis

In:

```text
src/app/(app)/site-analysis/page.tsx
```

Import the component:

```tsx
import LivioLandPlotter from '@/components/site-analysis/LivioLandPlotter'
```

Add state near the rest of the page state:

```tsx
const [parcelPlot, setParcelPlot] = useState<ParcelPlot | null>(null)
```

Render it below the location and power questions:

```tsx
<LivioLandPlotter
  apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
  mapId={process.env.NEXT_PUBLIC_GOOGLE_MAP_ID}
  initialCenter={{ lat: 36.326, lng: -96.965 }}
  onChange={setParcelPlot}
/>
```

When the analysis request is submitted, include `parcelPlot` in the payload:

```ts
body: JSON.stringify({
  location,
  power,
  parcelPlot,
  // existing fields...
})
```

## 4. Backend Shape

Store `parcelPlot` as JSON. The recommended database shape is:

```ts
type ParcelPlot = {
  boundary: { lat: number; lng: number }[]
  exclusions: { lat: number; lng: number }[][]
  grossAcres: number
  excludedAcres: number
  netAcres: number
  optimizedLayout?: {
    buildablePad: { label: string; points: { lat: number; lng: number }[] }
    dataHalls: { label: string; points: { lat: number; lng: number }[] }[]
    substationYard: { label: string; points: { lat: number; lng: number }[] }
    driveAisle: { label: string; points: { lat: number; lng: number }[] }
    padAcres: number
    rotationDegrees: number
    confidence: 'high' | 'medium' | 'low'
    notes: string[]
  } | null
  boundaryEvidence: {
    status: 'user-provided'
    method: 'User-drawn satellite map boundary'
    note: string
    checkedAt: string
  }
}
```

If Prisma is used, a simple first pass is:

```prisma
parcelPlot Json?
```

on the analysis/site model.

## 5. Notes For The Boss

- This intentionally does not use `google.maps.drawing.DrawingManager`.
- The UI follows the Redev.ai parcel drawer pattern: numbered pins, draggable corners, and double-click removal.
- "Negative space" is stored as additional polygon paths and subtracted from gross area.
- "Optimize layout" tests rotated buildable rectangles against the boundary and exclusions, then overlays data halls, utility yard, and truck/fire access.
- This is ready for Google satellite imagery. If true Google Earth 3D terrain/building tiles are required later, use Google Photorealistic 3D Tiles through CesiumJS as a separate viewer mode.

## 6. Preview Website

Two previews are included for stakeholder review:

```bash
cd livio-grid-land-plotter-handoff/preview
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`, then click `Optimize layout` for the no-key visual preview.

Open `http://127.0.0.1:4173/earth.html` for the real Google satellite/hybrid preview.

To test Google Maps API-key connectivity in the preview, paste the browser key into `preview/config.js`. The status card will show `Connected`, `Missing`, `Rejected`, `Failed`, or `Timed out`. Do not commit production credentials.
