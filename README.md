# Livio Grid Land Plotter Handoff

This folder contains a drop-in React/Next.js parcel plotting widget for Livio Grid.

It lets a user:

- Search or center a Google satellite map on a site.
- Click dots to create a parcel boundary.
- Create a triangle after 3 dots, square after 4, pentagon after 5, and so on.
- Drag the vertex dots to refine the land boundary.
- Add "negative space" exclusions inside the parcel after the main parcel has at least 3 points.
- Click "Optimize layout" to place a preliminary buildable pad, data halls, utility yard, and truck/fire access aisle inside the usable land.
- Export the boundary, exclusions, and estimated area to JSON for the Livio Grid analysis engine.

Important implementation choice: this uses the Google Maps JavaScript API in satellite/hybrid mode, not the deprecated Google Drawing Library. Google deprecated the Drawing Library in August 2025 and listed it for removal in a Maps JS API release in May 2026, so this code handles drawing/editing directly with `google.maps.Polygon` paths.

The UX pattern was adapted from Ethan's existing Redev.ai `EditableParcelMap`: click to drop numbered pins, drag pins to adjust, double-click a pin to remove it, and store user-drawn boundaries as explicit preliminary site evidence.

## Files

- `src/LivioLandPlotter.tsx` - the main client-side React component.
- `src/googleMapsLoader.ts` - tiny script loader for Google Maps JS API.
- `src/landPlotterTypes.ts` - shared TypeScript types.
- `src/parcelGeometry.ts` - area and export helpers.
- `src/layoutOptimizer.ts` - preliminary site layout optimizer.
- `src/example-site-analysis-snippet.tsx` - example usage inside the existing Site Analysis page.
- `preview/` - standalone browser preview that works without a Google Maps key.
- `preview/earth.html` - real Google satellite/hybrid preview that loads Maps JavaScript API when a key is provided.
- `INTEGRATION.md` - exact steps for wiring this into Livio Grid.

## Google Cloud Requirements

Enable these APIs in the Google Cloud project used by Livio Grid:

- Maps JavaScript API
- Places API, only if your team adds address autocomplete later

Create a browser API key restricted to the Livio Grid domains:

- `https://grid.golivio.com/*`
- local development domains such as `http://localhost:3000/*`

Add this to the Next.js environment:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_key_here
NEXT_PUBLIC_GOOGLE_MAP_ID=optional_vector_map_id_here
```

`NEXT_PUBLIC_GOOGLE_MAP_ID` is optional for the base polygon workflow. Add it if your team wants Advanced Markers or custom cloud styling later.

Install browser types in the Livio Grid app:

```bash
npm install -D @types/google.maps
```

## Basic Usage

```tsx
import LivioLandPlotter from '@/components/site-analysis/LivioLandPlotter'

<LivioLandPlotter
  apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}
  initialCenter={{ lat: 36.326, lng: -96.965 }}
  onChange={(parcel) => {
    console.log(parcel)
  }}
/>
```

## Data Shape Emitted By `onChange`

```ts
{
  boundary: [
    { lat: 36.326, lng: -96.965 },
    { lat: 36.327, lng: -96.961 },
    { lat: 36.323, lng: -96.960 }
  ],
  exclusions: [
    [
      { lat: 36.325, lng: -96.963 },
      { lat: 36.3255, lng: -96.962 },
      { lat: 36.3245, lng: -96.962 }
    ]
  ],
  grossAcres: 12.4,
  excludedAcres: 1.1,
  netAcres: 11.3,
  optimizedLayout: {
    buildablePad: { label: "Optimized buildable pad", points: [...] },
    dataHalls: [{ label: "Data hall 1", points: [...] }],
    substationYard: { label: "Substation / utility yard", points: [...] },
    driveAisle: { label: "Truck / fire access aisle", points: [...] },
    padAcres: 7.8,
    rotationDegrees: 10,
    confidence: "medium",
    notes: [...]
  },
  boundaryEvidence: {
    status: "user-provided",
    method: "User-drawn satellite map boundary",
    note: "Useful for early data center site planning; confirm against survey, assessor GIS, title, easements, wetlands, and utility corridors before reliance.",
    checkedAt: "2026-05-26T00:00:00.000Z"
  }
}
```

Boundary points should be saved with the site analysis record so the engineering engine can compute setbacks, usable area, building pads, drive aisles, utility routing, and exclusion zones.

## Preview

Open the standalone preview locally:

```bash
npm start
```

Then visit:

```text
http://127.0.0.1:4173
```

The preview ships with a seeded parcel and exclusion so "Optimize layout" can be tested immediately.

For the real Google satellite/Google Earth-style preview, open:

```text
http://127.0.0.1:4173/earth.html
```

To test a real Google Maps JavaScript API key in the preview, paste it into:

```text
preview/config.js
```

The preview will show `Google Maps key: Connected` if the browser key, API enablement, and domain restriction are accepted. Keep `config.js` blank before sending the folder unless your boss expects a local test key.

## Railway Deploy

This repo is Railway-ready. Railway should run:

```bash
npm start
```

The app serves the preview folder at `/`, with the Google satellite page at `/earth.html`.

Set the Google Maps key as a Railway variable instead of committing it:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_restricted_key
NEXT_PUBLIC_GOOGLE_MAP_ID=optional_map_id
```

The server injects those values into `/config.js` at runtime.
